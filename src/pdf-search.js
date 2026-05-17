import { state } from './state.js';
import * as dom from './dom.js';
import { getKeywordRegex } from './keyword-regex.js';
import { fn } from './cross.js';

state.searchResults = [];
state.currentMatchIndex = -1;
state.searchCache = {};
state.textPageCache = {};

function buildOffsetMap(textItems) {
    const offsets = [];
    let acc = 0;
    for (const item of textItems) {
        offsets.push(acc);
        acc += item.text.length;
    }
    return { offsets, length: acc };
}

function findStartItem(pos, offsets, items) {
    let lo = 0, hi = offsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (offsets[mid] <= pos) lo = mid;
        else hi = mid - 1;
    }
    return { item: items[lo], charStart: offsets[lo], index: lo };
}

function findEndItem(endPos, startIdx, offsets, items) {
    let lo = startIdx, hi = offsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const itemEnd = offsets[mid] + items[mid].text.length;
        if (endPos <= itemEnd) hi = mid;
        else lo = mid + 1;
    }
    return { item: items[lo], charStart: offsets[lo] };
}

function computeMatchCoords(matchStart, matchEnd, viewport, textItems, offsetMap) {
    const start = findStartItem(matchStart, offsetMap.offsets, textItems);
    const end = findEndItem(matchEnd, start.index, offsetMap.offsets, textItems);

    const startCharFrac = start.item.text.length > 0
        ? (matchStart - start.charStart) / start.item.text.length : 0;
    const sx = start.item.transform[4] + startCharFrac * start.item.width;
    const sy = viewport.height - (start.item.transform[5] + start.item.height);

    const endCharFrac = end.item.text.length > 0
        ? (matchEnd - end.charStart) / end.item.text.length : 1;
    const endX = end.item.transform[4] + endCharFrac * end.item.width;

    return { x: sx, y: sy, width: Math.max(endX - sx, 4), height: start.item.height };
}

export async function precomputeAllSearches() {
    if (state.searchCache._deduplicated) return;

    const combinedRegex = getKeywordRegex(window.KEYWORDS);

    for (let pageNum = 1; pageNum <= state.totalPages; pageNum++) {
        const cached = state.textPageCache[pageNum];
        if (!cached) continue;

        const pageText = cached.text;
        const viewport = cached.viewport;

        if (!cached.items) await fetchPageItems(pageNum);
        const textItems = cached.items;
        if (!textItems || textItems.length === 0) continue;

        const offsetMap = buildOffsetMap(textItems);

        let match;
        while ((match = combinedRegex.exec(pageText)) !== null) {
            if (match[0].length < 3) continue;
            if (!/[a-zA-Z]/.test(match[0])) continue;
            const lower = match[0].toLowerCase();
            const canonical = (window.KEYWORDS || []).find(k => k.toLowerCase() === lower) || lower;

            if (state.searchCache[canonical] === undefined) state.searchCache[canonical] = [];

            const coords = computeMatchCoords(match.index, match.index + match[0].length, viewport, textItems, offsetMap);
            state.searchCache[canonical].push({ page: pageNum, ...coords });
        }
    }

    state.searchCache._deduplicated = true;
    fn.populateKeywordSelect();
}

async function computeSearchForQuery(query) {
    if (state.searchCache[query] !== undefined) return;
    if (state.searchCache._deduplicated) return;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const localRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const results = [];

    for (let pageNum = 1; pageNum <= state.totalPages; pageNum++) {
        const cached = state.textPageCache[pageNum];
        if (!cached) continue;

        const pageText = cached.text;
        const viewport = cached.viewport;

        if (!cached.items) await fetchPageItems(pageNum);
        const textItems = cached.items;
        if (!textItems || textItems.length === 0) continue;

        const offsetMap = buildOffsetMap(textItems);

        let match;
        while ((match = localRegex.exec(pageText)) !== null) {
            if (match[0].length < 3) continue;
            if (!/[a-zA-Z]/.test(match[0])) continue;

            const coords = computeMatchCoords(match.index, match.index + match[0].length, viewport, textItems, offsetMap);
            results.push({ page: pageNum, ...coords });
        }
    }

    state.searchCache[query] = results;
}

export async function fetchPageItems(pageNum) {
    if (!state.pdfDoc) return null;
    const cached = state.textPageCache[pageNum];
    if (!cached || cached.items) return cached?.items;

    try {
        const page = await state.pdfDoc.getPage(pageNum);
        const content = await page.getTextContent();
        const items = [];
        for (const item of content.items) {
            items.push({ text: item.str, transform: item.transform, width: item.width, height: item.height });
        }
        cached.items = items;
        return items;
    } catch (err) {
        console.warn('Failed to fetch page items for page ' + pageNum + ':', err.message);
        return null;
    }
}

function appendOcrResults(keyword) {
    const getter = fn.getOcrMatchesForKeyword;
    if (!getter) return;
    const matches = getter(keyword, state.currentDocUrl);
    if (!matches || matches.length === 0) return;
    for (const m of matches) {
        const hasCoords = m.x !== undefined;
        const dup = state.searchResults.some(r =>
            r.page === m.page && (hasCoords
                ? Math.abs(r.x - m.x) < 1 && Math.abs(r.y - m.y) < 1
                : r.ocr)
        );
        if (dup) continue;
        if (hasCoords) {
            state.searchResults.push({ page: m.page, x: m.x, y: m.y, width: m.width, height: m.height, ocr: true });
        } else {
            state.searchResults.push({ page: m.page, x: null, y: null, width: null, height: null, ocr: true });
        }
    }
}

