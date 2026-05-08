// ========== PDF SEARCH ==========

window.searchResults = [];
window.currentMatchIndex = -1;
window.searchCache = {};
window.textPageCache = {};

window.precomputeAllSearches = async function() {
    if (window.searchCache._deduplicated) return;

    const combinedRegex = window.getKeywordRegex(window.KEYWORDS);

    for (let pageNum = 1; pageNum <= window.totalPages; pageNum++) {
        const cached = window.textPageCache[pageNum];
        if (!cached) continue;

        const pageText = cached.text;
        const viewport = cached.viewport;

        if (!cached.items) {
            await window.fetchPageItems(pageNum);
        }
        const textItems = cached.items;
        if (!textItems) continue;

        let match;
        while ((match = combinedRegex.exec(pageText)) !== null) {
            if (match[0].length < 3) continue;
            if (!/[a-zA-Z]/.test(match[0])) continue;
            const lower = match[0].toLowerCase();
            const canonical = window.KEYWORDS.find(k => k.toLowerCase() === lower) || lower;

            if (window.searchCache[canonical] === undefined) {
                window.searchCache[canonical] = [];
            }

            const matchStart = match.index;
            const matchEnd   = match.index + match[0].length;

            let charOffset = 0;
            let startItem = null, endItem = null;
            let startItemCharStart = 0, endItemCharStart = 0;

            for (const item of textItems) {
                const itemStart = charOffset;
                const itemEnd   = charOffset + item.text.length;

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
                const startCharFrac = startItem.text.length > 0
                    ? (matchStart - startItemCharStart) / startItem.text.length : 0;
                const sx = startItem.transform[4] + startCharFrac * startItem.width;

                const sy = viewport.height - (startItem.transform[5] + startItem.height);

                const ei = endItem || startItem;
                const eiCharStart = endItem ? endItemCharStart : startItemCharStart;
                const endCharFrac = ei.text.length > 0
                    ? (matchEnd - eiCharStart) / ei.text.length : 1;
                const endX = ei.transform[4] + endCharFrac * ei.width;

                window.searchCache[canonical].push({
                    page: pageNum,
                    x: sx,
                    y: sy,
                    width: Math.max(endX - sx, 4),
                    height: startItem.height
                });
            }
        }
    }

    window.searchCache._deduplicated = true;
    window.populateKeywordSelect();
};

window.computeSearchForQuery = async function(query) {
    if (window.searchCache[query] !== undefined) return;

    if (window.searchCache._deduplicated) {
        return;
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const localRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const results = [];

    for (let pageNum = 1; pageNum <= window.totalPages; pageNum++) {
        const cached = window.textPageCache[pageNum];
        if (!cached) continue;

        const pageText = cached.text;
        const viewport = cached.viewport;

        if (!cached.items) {
            await window.fetchPageItems(pageNum);
        }
        const textItems = cached.items;
        if (!textItems) continue;

        let match;

        while ((match = localRegex.exec(pageText)) !== null) {
            if (match[0].length < 3) continue;
            if (!/[a-zA-Z]/.test(match[0])) continue;
            const matchStart = match.index;
            const matchEnd   = match.index + match[0].length;

            let charOffset = 0;
            let startItem = null, endItem = null;
            let startItemCharStart = 0, endItemCharStart = 0;

            for (const item of textItems) {
                const itemStart = charOffset;
                const itemEnd   = charOffset + item.text.length;

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
                const startCharFrac = startItem.text.length > 0
                    ? (matchStart - startItemCharStart) / startItem.text.length : 0;
                const sx = startItem.transform[4] + startCharFrac * startItem.width;

                const sy = viewport.height - (startItem.transform[5] + startItem.height);

                const ei = endItem || startItem;
                const eiCharStart = endItem ? endItemCharStart : startItemCharStart;
                const endCharFrac = ei.text.length > 0
                    ? (matchEnd - eiCharStart) / ei.text.length : 1;
                const endX = ei.transform[4] + endCharFrac * ei.width;

                results.push({
                    page: pageNum,
                    x: sx,
                    y: sy,
                    width: Math.max(endX - sx, 4),
                    height: startItem.height
                });
            }
        }
    }

    window.searchCache[query] = results;
};

window.fetchPageItems = async function(pageNum) {
    if (!window.pdfDoc) return null;
    const cached = window.textPageCache[pageNum];
    if (!cached || cached.items) return cached?.items;

    const page = await window.pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
        items.push({
            text: item.str,
            transform: item.transform,
            width: item.width,
            height: item.height
        });
    }
    cached.items = items;
    return items;
};

