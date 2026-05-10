import { state } from './state.js';
import * as dom from './dom.js';
import { fn } from './cross.js';

state.pageHeights = {};
state.renderedPages = new Set();
state.renderedScales = {};
state.bgRenderQueue = [];
state.bgRenderRunning = false;
state.zoomRenderTask = null;
state.pageObserver = null;
state.renderPageDebounce = null;

export async function setupVirtualPages() {
    dom.viewer.innerHTML = '';
    state.pageHeights = {};
    state.renderedPages.clear();
    state.renderedScales = {};

    if (state.pageObserver) {
        state.pageObserver.disconnect();
        state.pageObserver = null;
    }

    const pagePromises = [];
    for (let i = 1; i <= state.totalPages; i++) {
        pagePromises.push(state.pdfDoc.getPage(i));
    }
    const pages = await Promise.all(pagePromises);

    for (let i = 0; i < pages.length; i++) {
        const pageNum = i + 1;
        const page = pages[i];
        const viewport = page.getViewport({ scale: 1.0 });
        state.pageHeights[pageNum] = viewport.height;

        const placeholder = document.createElement('div');
        placeholder.className = 'page-placeholder';
        placeholder.id = 'page-' + pageNum;
        placeholder.dataset.pageNum = pageNum;
        placeholder.style.setProperty('--base-w', viewport.width);
        placeholder.style.setProperty('--base-h', viewport.height);
        placeholder.textContent = 'Page ' + pageNum;
        dom.viewer.appendChild(placeholder);
    }

    setupPageObserver();
}

function setupPageObserver() {
    if (state.pageObserver) state.pageObserver.disconnect();

    state.pageObserver = new IntersectionObserver((entries) => {
        if (state.renderPageDebounce) return;

        const pagesToRender = [];
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const pageNum = parseInt(entry.target.dataset.pageNum);
                if (pageNum && !isPageRendered(pageNum)) pagesToRender.push(pageNum);
            }
        });

        if (pagesToRender.length === 0) return;

        state.renderPageDebounce = setTimeout(() => {
            state.renderPageDebounce = null;
            if (pagesToRender.length <= 3) {
                pagesToRender.forEach(p => renderPageNow(p));
            } else {
                const mid = Math.floor(pagesToRender.length / 2);
                pagesToRender.slice(0, mid).forEach(p => renderPageNow(p));
                setTimeout(() => pagesToRender.slice(mid).forEach(p => renderPageNow(p)), 50);
            }
        }, 20);
    }, { root: dom.viewerScroll, rootMargin: '500px' });

    document.querySelectorAll('[id^="page-"]').forEach(el => state.pageObserver.observe(el));
}

export function startBgRender() {
    if (!state.pdfDoc) return;
    cancelBgRender();
    state.bgRenderRunning = true;

    state.bgRenderQueue = [];
    for (let i = 1; i <= state.totalPages; i++) {
        if (!isPageRendered(i)) state.bgRenderQueue.push(i);
    }

    if (!isPageRendered(1)) renderPageNow(1);
    renderNextBg();
}

async function renderNextBg() {
    if (!state.bgRenderQueue.length) {
        state.bgRenderRunning = false;
        return;
    }

    const pageNum = state.bgRenderQueue.shift();
    if (!isPageRendered(pageNum)) await renderPageNow(pageNum);
    requestAnimationFrame(renderNextBg);
}

export function cancelBgRender() {
    state.bgRenderQueue = [];
    state.bgRenderRunning = false;
}

export function isPageRendered(pageNum) {
    return state.renderedPages.has(pageNum);
}

