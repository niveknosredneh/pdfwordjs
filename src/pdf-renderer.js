import { state } from './state.js';
import * as dom from './dom.js';
import { fn } from './cross.js';

state.pageHeights = {};
state.renderedPages = new Set();
state.renderedScales = {};

const LOW_RES_SCALE = 0.2;

let renderGen = 0;

// ── initialization ──

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
        dom.viewer.appendChild(placeholder);
    }

    setupPageObserver();
}

// ── observer ──

function setupPageObserver() {
    if (state.pageObserver) state.pageObserver.disconnect();

    state.pageObserver = new IntersectionObserver(() => {
        refreshVisiblePages();
    }, { root: dom.viewerScroll, rootMargin: '800px' });

    document.querySelectorAll('[id^="page-"]').forEach(el => state.pageObserver.observe(el));
}

// ── scroll-end safety net ──

let refreshTimer = null;
dom.viewerScroll.addEventListener('scroll', () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshVisiblePages();
    }, 300);
}, { passive: true });

// ── viewport range helper (used by setZoom) ──

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

// ── cancel helpers ──

function cancelAllRenders() {
    for (const [pn, t] of state.renderTasks) {
        if (t && typeof t.cancel === 'function') {
            try { t.cancel(); } catch (e) {}
        }
    }
    state.renderTasks.clear();
}

// ── the single coordinator ──

async function refreshVisiblePages() {
    cancelAllRenders();
    const gen = ++renderGen;
    await new Promise(r => setTimeout(r, 0));
    if (gen !== renderGen) return;

    const scrollTop = dom.viewerScroll.scrollTop;
    const scrollBottom = scrollTop + dom.viewerScroll.clientHeight;
    const scrollCenter = (scrollTop + scrollBottom) / 2;

    const visible = [];
    for (let i = 1; i <= state.totalPages; i++) {
        const el = document.getElementById('page-' + i);
        if (!el) continue;
        const top = el.offsetTop;
        const bottom = top + el.offsetHeight;
        if (bottom > scrollTop && top < scrollBottom) {
            visible.push({ pn: i, dist: Math.abs((top + bottom) / 2 - scrollCenter) });
        }
    }
    visible.sort((a, b) => a.dist - b.dist);

    if (visible.length === 0) return;

    // Pass 1: low-res all visible pages concurrently (fast)
    const lowResBatch = visible
        .filter(p => (state.renderedScales[p.pn] || 0) < LOW_RES_SCALE)
        .map(p => renderPageNow(p.pn, LOW_RES_SCALE).catch(() => {}));
    if (lowResBatch.length) {
        await Promise.all(lowResBatch);
        if (gen !== renderGen) return;
    }

    // Pass 2: full-res visible pages one at a time, center first
    for (const p of visible) {
        if (gen !== renderGen) break;
        if ((state.renderedScales[p.pn] || 0) >= state.currentScale) continue;
        await renderPageNow(p.pn).catch(() => {});
        await new Promise(r => setTimeout(r, 0));
    }
}

// ── render a single page ──

export async function renderPageNow(pageNum, forceScale = null) {
    const renderScale = forceScale || state.currentScale;
    const dpr = window.devicePixelRatio || 1;
    const effectiveScale = renderScale * dpr;

    if ((state.renderedScales[pageNum] || 0) >= renderScale) return;
    if (!state.pdfDoc) return;
    if (state.renderTasks.has(pageNum)) return;

    state.renderTasks.set(pageNum, null);

    try {
        const page = await state.pdfDoc.getPage(pageNum);
        if (!state.renderTasks.has(pageNum)) return;

        const viewport = page.getViewport({ scale: effectiveScale });

        const el = document.getElementById('page-' + pageNum);
        if (!el) return;

        const vp1 = page.getViewport({ scale: 1.0 });
        const displayWidth = vp1.width * state.currentScale;
        const displayHeight = vp1.height * state.currentScale;

        el.className = 'pdf-page';
        el.style.setProperty('--base-w', vp1.width);
        el.style.setProperty('--base-h', vp1.height);
        el.style.position = 'relative';

        const existingCanvas = el.querySelector('canvas');
        const hasCanvas = !!existingCanvas;
        if (!hasCanvas) {
            el.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        canvas.dataset.scale = renderScale;

        if (!state.textPageCache[pageNum]) {
            page.getTextContent().then(textContent => {
                let pageText = '';
                const textItems = [];
                for (const item of textContent.items) {
                    pageText += item.str;
                    textItems.push({ text: item.str, transform: item.transform, width: item.width, height: item.height });
                }
                state.textPageCache[pageNum] = { text: pageText, viewport: vp1, items: textItems };
                state.pageHeights[pageNum] = vp1.height;
            });
        }

        const renderTask = page.render({ canvasContext: ctx, viewport: viewport });
        state.renderTasks.set(pageNum, renderTask);

        await renderTask.promise;

        state.renderedPages.add(pageNum);
        state.renderedScales[pageNum] = Math.max(state.renderedScales[pageNum] || 0, renderScale);

        if (existingCanvas && existingCanvas !== canvas) existingCanvas.remove();
        if (hasCanvas) {
            el.appendChild(canvas);
        } else {
            el.innerHTML = '';
            el.appendChild(canvas);
        }

        if (state.textPageCache[pageNum]) {
            requestAnimationFrame(() => buildTextLayer(el, pageNum, renderScale, displayHeight));
            if (state.searchResults.length > 0) fn.renderHighlightsForPage(pageNum);
        }
    } catch (err) {
        if (err.name !== 'RenderingCancelledException') console.warn('Render error:', err.message);
    } finally {
        state.renderTasks.delete(pageNum);
    }
}

// ── text layer ──

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

// ── public helpers ──

export function isPageRendered(pageNum) {
    return state.renderedPages.has(pageNum);
}

export function cancelBgRender() {}

// ── zoom ──

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

    cancelAllRenders();

    const ranges = getViewportRange();
    for (const pn of ranges.visible) {
        state.renderedScales[pn] = 0;
    }

    fn.clearHighlights();
    if (state.pageObserver) {
        state.pageObserver.disconnect();
        setupPageObserver();
    }
    if (state.searchResults.length > 0) fn.renderAllHighlights();
    fn.renderPageHeatmaps();

    refreshVisiblePages();

    if (anchorEl) {
        requestAnimationFrame(() => {
            const newTop = anchorEl.offsetTop;
            const newH = anchorEl.offsetHeight;
            dom.viewerScroll.scrollTop = Math.max(0, newTop + anchorOffset * newH - dom.viewerScroll.clientHeight / 2);
            dom.viewerScroll.scrollLeft = oldScrollLeft;
        });
    }
}

// ── search result pre-render ──

export function startPrerender() {
    if (state.searchResults.length === 0) return;

    const pagesWithMatches = [...new Set(state.searchResults.map(r => r.page))];

    for (const pageNum of pagesWithMatches) {
        if ((state.renderedScales[pageNum] || 0) >= state.currentScale) continue;
        renderPageNow(pageNum).catch(() => {});
    }
}
