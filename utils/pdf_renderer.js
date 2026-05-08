// ========== PDF RENDERER ==========

window.pageHeights = {};
window.renderedPages = new Set();
window.renderedScales = {};
window.bgRenderQueue = [];
window.pageObserver = null;
window.renderPageDebounce = null;
window.bgRenderRunning = false;
window.zoomRenderTask = null;

window.setupVirtualPages = async function() {
    window.viewer.innerHTML = '';
    window.pageHeights = {};
    window.renderedPages.clear();
    window.renderedScales = {};

    if (window.pageObserver) {
        window.pageObserver.disconnect();
        window.pageObserver = null;
    }

    const pagePromises = [];
    for (let i = 1; i <= window.totalPages; i++) {
        pagePromises.push(window.pdfDoc.getPage(i));
    }
    const pages = await Promise.all(pagePromises);

    const placeholders = [];
    for (let i = 0; i < pages.length; i++) {
        const pageNum = i + 1;
        const page = pages[i];
        const viewport = page.getViewport({ scale: 1.0 });
        window.pageHeights[pageNum] = viewport.height;

        const placeholder = document.createElement('div');
        placeholder.className = 'page-placeholder';
        placeholder.id = 'page-' + pageNum;
        placeholder.dataset.pageNum = pageNum;
        // Set CSS custom properties for responsive sizing via --pdf-scale
        placeholder.style.setProperty('--base-w', viewport.width);
        placeholder.style.setProperty('--base-h', viewport.height);
        placeholder.textContent = `Page ${pageNum}`;
        placeholders.push(placeholder);
    }

    for (const p of placeholders) {
        window.viewer.appendChild(p);
    }

    window.setupPageObserver();
};

window.setupPageObserver = function() {
    if (window.pageObserver) {
        window.pageObserver.disconnect();
    }

    window.pageObserver = new IntersectionObserver((entries) => {
        if (window.renderPageDebounce) return;

        const pagesToRender = [];
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const pageNum = parseInt(entry.target.dataset.pageNum);
                if (pageNum && !window.isPageRendered(pageNum)) {
                    pagesToRender.push(pageNum);
                }
            }
        });

        if (pagesToRender.length === 0) return;

        window.renderPageDebounce = setTimeout(() => {
            window.renderPageDebounce = null;
            if (pagesToRender.length <= 3) {
                pagesToRender.forEach(p => window.renderPageNow(p));
            } else {
                const mid = Math.floor(pagesToRender.length / 2);
                pagesToRender.slice(0, mid).forEach(p => window.renderPageNow(p));
                setTimeout(() => {
                    pagesToRender.slice(mid).forEach(p => window.renderPageNow(p));
                }, 50);
            }
        }, 20);
    }, { root: window.viewerScroll, rootMargin: "500px" });

    document.querySelectorAll('[id^="page-"]').forEach(el => {
        window.pageObserver.observe(el);
    });
};

window.startBgRender = function() {
    if (!window.pdfDoc) return;

    // Cancel any existing render queue
    window.cancelBgRender();
    window.bgRenderRunning = true;

    window.bgRenderQueue = [];
    for (let i = 1; i <= window.totalPages; i++) {
        if (!window.isPageRendered(i)) {
            window.bgRenderQueue.push(i);
        }
    }

    // Also render first page immediately if not rendered
    if (!window.isPageRendered(1)) {
        window.renderPageNow(1);
    }

    window.renderNextBg();
};

window.renderNextBg = async function() {
    if (!window.bgRenderQueue.length) {
        window.bgRenderRunning = false;
        return;
    }

    const pageNum = window.bgRenderQueue.shift();

    if (!window.isPageRendered(pageNum)) {
        await window.renderPageNow(pageNum);
    }

    requestAnimationFrame(window.renderNextBg);
};

window.cancelBgRender = function() {
    window.bgRenderQueue = [];
    window.bgRenderRunning = false;
};

window.isPageRendered = function(pageNum) {
    return window.renderedPages.has(pageNum);
};