window.performSearch = async function(query) {
    if (!window.pdfDoc || !query) return;

    let canonicalQuery = query;
    if (window.searchCache[query] === undefined) {
        const lower = query.toLowerCase();
        const found = window.KEYWORDS.find(k => k.toLowerCase() === lower);
        if (found && window.searchCache[found] !== undefined) {
            canonicalQuery = found;
        }
    }

    if (window.searchCache[canonicalQuery] !== undefined) {
        window.searchResults = window.searchCache[canonicalQuery];
        window.activeKeyword = canonicalQuery;
        window.currentMatchIndex = 0;
        window.showSearchResults();
        return;
    }

    window.activeKeyword = canonicalQuery;
    window.currentMatchIndex = 0;
    window.clearHighlights();
    window.searchResults = [];

    await window.computeSearchForQuery(canonicalQuery);
    window.searchResults = window.searchCache[canonicalQuery] || [];

    window.showSearchResults();
};

window.showSearchResults = function() {
    if (window.searchResults.length > 0) {
        window.navGroup.classList.add('active');
        window.navSep.style.display = '';

        window.matchTotal.textContent = window.searchResults.length;
        window.matchInput.max = window.searchResults.length;
        window.matchInput.value = 1;
        window.currentMatchIndex = 0;
        window.renderAllHighlights();
        window.populateKeywordSelect();
        window.updateSidebarBadge();
        window.updateHeatmap();
        window.startPrerender();
        window.goToMatch(0);
    } else {
        window.navGroup.classList.remove('active');
        window.navSep.style.display = '';

        window.matchTotal.textContent = '0';
        window.matchInput.value = '';
        window.currentMatchIndex = -1;
        window.updateSidebarBadge();
        window.populateKeywordSelect();
        window.updateHeatmap();
    }
};

window.cycleSearch = function(query) {
    if (!window.pdfDoc || !query) return;

    if (window.searchCache[query] !== undefined) {
        window.searchResults = window.searchCache[query];
        window.activeKeyword = query;

        if (window.searchResults.length > 0) {
            window.navGroup.classList.add('active');
            window.navSep.style.display = '';
            window.currentMatchIndex = (window.currentMatchIndex + 1) % window.searchResults.length;
            window.matchTotal.textContent = window.searchResults.length;
            window.matchInput.max = window.searchResults.length;
            window.matchInput.value = window.currentMatchIndex + 1;
            window.renderAllHighlights();
            window.populateKeywordSelect();
            window.updateHeatmap();
            window.goToMatch(window.currentMatchIndex);
        } else {
            window.navGroup.classList.remove('active');
            window.navSep.style.display = 'none';

            window.matchTotal.textContent = '0';
            window.matchInput.value = '';
            window.populateKeywordSelect();
        }
        return;
    }

    window.performSearch(query);
};

window.renderAllHighlights = function() {
    window.clearHighlights();

    for (let i = 0; i < window.searchResults.length; i++) {
        window.renderHighlightMark(window.searchResults[i], i);
    }
};

window.renderHighlightsForPage = function(pageNum) {
    window.searchResults.forEach((result, index) => {
        if (result.page === pageNum) {
            window.renderHighlightMark(result, index);
        }
    });
};

window.renderHighlightMark = function(result, index) {
    const pageEl = document.getElementById('page-' + result.page);
    if (!pageEl) return;

    const mark = document.createElement('div');
    mark.className = 'highlight-mark' + (index === window.currentMatchIndex ? ' current' : '');
    mark.style.left = (result.x * window.currentScale) + 'px';
    mark.style.top = (result.y * window.currentScale) + 'px';
    mark.style.width = (result.width * window.currentScale) + 'px';
    mark.style.height = (result.height * window.currentScale) + 'px';

    pageEl.appendChild(mark);
};

window.clearHighlights = function() {
    window.viewer.querySelectorAll('.highlight-mark').forEach(el => el.remove());
};

window.updateHeatmap = function() {
    const container = window.viewer.querySelector('.heatmap-canvas-container');
    if (!container) return;
    container.querySelectorAll('canvas').forEach(c => c.remove());

    const allKeywords = Object.keys(window.searchCache).filter(k => !k.startsWith('_'));
    if (allKeywords.length === 0) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'heatmap-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.opacity = '0.3';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    allKeywords.forEach((keyword, ki) => {
        const results = window.searchCache[keyword] || [];
        if (results.length === 0) return;

        const hue = (ki / allKeywords.length) * 360;
        ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.4)`;

        results.forEach(r => {
            ctx.fillRect(
                r.x * window.currentScale,
                r.y * window.currentScale,
                r.width * window.currentScale,
                r.height * window.currentScale
            );
        });
    });

    container.appendChild(canvas);
};