export async function renderPageNow(pageNum, forceScale = null) {
    const renderScale = forceScale || state.currentScale;
    const dpr = window.devicePixelRatio || 1;
    const effectiveScale = renderScale * dpr;

    if (state.renderedPages.has(pageNum) && !forceScale) return;
    if (!state.pdfDoc) return;

    try {
        const page = await state.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: effectiveScale });

        const el = document.getElementById('page-' + pageNum);
        if (!el) return;

        const displayWidth = viewport.width / dpr;
        const displayHeight = viewport.height / dpr;

        el.className = 'pdf-page';
        el.innerHTML = '<div class="page-loading"><div class="spinner"></div>Loading...</div>';
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

        if (!state.textPageCache[pageNum]) {
            const textContent = await page.getTextContent();
            let pageText = '';
            const textItems = [];
            for (const item of textContent.items) {
                pageText += item.str;
                textItems.push({ text: item.str, transform: item.transform, width: item.width, height: item.height });
            }
            state.textPageCache[pageNum] = { text: pageText, viewport: vp1, items: textItems };
            state.pageHeights[pageNum] = vp1.height;
        }

        await page.render({ canvasContext: ctx, viewport: viewport }).promise;

        state.renderedPages.add(pageNum);
        state.renderedScales[pageNum] = Math.max(state.renderedScales[pageNum] || 0, renderScale);

        const existingCanvas = el.querySelector('canvas');
        if (existingCanvas) existingCanvas.remove();
        el.innerHTML = '';
        el.appendChild(canvas);

        const existingTextLayer = el.querySelector('.textLayer');
        if (existingTextLayer) existingTextLayer.remove();

        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';

        const textContent = state.textPageCache[pageNum];
        if (textContent && textContent.items) {
            for (const item of textContent.items) {
                const span = document.createElement('span');
                span.textContent = item.text;
                const transform = item.transform;
                const scale = renderScale;
                const x = transform[4] * scale;
                const y = transform[5] * scale;
                const fontSize = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1]) * scale;

                span.style.cssText = 'position:absolute;left:' + x + 'px;top:' + (displayHeight - y - fontSize) + 'px;font-size:' + fontSize + 'px;font-family:sans-serif;white-space:pre;color:transparent';
                textLayer.appendChild(span);
            }
        }

        el.style.position = 'relative';
        el.appendChild(textLayer);

        if (state.searchResults.length > 0) fn.renderHighlightsForPage(pageNum);
    } catch (err) {
        state.renderedPages.delete(pageNum);
        if (err.name !== 'RenderingCancelledException') console.warn('Render error:', err.message);
    }
}

export function setZoom(newScale, force = false) {
    const clampedScale = Math.max(0.5, Math.min(4.0, newScale));
    if (clampedScale === state.currentScale && !force) return;

    const oldScrollTop = dom.viewerScroll.scrollTop;
    const oldScrollHeight = dom.viewerScroll.scrollHeight;

    state.currentScale = clampedScale;
    fn.updateZoomDisplay();

    document.documentElement.style.setProperty('--pdf-scale', clampedScale);

    for (let i = 1; i <= state.totalPages; i++) {
        const el = document.getElementById('page-' + i);
        if (!el) continue;
        const canvas = el.querySelector('canvas');
        if (!canvas) continue;
        const baseH = state.pageHeights[i] || 800;
        const cached = state.textPageCache[i];
        const baseW = cached ? cached.viewport.width : 600;
        canvas.style.width = (baseW * clampedScale) + 'px';
        canvas.style.height = (baseH * clampedScale) + 'px';
    }

    state.renderedPages.clear();
    state.renderedScales = {};

    requestAnimationFrame(() => {
        const newScrollHeight = dom.viewerScroll.scrollHeight;
        const anchorFraction = oldScrollHeight > 0 ? oldScrollTop / oldScrollHeight : 0;
        dom.viewerScroll.scrollTop = anchorFraction * newScrollHeight + 30;

        fn.clearHighlights();
        if (state.pageObserver) {
            state.pageObserver.disconnect();
            setupPageObserver();
        }
        if (state.searchResults.length > 0) fn.renderAllHighlights();
        fn.renderPageHeatmaps();
    });
}

export async function startPrerender() {
    if (state.searchResults.length === 0) return;

    const pagesWithMatches = [...new Set(state.searchResults.map(r => r.page))];

    for (const pageNum of pagesWithMatches) {
        if (!isPageRendered(pageNum)) await renderPageNow(pageNum);
    }
}
