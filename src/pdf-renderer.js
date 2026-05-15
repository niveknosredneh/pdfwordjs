import { state } from './state.js';
import * as dom from './dom.js';
import { fn } from './cross.js';

state.pageHeights = {};
state.renderedPages = new Set();
state.renderedScales = {};
state.zoomRenderTask = null;
state.pageObserver = null;
state.renderQueue = [];
state.renderQueueBusy = false;
state.renderTasks = new Set();
state.pendingRenders = new Set();

export async function setupVirtualPages() {
    dom.viewer.innerHTML = '';
    state.pageHeights = {};
    state.renderedPages.clear();
    state.renderedScales = {};
    state.pendingRenders.clear();

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
        const visiblePages = getVisiblePages();
        let added = false;
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const pageNum = parseInt(entry.target.dataset.pageNum);
                if (!pageNum || isPageRendered(pageNum)) return;

                if (visiblePages.has(pageNum)) {
                    renderPageNow(pageNum);
                } else if (!state.renderQueue.includes(pageNum)) {
                    state.renderQueue.push(pageNum);
                    added = true;
                }
            }
        });
        if (added) processRenderQueue();
    }, { root: dom.viewerScroll, rootMargin: '500px' });

    document.querySelectorAll('[id^="page-"]').forEach(el => state.pageObserver.observe(el));
}

const RENDER_CONCURRENCY = 4;
const YIELD_INTERVAL = 2;

function getVisiblePages() {
    const scrollTop = dom.viewerScroll.scrollTop;
    const scrollBottom = scrollTop + dom.viewerScroll.clientHeight;
    let top = 16;
    const visible = new Set();
    for (let i = 1; i <= state.totalPages; i++) {
        const h = (state.pageHeights[i] || 800) * state.currentScale;
        const bottom = top + h;
        if (bottom > scrollTop && top < scrollBottom) visible.add(i);
        top = bottom + 32;
    }
    return visible;
}

function queuePage(pageNum, visiblePages) {
    if (visiblePages.has(pageNum)) {
        state.renderQueue.unshift(pageNum);
    } else {
        state.renderQueue.push(pageNum);
    }
}

async function processRenderQueue() {
    if (state.renderQueueBusy) return;
    state.renderQueueBusy = true;
    let renderCount = 0;
    try {
        while (state.renderQueue.length > 0) {
            const visiblePages = getVisiblePages();
            state.renderQueue.sort((a, b) => {
                const aVis = visiblePages.has(a) ? 0 : 1;
                const bVis = visiblePages.has(b) ? 0 : 1;
                return aVis - bVis;
            });

            const batch = [];
            while (batch.length < RENDER_CONCURRENCY && state.renderQueue.length > 0) {
                const pn = state.renderQueue.shift();
                if (!isPageRendered(pn)) batch.push(pn);
            }
            if (batch.length === 0) continue;
            await Promise.all(batch.map(pn => renderPageNow(pn)));
            renderCount += batch.length;
            if (renderCount % YIELD_INTERVAL === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }
    } finally {
        state.renderQueueBusy = false;
        if (state.renderQueue.length > 0) processRenderQueue();
    }
}

export function startBgRender() {
    if (!state.pdfDoc) return;
    cancelBgRender();

    const visiblePages = getVisiblePages();
    for (let i = 1; i <= state.totalPages; i++) {
        if (!isPageRendered(i) && !state.renderQueue.includes(i)) {
            queuePage(i, visiblePages);
        }
    }

    processRenderQueue();
}

export function cancelBgRender() {
    state.renderQueue = [];
}

export function isPageRendered(pageNum) {
    return state.renderedPages.has(pageNum);
}

function buildTextLayer(el, pageNum, renderScale, displayHeight) {
    if (!el.isConnected) return;
    const existing = el.querySelector('.textLayer');
    if (existing) existing.remove();

    const textContent = state.textPageCache[pageNum];
    if (!textContent || !textContent.items) return;

    const fragment = document.createDocumentFragment();
    for (const item of textContent.items) {
        const span = document.createElement('span');
        span.textContent = item.text;
        const t = item.transform;
        const x = t[4] * renderScale;
        const y = t[5] * renderScale;
        const fontSize = Math.sqrt(t[0] * t[0] + t[1] * t[1]) * renderScale;

        span.style.cssText = 'position:absolute;left:' + x + 'px;top:' + (displayHeight - y - fontSize) + 'px;font-size:' + fontSize + 'px;font-family:sans-serif;white-space:pre;color:transparent';
        fragment.appendChild(span);
    }

    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    textLayer.appendChild(fragment);
    el.appendChild(textLayer);
}

export async function renderPageNow(pageNum, forceScale = null) {
    const renderScale = forceScale || state.currentScale;
    const dpr = window.devicePixelRatio || 1;
    const effectiveScale = renderScale * dpr;

    if (state.renderedPages.has(pageNum) && !forceScale) return;
    if (!state.pdfDoc) return;
    if (state.pendingRenders.has(pageNum)) return;

    state.pendingRenders.add(pageNum);
    try {
        const page = await state.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: effectiveScale });

        const el = document.getElementById('page-' + pageNum);
        if (!el) return;

        const displayWidth = viewport.width / dpr;
        const displayHeight = viewport.height / dpr;

        el.className = 'pdf-page';
        const hasCanvas = !!el.querySelector('canvas');
        if (!hasCanvas) {
            el.innerHTML = '<div class="page-loading"><div class="spinner"></div>Loading...</div>';
        }
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

        const textPromise = state.textPageCache[pageNum]
            ? null
            : page.getTextContent().then(textContent => {
                let pageText = '';
                const textItems = [];
                for (const item of textContent.items) {
                    pageText += item.str;
                    textItems.push({ text: item.str, transform: item.transform, width: item.width, height: item.height });
                }
                state.textPageCache[pageNum] = { text: pageText, viewport: vp1, items: textItems };
                state.pageHeights[pageNum] = vp1.height;
            });

        const renderTask = page.render({ canvasContext: ctx, viewport: viewport });
        state.renderTasks.add(renderTask);

        await renderTask.promise;
        state.renderTasks.delete(renderTask);

        state.renderedPages.add(pageNum);
        state.renderedScales[pageNum] = Math.max(state.renderedScales[pageNum] || 0, renderScale);

        const existingCanvas = el.querySelector('canvas');
        if (existingCanvas && existingCanvas !== canvas) existingCanvas.remove();
        if (hasCanvas) {
            el.appendChild(canvas);
        } else {
            el.innerHTML = '';
            el.appendChild(canvas);
        }

        el.style.position = 'relative';

        if (textPromise) {
            textPromise.then(() => {
                if (el.isConnected) {
                    requestAnimationFrame(() => buildTextLayer(el, pageNum, renderScale, displayHeight));
                    if (state.searchResults.length > 0) fn.renderHighlightsForPage(pageNum);
                }
            });
        } else {
            requestAnimationFrame(() => buildTextLayer(el, pageNum, renderScale, displayHeight));
            if (state.searchResults.length > 0) fn.renderHighlightsForPage(pageNum);
        }
    } catch (err) {
        state.renderedPages.delete(pageNum);
        if (err.name !== 'RenderingCancelledException') console.warn('Render error:', err.message);
    } finally {
        state.pendingRenders.delete(pageNum);
    }
}

