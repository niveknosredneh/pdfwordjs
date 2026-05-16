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

const LOW_RES_SCALE = 0.2;
const RENDER_CONCURRENCY = 4;
const YIELD_INTERVAL = 2;

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
        dom.viewer.appendChild(placeholder);
    }

    setupPageObserver();
    renderAllPagesLowRes();
}

async function renderAllPagesLowRes() {
    const batchSize = Math.max(1, (navigator.hardwareConcurrency || 4) >> 1);
    for (let i = 1; i <= state.totalPages; i += batchSize) {
        const batch = [];
        for (let j = i; j < Math.min(i + batchSize, state.totalPages + 1); j++) {
            if ((state.renderedScales[j] || 0) < LOW_RES_SCALE) {
                batch.push(renderPageNow(j, LOW_RES_SCALE).catch(() => {}));
            }
        }
        if (batch.length) await Promise.all(batch);
        if (i + batchSize <= state.totalPages) {
            await new Promise(r => setTimeout(r, 0));
        }
    }
}

function setupPageObserver() {
    if (state.pageObserver) state.pageObserver.disconnect();

    state.pageObserver = new IntersectionObserver((entries) => {
        const ranges = getViewportRange();
        let added = false;
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const pageNum = parseInt(entry.target.dataset.pageNum);
                if (!pageNum) return;

                const currentBest = state.renderedScales[pageNum] || 0;
                if (currentBest >= state.currentScale) return;

                if (ranges.visible.has(pageNum)) {
                    renderPageNow(pageNum);
                } else {
                    const priority = getPagePriority(pageNum, ranges);
                    if (!state.renderQueue.some(q => q.pageNum === pageNum)) {
                        state.renderQueue.push({ pageNum, priority });
                        added = true;
                    }
                }
            }
        });
        if (added) processRenderQueue();
    }, { root: dom.viewerScroll, rootMargin: '800px' });

    document.querySelectorAll('[id^="page-"]').forEach(el => state.pageObserver.observe(el));
}

function getViewportRange() {
    const scrollTop = dom.viewerScroll.scrollTop;
    const scrollBottom = scrollTop + dom.viewerScroll.clientHeight;
    const viewH = dom.viewerScroll.clientHeight;
    const ranges = { visible: new Set(), near: new Set(), far: new Set() };
    let top = 16;
    for (let i = 1; i <= state.totalPages; i++) {
        const h = (state.pageHeights[i] || 800) * state.currentScale;
        const bottom = top + h;
        const pageMid = (top + bottom) / 2;
        if (bottom > scrollTop && top < scrollBottom) {
            ranges.visible.add(i);
        } else if (pageMid > scrollTop - viewH && pageMid < scrollBottom + viewH) {
            ranges.near.add(i);
        } else if (pageMid > scrollTop - viewH * 3 && pageMid < scrollBottom + viewH * 3) {
            ranges.far.add(i);
        }
        top = bottom + 32;
    }
    return ranges;
}

function getPagePriority(pageNum, ranges) {
    if (ranges.visible.has(pageNum)) return 0;
    if (ranges.near.has(pageNum)) return 1;
    if (ranges.far.has(pageNum)) return 2;
    return 3;
}

function queuePage(pageNum, ranges) {
    const priority = getPagePriority(pageNum, ranges);
    state.renderQueue.push({ pageNum, priority });
}