window.renderPageNow = async function(pageNum, forceScale = null) {
    const renderScale = forceScale || window.currentScale;
    const dpr = window.devicePixelRatio || 1;
    const effectiveScale = renderScale * dpr;

    if (window.renderedPages.has(pageNum) && !forceScale) {
        return;
    }

    if (!window.pdfDoc) return;

    try {
        const page = await window.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: effectiveScale });

        const el = document.getElementById('page-' + pageNum);
        if (!el) return;

        const displayWidth = viewport.width / dpr;
        const displayHeight = viewport.height / dpr;

        el.className = 'pdf-page';
        el.innerHTML = '<div class="page-loading"><div class="spinner"></div>Loading...</div>';
        // Set CSS custom properties for responsive sizing via --pdf-scale
        const vp1 = page.getViewport({ scale: 1.0 });
        el.style.setProperty('--base-w', vp1.width);
        el.style.setProperty('--base-h', vp1.height);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        canvas.dataset.scale = renderScale;

        // Use cached text if available from file processing
        if (!window.textPageCache[pageNum]) {
            const textContent = await page.getTextContent();
            let pageText = '';
            const textItems = [];
            for (const item of textContent.items) {
                pageText += item.str;
                textItems.push({
                    text: item.str,
                    transform: item.transform,
                    width: item.width,
                    height: item.height
                });
            }
            window.textPageCache[pageNum] = { text: pageText, viewport: vp1, items: textItems };
            window.pageHeights[pageNum] = vp1.height;
        }

        await page.render({ canvasContext: ctx, viewport: viewport }).promise;

        // Now mark as rendered after successful render
        window.renderedPages.add(pageNum);
        window.renderedScales[pageNum] = Math.max(window.renderedScales[pageNum] || 0, renderScale);

        const existingCanvas = el.querySelector('canvas');
        if (existingCanvas) {
            existingCanvas.remove();
        }
        el.innerHTML = '';
        el.appendChild(canvas);

        // Create text layer for text selection
        const existingTextLayer = el.querySelector('.textLayer');
        if (existingTextLayer) {
            existingTextLayer.remove();
        }

        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';

        const textContent = window.textPageCache[pageNum];
        if (textContent && textContent.items) {
            for (const item of textContent.items) {
                const span = document.createElement('span');
                span.textContent = item.text;

                const transform = item.transform;
                const scale = renderScale;

                const x = transform[4] * scale;
                const y = transform[5] * scale;
                const fontSize = Math.sqrt(transform[0]*transform[0] + transform[1]*transform[1]) * scale;

                span.style.position = 'absolute';
                span.style.left = x + 'px';
                span.style.top = (displayHeight - y - fontSize) + 'px';
                span.style.fontSize = fontSize + 'px';
                span.style.fontFamily = 'sans-serif';
                span.style.whiteSpace = 'pre';
                span.style.color = 'transparent';

                textLayer.appendChild(span);
            }
        }

        el.style.position = 'relative';
        el.appendChild(textLayer);

        if (window.searchResults.length > 0) {
            window.renderHighlightsForPage(pageNum);
        }
    } catch (err) {
        window.renderedPages.delete(pageNum);
        if (err.name !== 'RenderingCancelledException') {
            console.warn('Render error:', err.message);
        }
    }
};

// ========== ZOOM ==========

window.setZoom = function(newScale, force = false) {
    const clampedScale = Math.max(0.5, Math.min(4.0, newScale));
    if (clampedScale === window.currentScale && !force) return;

    const oldScrollTop = window.viewerScroll.scrollTop;
    const oldScrollHeight = window.viewerScroll.scrollHeight;

    window.currentScale = clampedScale;
    window.updateZoomDisplay();

    // Use CSS custom property for scale - this avoids DOM thrashing
    document.documentElement.style.setProperty('--pdf-scale', clampedScale);

    // Only resize canvases for rendered pages (they are bitmaps that need re-rendering)
    for (let i = 1; i <= window.totalPages; i++) {
        const el = document.getElementById('page-' + i);
        if (!el) continue;
        const canvas = el.querySelector('canvas');
        if (!canvas) continue;
        const baseH = window.pageHeights[i] || 800;
        const cached = window.textPageCache[i];
        const baseW = cached ? cached.viewport.width : 600;
        canvas.style.width = (baseW * clampedScale) + 'px';
        canvas.style.height = (baseH * clampedScale) + 'px';
    }

    window.renderedPages.clear();
    window.renderedScales = {};

    requestAnimationFrame(() => {
        const newScrollHeight = window.viewerScroll.scrollHeight;
        const anchorFraction = oldScrollHeight > 0 ? oldScrollTop / oldScrollHeight : 0;
        const newScrollTop = anchorFraction * newScrollHeight;
        window.viewerScroll.scrollTop = newScrollTop + 30;

        window.clearHighlights();
        if (window.pageObserver) {
            window.pageObserver.disconnect();
            window.setupPageObserver();
        }
        if (window.searchResults.length > 0) {
            window.renderAllHighlights();
        }
        window.updateHeatmap();
    });
};

window.startPrerender = async function() {
    if (window.searchResults.length === 0) return;

    const pagesWithMatches = [...new Set(window.searchResults.map(r => r.page))];

    for (const pageNum of pagesWithMatches) {
        if (!window.isPageRendered(pageNum)) {
            await window.renderPageNow(pageNum);
        }
    }
};