export function setZoom(newScale, force = false) {
    const clampedScale = Math.max(0.5, Math.min(4.0, newScale));
    if (clampedScale === state.currentScale && !force) return;

    const viewportCenter = dom.viewerScroll.scrollTop + dom.viewerScroll.clientHeight / 2;
    const oldScrollLeft = dom.viewerScroll.scrollLeft;

    let anchorEl = null;
    let anchorOffset = 0;

    for (const el of document.querySelectorAll('[id^="page-"]')) {
        const pageTop = el.offsetTop;
        const pageBottom = pageTop + el.offsetHeight;
        if (viewportCenter >= pageTop && viewportCenter < pageBottom) {
            anchorEl = el;
            anchorOffset = Math.max(0, Math.min(1, (viewportCenter - pageTop) / el.offsetHeight));
            break;
        }
    }

    // If viewport center is between pages, anchor to nearest
    if (!anchorEl) {
        let minDist = Infinity;
        for (const el of document.querySelectorAll('[id^="page-"]')) {
            const dist = Math.abs(el.offsetTop + el.offsetHeight / 2 - viewportCenter);
            if (dist < minDist) {
                minDist = dist;
                anchorEl = el;
                anchorOffset = viewportCenter < el.offsetTop ? 0 : 1;
            }
        }
    }

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

    for (const t of state.renderTasks) {
        try { t.cancel(); } catch (e) {}
    }
    state.renderTasks.clear();

    state.renderedPages.clear();
    state.renderedScales = {};
    state.renderQueue = [];
    state.pendingRenders.clear();

    if (anchorEl) {
        requestAnimationFrame(() => {
            const newTop = anchorEl.offsetTop;
            const newH = anchorEl.offsetHeight;
            dom.viewerScroll.scrollTop = Math.max(0, newTop + anchorOffset * newH - dom.viewerScroll.clientHeight / 2);
            dom.viewerScroll.scrollLeft = oldScrollLeft;

            fn.clearHighlights();
            if (state.pageObserver) {
                state.pageObserver.disconnect();
                setupPageObserver();
            }
            if (state.searchResults.length > 0) fn.renderAllHighlights();
            fn.renderPageHeatmaps();
            startBgRender();
        });
    } else {
        dom.viewerScroll.scrollLeft = oldScrollLeft;
        fn.clearHighlights();
        if (state.pageObserver) {
            state.pageObserver.disconnect();
            setupPageObserver();
        }
        if (state.searchResults.length > 0) fn.renderAllHighlights();
        fn.renderPageHeatmaps();
        startBgRender();
    }
}

export function startPrerender() {
    if (state.searchResults.length === 0) return;

    const pagesWithMatches = [...new Set(state.searchResults.map(r => r.page))];
    const visiblePages = getVisiblePages();

    for (const pageNum of pagesWithMatches) {
        if (!isPageRendered(pageNum) && !state.renderQueue.includes(pageNum)) {
            queuePage(pageNum, visiblePages);
        }
    }
    processRenderQueue();
}
