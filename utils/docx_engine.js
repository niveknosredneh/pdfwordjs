// ========== DOCX ENGINE ==========

window.searchCache = {};
window.docSearchResults = [];
window.docCurrentMatchIndex = -1;
window.docOriginalHtml = null;

window.loadDocxDoc = function(fileUrl, keyword = "") {
    if (window.currentDocUrl === fileUrl && window.docContentCache[fileUrl]) {
        if (keyword) {
            window.cycleDocSearch(keyword);
        }
        return;
    }

    window.cancelBgRender();
    window.currentDocUrl = fileUrl;
    const cachedInfo = window.docContentCache[fileUrl];
    window.currentDocType = cachedInfo?.type || window.getDocTypeFromUrl(fileUrl);

    window.loader.style.display = 'flex';
    window.loaderFilename.textContent = 'Loading document...';
    window.loaderStatus.textContent = 'Parsing...';
    window.loaderProgressFill.style.width = '30%';
    window.viewer.innerHTML = '';
    window.clearSearch();
    window.textPageCache = {};

    (async () => {
        try {
            let cached = window.docContentCache[fileUrl];
            if (!cached) {
                window.loaderFilename.textContent = 'Re-scanning DOCX...';
                const blobUrl = window.objectUrls.find(url => url === fileUrl);
                if (blobUrl) {
                    const response = await fetch(blobUrl);
                    const arrayBuffer = await response.arrayBuffer();
                    const fileName = window.docDataCache[fileUrl]?.name || 'Document';
                    await window.extractDocText(arrayBuffer, fileName, fileUrl, null);
                    cached = window.docContentCache[fileUrl];
                }
            }
            if (!cached) throw new Error('Document not found in cache');
            cached._lastAccess = Date.now();

            window.loaderProgressFill.style.width = '70%';
            window.loaderStatus.textContent = 'Rendering...';

            window.renderDocContent(cached.html, cached.text);
            window.loaderProgressFill.style.width = '100%';
            window.loader.style.display = 'none';

            window.totalPages = 1;
            window.currentPage = 1;

            window.updatePageInfo();
            window.updateZoomDisplay();
            window.pageInput.max = 1;
            window.pageTotal.textContent = '1';

            window.startDocSearchComputation();

            if (keyword) {
                window.cycleDocSearch(keyword);
            }
        } catch (err) {
            window.loaderFilename.textContent = 'Error loading document';
            window.loaderStatus.textContent = err.message;
            window.loaderProgressFill.style.width = '0%';
            console.error('Document load error:', err);
        }
    })();
};

window.renderDocContent = function(html, plainText) {
    window.viewer.innerHTML = '';
    window.textPageCache[1] = { text: plainText, viewport: { width: 800, height: 600 }, items: [] };

    if (!html) {
        window.viewer.innerHTML = '<div style="padding:20px;">No content to display</div>';
        return;
    }

    window.docOriginalHtml = html;

    const container = document.createElement('div');
    container.className = 'doc-viewer';
    container.style.width = '100%';
    container.style.maxWidth = '800px';
    container.style.margin = '0 auto';
    container.style.padding = '20px';
    container.style.boxSizing = 'border-box';
    container.style.fontFamily = 'Times New Roman, serif';
    container.style.fontSize = '12pt';
    container.style.lineHeight = '1.6';
    container.style.background = 'white';
    container.style.color = 'black';
    container.style.position = 'relative';
    container.innerHTML = html;

    container.querySelectorAll('table').forEach(table => {
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';
    });
    container.querySelectorAll('td, th').forEach(cell => {
        cell.style.border = '1px solid #000';
        cell.style.padding = '4px';
    });

    window.viewer.appendChild(container);
};

window.startDocSearchComputation = function() {
    const cached = window.docContentCache[window.currentDocUrl];
    if (!cached) return;

    const combinedRegex = window.getKeywordRegex(window.KEYWORDS);
    const text = cached.text;
    const results = [];
    let match;

    while ((match = combinedRegex.exec(text)) !== null) {
        if (match[0].length < 3) continue;
        if (!/[a-zA-Z]/.test(match[0])) continue;
        results.push({
            index: match.index,
            text: match[0],
            length: match[0].length
        });
    }

    const counts = {};
    results.forEach(r => {
        const lower = r.text.toLowerCase();
        const key = window.KEYWORDS.find(k => k.toLowerCase() === lower) || lower;
        counts[key] = (counts[key] || 0) + 1;
    });

    window.searchCache._docCounts = counts;
    window.searchCache._docResults = results;
    window.populateKeywordSelect();
};

