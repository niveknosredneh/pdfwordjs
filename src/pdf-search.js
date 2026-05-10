import { state } from './state.js';
import * as dom from './dom.js';
import { getKeywordRegex } from './keyword-regex.js';
import { fn } from './cross.js';

state.searchResults = [];
state.currentMatchIndex = -1;
state.searchCache = {};
state.textPageCache = {};

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
        if (!textItems) continue;

        let match;
        while ((match = combinedRegex.exec(pageText)) !== null) {
            if (match[0].length < 3) continue;
            if (!/[a-zA-Z]/.test(match[0])) continue;
            const lower = match[0].toLowerCase();
            const canonical = (window.KEYWORDS || []).find(k => k.toLowerCase() === lower) || lower;

            if (state.searchCache[canonical] === undefined) state.searchCache[canonical] = [];

            const matchStart = match.index;
            const matchEnd = match.index + match[0].length;
            let charOffset = 0;
            let startItem = null, endItem = null;
            let startItemCharStart = 0, endItemCharStart = 0;

            for (const item of textItems) {
                const itemStart = charOffset;
                const itemEnd = charOffset + item.text.length;

                if (!startItem && matchStart >= itemStart && matchStart < itemEnd) {
                    startItem = item;
                    startItemCharStart = itemStart;
                }
                if (startItem && matchEnd > itemStart && matchEnd <= itemEnd) {
                    endItem = item;
                    endItemCharStart = itemStart;
                    break;
                }
                charOffset = itemEnd;
            }

            if (startItem) {
                const startCharFrac = startItem.text.length > 0 ? (matchStart - startItemCharStart) / startItem.text.length : 0;
                const sx = startItem.transform[4] + startCharFrac * startItem.width;
                const sy = viewport.height - (startItem.transform[5] + startItem.height);
                const ei = endItem || startItem;
                const eiCharStart = endItem ? endItemCharStart : startItemCharStart;
                const endCharFrac = ei.text.length > 0 ? (matchEnd - eiCharStart) / ei.text.length : 1;
                const endX = ei.transform[4] + endCharFrac * ei.width;

                state.searchCache[canonical].push({
                    page: pageNum, x: sx, y: sy,
                    width: Math.max(endX - sx, 4), height: startItem.height
                });
            }
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
        if (!textItems) continue;

        let match;
        while ((match = localRegex.exec(pageText)) !== null) {
            if (match[0].length < 3) continue;
            if (!/[a-zA-Z]/.test(match[0])) continue;
            const matchStart = match.index;
            const matchEnd = match.index + match[0].length;
            let charOffset = 0;
            let startItem = null, endItem = null;
            let startItemCharStart = 0, endItemCharStart = 0;

            for (const item of textItems) {
                const itemStart = charOffset;
                const itemEnd = charOffset + item.text.length;
                if (!startItem && matchStart >= itemStart && matchStart < itemEnd) {
                    startItem = item;
                    startItemCharStart = itemStart;
                }
                if (startItem && matchEnd > itemStart && matchEnd <= itemEnd) {
                    endItem = item;
                    endItemCharStart = itemStart;
                    break;
                }
                charOffset = itemEnd;
            }

            if (startItem) {
                const startCharFrac = startItem.text.length > 0 ? (matchStart - startItemCharStart) / startItem.text.length : 0;
                const sx = startItem.transform[4] + startCharFrac * startItem.width;
                const sy = viewport.height - (startItem.transform[5] + startItem.height);
                const ei = endItem || startItem;
                const eiCharStart = endItem ? endItemCharStart : startItemCharStart;
                const endCharFrac = ei.text.length > 0 ? (matchEnd - eiCharStart) / ei.text.length : 1;
                const endX = ei.transform[4] + endCharFrac * ei.width;

                results.push({
                    page: pageNum, x: sx, y: sy,
                    width: Math.max(endX - sx, 4), height: startItem.height
                });
            }
        }
    }

    state.searchCache[query] = results;
}

export async function fetchPageItems(pageNum) {
    if (!state.pdfDoc) return null;
    const cached = state.textPageCache[pageNum];
    if (!cached || cached.items) return cached?.items;

    const page = await state.pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
        items.push({ text: item.str, transform: item.transform, width: item.width, height: item.height });
    }
    cached.items = items;
    return items;
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

    const pageFragments = {};

    for (let i = 0; i < state.searchResults.length; i++) {
        const result = state.searchResults[i];
        const pageKey = 'page-' + result.page;

        if (!pageFragments[pageKey]) {
            const pageEl = document.getElementById(pageKey);
            if (!pageEl) continue;
            pageFragments[pageKey] = { el: pageEl, fragment: document.createDocumentFragment() };
        }

        const mark = document.createElement('div');
        mark.className = 'highlight-mark' + (i === state.currentMatchIndex ? ' current' : '');
        mark.style.left = (result.x * state.currentScale) + 'px';
        mark.style.top = (result.y * state.currentScale) + 'px';
        mark.style.width = (result.width * state.currentScale) + 'px';
        mark.style.height = (result.height * state.currentScale) + 'px';

        pageFragments[pageKey].fragment.appendChild(mark);
    }

    for (const key in pageFragments) {
        pageFragments[key].el.appendChild(pageFragments[key].fragment);
    }
}

export function renderHighlightsForPage(pageNum) {
    const pageEl = document.getElementById('page-' + pageNum);
    if (!pageEl) return;

    const fragment = document.createDocumentFragment();

    state.searchResults.forEach((result, index) => {
        if (result.page === pageNum) {
            const mark = document.createElement('div');
            mark.className = 'highlight-mark' + (index === state.currentMatchIndex ? ' current' : '');
            mark.style.left = (result.x * state.currentScale) + 'px';
            mark.style.top = (result.y * state.currentScale) + 'px';
            mark.style.width = (result.width * state.currentScale) + 'px';
            mark.style.height = (result.height * state.currentScale) + 'px';
            fragment.appendChild(mark);
        }
    });

    pageEl.appendChild(fragment);
}

export function clearHighlights() {
    dom.viewer.querySelectorAll('.highlight-mark').forEach(el => el.remove());
}

export function renderPageHeatmaps() {
    const container = dom.viewer.querySelector('.heatmap-canvas-container');
    if (!container) return;
    container.querySelectorAll('canvas').forEach(c => c.remove());

    const allKeywords = Object.keys(state.searchCache).filter(k => !k.startsWith('_'));
    if (allKeywords.length === 0) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'heatmap-canvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;opacity:0.3';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    allKeywords.forEach((keyword, ki) => {
        const results = state.searchCache[keyword] || [];
        if (results.length === 0) return;
        const hue = (ki / allKeywords.length) * 360;
        ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.4)`;
        results.forEach(r => {
            ctx.fillRect(r.x * state.currentScale, r.y * state.currentScale, r.width * state.currentScale, r.height * state.currentScale);
        });
    });

    container.appendChild(canvas);
}
