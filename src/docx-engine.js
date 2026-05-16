import { state } from './state.js';
import * as dom from './dom.js';
import { getKeywordRegex } from './keyword-regex.js';
import { fn } from './cross.js';

state.searchCache = {};
state.docSearchResults = [];
state.docCurrentMatchIndex = -1;
state.docOriginalHtml = null;

export function loadDocxDoc(fileUrl, keyword = '') {
    if (state.currentDocUrl === fileUrl && state.docContentCache[fileUrl]) {
        if (keyword) cycleDocSearch(keyword);
        return;
    }

    fn.cancelBgRender();
    state.currentDocUrl = fileUrl;
    const cachedInfo = state.docContentCache[fileUrl];
    state.currentDocType = cachedInfo?.type || getDocTypeFromUrl(fileUrl);

    dom.loader.style.display = 'flex';
    dom.loaderFilename.textContent = 'Loading document...';
    dom.loaderStatus.textContent = 'Parsing...';
    dom.loaderProgressFill.style.width = '30%';
    dom.viewer.innerHTML = '';
    fn.clearSearch();
    state.textPageCache = {};

    (async () => {
        try {
            let cached = state.docContentCache[fileUrl];
            if (!cached) {
                dom.loaderFilename.textContent = 'Re-scanning DOCX...';
                const blobUrl = state.objectUrls.find(url => url === fileUrl);
                if (blobUrl) {
                    const response = await fetch(blobUrl);
                    const arrayBuffer = await response.arrayBuffer();
                    const fileName = state.docDataCache[fileUrl]?.name || 'Document';
                    await fn.extractDocText(arrayBuffer, fileName, fileUrl, null);
                    cached = state.docContentCache[fileUrl];
                }
            }
            if (!cached) throw new Error('Document not found in cache');
            cached._lastAccess = Date.now();

            dom.loaderProgressFill.style.width = '70%';
            dom.loaderStatus.textContent = 'Rendering...';

            renderDocContent(cached.html, cached.text);
            dom.loaderProgressFill.style.width = '100%';
            dom.loader.style.display = 'none';

            state.totalPages = 1;
            state.currentPage = 1;

            fn.updatePageInfo();
            fn.updateZoomDisplay();
            dom.pageInput.max = 1;
            dom.pageTotal.textContent = '1';

            startDocSearchComputation();

            if (keyword) cycleDocSearch(keyword);
        } catch (err) {
            dom.loaderFilename.textContent = 'Error loading document';
            dom.loaderStatus.textContent = err.message;
            dom.loaderProgressFill.style.width = '0%';
            console.error('Document load error:', err);
        }
    })();
}

function renderDocContent(html, plainText) {
    dom.viewer.innerHTML = '';
    state.textPageCache[1] = { text: plainText, viewport: { width: 800, height: 600 }, items: [] };

    if (!html) {
        dom.viewer.innerHTML = '<div style="padding:20px;">No content to display</div>';
        return;
    }

    state.docOriginalHtml = html;

    const container = document.createElement('div');
    container.className = 'doc-viewer';
    container.style.cssText = 'width:100%;max-width:800px;margin:0 auto;padding:20px;box-sizing:border-box;font-family:Times New Roman, serif;font-size:12pt;line-height:1.6;background:white;color:black;position:relative';
    container.innerHTML = html;

    container.querySelectorAll('table').forEach(table => {
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';
    });
    container.querySelectorAll('td, th').forEach(cell => {
        cell.style.border = '1px solid #000';
        cell.style.padding = '4px';
    });

    dom.viewer.appendChild(container);
}

function startDocSearchComputation() {
    const cached = state.docContentCache[state.currentDocUrl];
    if (!cached) return;

    const combinedRegex = getKeywordRegex(window.KEYWORDS);
    const text = cached.text;
    const results = [];
    let match;

    while ((match = combinedRegex.exec(text)) !== null) {
        if (match[0].length < 3) continue;
        if (!/[a-zA-Z]/.test(match[0])) continue;
        results.push({ index: match.index, text: match[0], length: match[0].length });
    }

    const counts = {};
    results.forEach(r => {
        const lower = r.text.toLowerCase();
        const key = (window.KEYWORDS || []).find(k => k.toLowerCase() === lower) || lower;
        counts[key] = (counts[key] || 0) + 1;
    });

    state.searchCache._docCounts = counts;
    state.searchCache._docResults = results;
    fn.populateKeywordSelect();
}