async function processRenderQueue() {
    if (state.renderQueueBusy) return;
    state.renderQueueBusy = true;
    let renderCount = 0;
    try {
        while (state.renderQueue.length > 0) {
            const ranges = getViewportRange();

            // Recompute visibility fresh each iteration — visible pages first
            const visible = [];
            const offscreen = [];
            for (const item of state.renderQueue) {
                if (ranges.visible.has(item.pageNum)) {
                    visible.push(item);
                } else {
                    offscreen.push(item);
                }
            }
            state.renderQueue = [...visible, ...offscreen];

            const batch = [];
            while (batch.length < RENDER_CONCURRENCY && state.renderQueue.length > 0) {
                const item = state.renderQueue.shift();
                const pn = item.pageNum;
                const currentBest = state.renderedScales[pn] || 0;
                if (currentBest >= state.currentScale) continue;
                if (state.pendingRenders.has(pn)) {
                    state.renderQueue.push(item);
                    continue;
                }
                batch.push(pn);
            }
            if (batch.length === 0) {
                if (state.renderQueue.length > 0) {
                    await new Promise(r => setTimeout(r, 100));
                }
                continue;
            }

            await Promise.all(batch.map(pn => renderPageNow(pn).catch(() => {})));

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

    const ranges = getViewportRange();
    for (let i = 1; i <= state.totalPages; i++) {
        const currentBest = state.renderedScales[i] || 0;
        if (currentBest >= state.currentScale) continue;
        const priority = getPagePriority(i, ranges);
        state.renderQueue.push({ pageNum: i, priority });
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

    if ((state.renderedScales[pageNum] || 0) >= renderScale) return;
    if (!state.pdfDoc) return;
    if (state.pendingRenders.has(pageNum)) return;

    state.pendingRenders.add(pageNum);
    const wasUpgrade = (state.renderedScales[pageNum] || 0) > 0;
    try {
        const page = await state.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: effectiveScale });

        const el = document.getElementById('page-' + pageNum);
        if (!el) return;

        const displayWidth = viewport.width / dpr;
        const displayHeight = viewport.height / dpr;

        el.className = 'pdf-page';
        const existingCanvas = el.querySelector('canvas');
        const hasCanvas = !!existingCanvas;
        if (!hasCanvas) {
            el.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
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

        if (renderScale < state.currentScale) {
            const ranges = getViewportRange();
            if (ranges.visible.has(pageNum) && (state.renderedScales[pageNum] || 0) < state.currentScale) {
                setTimeout(() => renderPageNow(pageNum), 0);
            }
        }
    } catch (err) {
        if (!wasUpgrade) state.renderedPages.delete(pageNum);
        if (err.name !== 'RenderingCancelledException') console.warn('Render error:', err.message);
    } finally {
        state.pendingRenders.delete(pageNum);
        processRenderQueue();
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

    const oldScale = state.currentScale;
    state.currentScale = clampedScale;
    fn.updateZoomDisplay();
    document.documentElement.style.setProperty('--pdf-scale', clampedScale);

    const scaleRatio = clampedScale / oldScale;

    // CSS-resize all existing canvases for instant visual feedback
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

    // Cancel in-flight renders, but keep existing canvases in the DOM
    for (const t of state.renderTasks) {
        try { t.cancel(); } catch (e) {}
    }
    state.renderTasks.clear();
    state.pendingRenders.clear();
    state.renderQueue = [];

    // Mark visible pages for re-render at new scale (invalidate their cache entry)
    const ranges = getViewportRange();
    for (const pn of ranges.visible) {
        state.renderedScales[pn] = 0;
    }
    // For near/far pages, downgrade cache to low-res so they get upgraded when scrolled to
    for (const pn of ranges.near) {
        if ((state.renderedScales[pn] || 0) > 0 && (state.renderedScales[pn] || 0) < state.currentScale) {
            state.renderedScales[pn] = LOW_RES_SCALE;
        }
    }

    // Re-render visible pages at new scale immediately
    for (const pn of ranges.visible) {
        renderPageNow(pn);
    }

    fn.clearHighlights();
    if (state.pageObserver) {
        state.pageObserver.disconnect();
        setupPageObserver();
    }
    if (state.searchResults.length > 0) fn.renderAllHighlights();
    fn.renderPageHeatmaps();
    startBgRender();

    if (anchorEl) {
        requestAnimationFrame(() => {
            const newTop = anchorEl.offsetTop;
            const newH = anchorEl.offsetHeight;
            dom.viewerScroll.scrollTop = Math.max(0, newTop + anchorOffset * newH - dom.viewerScroll.clientHeight / 2);
            dom.viewerScroll.scrollLeft = oldScrollLeft;
        });
    }
}

export function startPrerender() {
    if (state.searchResults.length === 0) return;

    const pagesWithMatches = [...new Set(state.searchResults.map(r => r.page))];
    const ranges = getViewportRange();

    for (const pageNum of pagesWithMatches) {
        const currentBest = state.renderedScales[pageNum] || 0;
        if (currentBest >= state.currentScale) continue;
        if (state.renderQueue.some(q => q.pageNum === pageNum)) continue;
        state.renderQueue.push({ pageNum, priority: getPagePriority(pageNum, ranges) });
    }
    processRenderQueue();
}