export async function performSearch(query) {
    if (!state.pdfDoc || !query) return;

    let canonicalQuery = query;
    if (state.searchCache[query] === undefined) {
        const lower = query.toLowerCase();
        const found = (window.KEYWORDS || []).find(k => k.toLowerCase() === lower);
        if (found && state.searchCache[found] !== undefined) canonicalQuery = found;
    }

    if (state.searchCache[canonicalQuery] !== undefined) {
        state.searchResults = state.searchCache[canonicalQuery];
        appendOcrResults(canonicalQuery);
        buildSearchResultsByPage();
        state.activeKeyword = canonicalQuery;
        state.currentMatchIndex = 0;
        showSearchResults();
        return;
    }

    state.activeKeyword = canonicalQuery;
    state.currentMatchIndex = 0;
    clearHighlights();
    state.searchResults = [];

    await computeSearchForQuery(canonicalQuery);
    state.searchResults = state.searchCache[canonicalQuery] || [];
    appendOcrResults(canonicalQuery);
    buildSearchResultsByPage();

    showSearchResults();
}

function showSearchResults() {
    if (state.searchResults.length > 0) {
        dom.navGroup.classList.add('active');
        dom.navSep.style.display = '';
        dom.matchTotal.textContent = state.searchResults.length;
        dom.matchInput.max = state.searchResults.length;
        dom.matchInput.value = 1;
        state.currentMatchIndex = 0;
        renderAllHighlights();
        fn.populateKeywordSelect();
        fn.updateSidebarBadge();
        fn.renderPageHeatmaps();
        fn.startPrerender();
        fn.goToMatch(0);
    } else {
        dom.navGroup.classList.remove('active');
        dom.navSep.style.display = '';
        dom.matchTotal.textContent = '0';
        dom.matchInput.value = '';
        state.currentMatchIndex = -1;
        fn.updateSidebarBadge();
        fn.populateKeywordSelect();
        fn.renderPageHeatmaps();
    }
}

export function cycleSearch(query) {
    if (!state.pdfDoc || !query) return;

    if (state.searchCache[query] !== undefined) {
        state.searchResults = state.searchCache[query];
        appendOcrResults(query);
        buildSearchResultsByPage();
        state.activeKeyword = query;

        if (state.searchResults.length > 0) {
            dom.navGroup.classList.add('active');
            dom.navSep.style.display = '';
            state.currentMatchIndex = (state.currentMatchIndex + 1) % state.searchResults.length;
            dom.matchTotal.textContent = state.searchResults.length;
            dom.matchInput.max = state.searchResults.length;
            dom.matchInput.value = state.currentMatchIndex + 1;
            renderAllHighlights();
            fn.populateKeywordSelect();
            fn.renderPageHeatmaps();
            fn.goToMatch(state.currentMatchIndex);
        } else {
            dom.navGroup.classList.remove('active');
            dom.navSep.style.display = 'none';
            dom.matchTotal.textContent = '0';
            dom.matchInput.value = '';
            fn.populateKeywordSelect();
        }
        return;
    }

    performSearch(query);
}

export function renderAllHighlights() {
    clearHighlights();

    for (const pageNum in state.searchResultsByPage) {
        const pageEl = document.getElementById('page-' + pageNum);
        if (!pageEl) continue;
        const fragment = document.createDocumentFragment();
        state.searchResultsByPage[pageNum].forEach(({ result, globalIndex }) => {
            if (result.x === null) return;
            const mark = document.createElement('div');
            mark.className = 'highlight-mark' + (globalIndex === state.currentMatchIndex ? ' current' : '');
            mark.style.left = (result.x * state.currentScale) + 'px';
            mark.style.top = (result.y * state.currentScale) + 'px';
            mark.style.width = (result.width * state.currentScale) + 'px';
            mark.style.height = (result.height * state.currentScale) + 'px';
            fragment.appendChild(mark);
        });
        pageEl.appendChild(fragment);
    }
}

export function renderHighlightsForPage(pageNum) {
    const pageEl = document.getElementById('page-' + pageNum);
    if (!pageEl) return;
    pageEl.querySelectorAll('.highlight-mark').forEach(el => el.remove());

    const results = state.searchResultsByPage[pageNum];
    if (!results) return;

    const fragment = document.createDocumentFragment();
    results.forEach(({ result, globalIndex }) => {
        if (result.x === null) return;
        const mark = document.createElement('div');
        mark.className = 'highlight-mark' + (globalIndex === state.currentMatchIndex ? ' current' : '');
        mark.style.left = (result.x * state.currentScale) + 'px';
        mark.style.top = (result.y * state.currentScale) + 'px';
        mark.style.width = (result.width * state.currentScale) + 'px';
        mark.style.height = (result.height * state.currentScale) + 'px';
        fragment.appendChild(mark);
    });
    pageEl.appendChild(fragment);
}

export function clearHighlights() {
    dom.viewer.querySelectorAll('.highlight-mark').forEach(el => el.remove());
}

function buildSearchResultsByPage() {
    const byPage = {};
    state.searchResults.forEach((r, i) => {
        if (!byPage[r.page]) byPage[r.page] = [];
        byPage[r.page].push({ result: r, globalIndex: i });
    });
    state.searchResultsByPage = byPage;
}

export function renderPageHeatmaps() {}