window.performDocSearch = function(query) {
    if (!window.currentDocUrl || !window.docContentCache[window.currentDocUrl]) return;

    const cached = window.docContentCache[window.currentDocUrl];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const localRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const text = cached.text;
    const results = [];
    let match;

    while ((match = localRegex.exec(text)) !== null) {
        results.push({
            index: match.index,
            text: match[0],
            length: match[0].length
        });
    }

    window.docSearchResults = results;
    window.docCurrentMatchIndex = 0;

    if (results.length > 0) {
        window.navGroup.classList.add('active');
        window.navSep.style.display = '';
        window.matchTotal.textContent = results.length;
        window.matchInput.max = results.length;
        window.matchInput.value = 1;
        window.renderDocHighlights();
        window.updateSidebarBadge();
        window.goToDocMatch(0);
    } else {
        window.navGroup.classList.remove('active');
        window.navSep.style.display = '';
        window.matchTotal.textContent = '0';
        window.matchInput.value = '';
    }
};

window.cycleDocSearch = function(query) {
    if (!window.currentDocUrl || !window.docContentCache[window.currentDocUrl]) return;

    const cached = window.docContentCache[window.currentDocUrl];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const localRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const text = cached.text;
    const results = [];
    let match;

    while ((match = localRegex.exec(text)) !== null) {
        results.push({
            index: match.index,
            text: match[0],
            length: match[0].length
        });
    }

    if (results.length === 0) return;

    const wasSameQuery = (window.docSearchResults.length > 0 && window.docContentCache[window.currentDocUrl]?.lastQuery === query);
    if (!wasSameQuery) {
        window.docCurrentMatchIndex = 0;
    } else {
        window.docCurrentMatchIndex = (window.docCurrentMatchIndex + 1) % results.length;
    }
    window.docContentCache[window.currentDocUrl].lastQuery = query;

    window.docSearchResults = results;

    window.navGroup.classList.add('active');
    window.navSep.style.display = '';
    window.matchTotal.textContent = results.length;
    window.matchInput.max = results.length;
    window.matchInput.value = window.docCurrentMatchIndex + 1;
    window.renderDocHighlights();
    window.updateSidebarBadge();
};

window.renderDocHighlights = function() {
    const container = window.viewer.querySelector('.doc-viewer');
    if (!container || !window.docOriginalHtml) return;

    container.innerHTML = window.docOriginalHtml;

    if (!window.docSearchResults.length) return;

    const currentResult = window.docSearchResults[window.docCurrentMatchIndex];
    if (!currentResult) return;

    const plainText = window.docContentCache[window.currentDocUrl]?.text || '';
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
                const isCurrent = (matchCount === window.docCurrentMatchIndex);
                matchCount++;
                return `<mark class="doc-highlight${isCurrent ? ' current' : ''}">${match}</mark>`;
            });
            textNode.parentNode.replaceChild(span, textNode);
        }
    }

    const currentMark = container.querySelector('.doc-highlight.current');
    if (currentMark) {
        currentMark.scrollIntoView({ behavior: window.smoothScrollEnabled ? 'smooth' : 'auto', block: 'center' });
    }
};

window.goToDocMatch = function(index) {
    if (!window.docSearchResults.length) return;

    window.docCurrentMatchIndex = ((index % window.docSearchResults.length) + window.docSearchResults.length) % window.docSearchResults.length;
    window.matchInput.value = window.docCurrentMatchIndex + 1;
    window.updateSidebarBadge();

    const result = window.docSearchResults[window.docCurrentMatchIndex];
    const plainText = window.docContentCache[window.currentDocUrl]?.text || '';
    const textLen = plainText.length;
    const targetFraction = result.index / textLen;
    const scrollHeight = window.viewerScroll.scrollHeight - window.viewerScroll.clientHeight;
    const targetTop = scrollHeight * targetFraction;

    window.viewerScroll.scrollTo({ top: Math.max(0, targetTop), behavior: window.smoothScrollEnabled ? 'smooth' : 'auto' });

    window.renderDocHighlights();
};