export function performDocSearch(query) {
    if (!state.currentDocUrl || !state.docContentCache[state.currentDocUrl]) return;

    const cached = state.docContentCache[state.currentDocUrl];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const localRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const text = cached.text;
    const results = [];
    let match;

    while ((match = localRegex.exec(text)) !== null) {
        results.push({ index: match.index, text: match[0], length: match[0].length });
    }

    state.docSearchResults = results;
    state.docCurrentMatchIndex = 0;

    if (results.length > 0) {
        dom.navGroup.classList.add('active');
        dom.navSep.style.display = '';
        dom.matchTotal.textContent = results.length;
        dom.matchInput.max = results.length;
        dom.matchInput.value = 1;
        renderDocHighlights();
        fn.updateSidebarBadge();
        goToDocMatch(0);
    } else {
        dom.navGroup.classList.remove('active');
        dom.navSep.style.display = '';
        dom.matchTotal.textContent = '0';
        dom.matchInput.value = '';
    }
}

export function cycleDocSearch(query) {
    if (!state.currentDocUrl || !state.docContentCache[state.currentDocUrl]) return;

    const cached = state.docContentCache[state.currentDocUrl];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const localRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const text = cached.text;
    const results = [];
    let match;

    while ((match = localRegex.exec(text)) !== null) {
        results.push({ index: match.index, text: match[0], length: match[0].length });
    }

    if (results.length === 0) return;

    const wasSameQuery = state.docSearchResults.length > 0 && state.docContentCache[state.currentDocUrl]?.lastQuery === query;
    state.docCurrentMatchIndex = (!wasSameQuery) ? 0 : (state.docCurrentMatchIndex + 1) % results.length;
    if (state.docContentCache[state.currentDocUrl]) state.docContentCache[state.currentDocUrl].lastQuery = query;

    state.docSearchResults = results;

    dom.navGroup.classList.add('active');
    dom.navSep.style.display = '';
    dom.matchTotal.textContent = results.length;
    dom.matchInput.max = results.length;
    dom.matchInput.value = state.docCurrentMatchIndex + 1;
    renderDocHighlights();
    fn.updateSidebarBadge();
}

export function renderDocHighlights() {
    const container = dom.viewer.querySelector('.doc-viewer');
    if (!container || !state.docOriginalHtml) return;

    container.innerHTML = state.docOriginalHtml;

    if (!state.docSearchResults.length) return;

    const currentResult = state.docSearchResults[state.docCurrentMatchIndex];
    if (!currentResult) return;

    const plainText = state.docContentCache[state.currentDocUrl]?.text || '';
    const matchText = plainText.substring(currentResult.index, currentResult.index + currentResult.length);
    const escapedMatch = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedMatch, 'gi');

    let matchCount = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, null);
    const nodes = [];
    let node;
    while (node = walker.nextNode()) nodes.push(node);

    for (const textNode of nodes) {
        if (searchRegex.test(textNode.textContent)) {
            searchRegex.lastIndex = 0;
            const span = document.createElement('span');
            span.innerHTML = textNode.textContent.replace(searchRegex, match => {
                const isCurrent = (matchCount === state.docCurrentMatchIndex);
                matchCount++;
                return `<mark class="doc-highlight${isCurrent ? ' current' : ''}">${match}</mark>`;
            });
            textNode.parentNode.replaceChild(span, textNode);
        }
    }

    const currentMark = container.querySelector('.doc-highlight.current');
    if (currentMark) {
        currentMark.scrollIntoView({ behavior: state.smoothScrollEnabled ? 'smooth' : 'auto', block: 'center' });
    }
}

export function goToDocMatch(index) {
    if (!state.docSearchResults.length) return;

    state.docCurrentMatchIndex = ((index % state.docSearchResults.length) + state.docSearchResults.length) % state.docSearchResults.length;
    dom.matchInput.value = state.docCurrentMatchIndex + 1;
    fn.updateSidebarBadge();

    const result = state.docSearchResults[state.docCurrentMatchIndex];
    const plainText = state.docContentCache[state.currentDocUrl]?.text || '';
    const textLen = plainText.length;
    const targetFraction = result.index / textLen;
    const scrollHeight = dom.viewerScroll.scrollHeight - dom.viewerScroll.clientHeight;
    const targetTop = scrollHeight * targetFraction;

    dom.viewerScroll.scrollTo({ top: Math.max(0, targetTop), behavior: state.smoothScrollEnabled ? 'smooth' : 'auto' });
    renderDocHighlights();
}

function getDocTypeFromUrl(url) {
    const dataCached = state.docDataCache[url];
    if (dataCached?.type) return dataCached.type;
    if (dataCached?.name) return getFileTypeSimple(dataCached.name);
    if (state.docContentCache[url]?.type) return state.docContentCache[url].type;
    if (url.includes('.pdf')) return 'pdf';
    if (url.includes('.docx')) return 'docx';
    if (url.includes('.doc')) return 'doc';
    return null;
}

function getFileTypeSimple(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.docx')) return 'docx';
    if (lower.endsWith('.doc')) return 'doc';
    return null;
}
