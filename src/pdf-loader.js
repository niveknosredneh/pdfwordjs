import { state } from './state.js';
import * as dom from './dom.js';
import { fn } from './cross.js';
import { evictCaches } from './file-handler.js';
import { setScale, autoDetectScale } from './measure.js';
import { processTextContent } from './pdf-search.js';

function getDocTypeFromUrl(url) {
    const dataCached = state.docDataCache[url];
    if (dataCached?.type) return dataCached.type;
    if (dataCached?.name) {
        const lower = dataCached.name.toLowerCase();
        if (lower.endsWith('.pdf')) return 'pdf';
        if (lower.endsWith('.docx')) return 'docx';
        if (lower.endsWith('.doc')) return 'doc';
    }
    if (state.docContentCache[url]?.type) return state.docContentCache[url].type;
    if (url.includes('.pdf')) return 'pdf';
    if (url.includes('.docx')) return 'docx';
    if (url.includes('.doc')) return 'doc';
    return null;
}

function loadPDF(fileUrl, keyword = '') {
    if (state.currentDocUrl === fileUrl && state.pdfDoc) {
        if (keyword) fn.performSearch(keyword);
        return;
    }

    state.currentDocUrl = fileUrl;

    if (state.pdfDoc) {
        try { state.pdfDoc.destroy(); } catch (e) { console.warn('Error destroying previous PDF:', e); }
        state.pdfDoc = null;
    }

    dom.viewer.style.display = '';
    dom.loader.style.display = 'flex';
    dom.loaderFilename.textContent = 'Loading PDF...';
    dom.loaderStatus.textContent = 'Initializing...';
    dom.loaderProgressFill.style.width = '10%';
    dom.viewer.innerHTML = '';
    state.renderedPages.clear();
    state.renderedScales = {};
    state.pageHeights = {};
    state.searchCache = {};
    fn.clearSearch();
    state.currentScale = 1.0;
    document.documentElement.style.setProperty('--pdf-scale', '1');
    state.currentPage = 1;
    state.textPageCache = {};

    (async () => {
        try {
            state.pdfDoc = await window.pdfjsLib.getDocument(fileUrl).promise;
            state.currentDocUrl = fileUrl;
            state.totalPages = state.pdfDoc.numPages;

            dom.loaderStatus.textContent = 'Setting up ' + state.totalPages + ' pages...';
            dom.loaderProgressFill.style.width = '30%';
            await fn.setupVirtualPages();

            dom.loaderStatus.textContent = 'Rendering first page...';
            dom.loaderProgressFill.style.width = '45%';
            if (!fn.isPageRendered(1)) await fn.renderPageNow(1);

            dom.loaderStatus.textContent = 'Extracting text content...';
            dom.loaderProgressFill.style.width = '60%';

            let cached = state.docTextCache[fileUrl];
            if (!cached) {
                dom.loaderFilename.textContent = 'Extracting text from loaded PDF...';
                const pageTextData = [];
                const extractPromises = [];
                for (let p = 1; p <= state.totalPages; p++) {
                    extractPromises.push(
                        state.pdfDoc.getPage(p).then(page =>
                            page.getTextContent().then(content => ({
                                pageNum: p,
                                content,
                                viewport: page.getViewport({ scale: 1.0 })
                            })).catch(() => ({ pageNum: p, content: null, viewport: null }))
                        ).catch(() => ({ pageNum: p, content: null, viewport: null }))
                    );
                }
                const allResults = await Promise.all(extractPromises);
                for (const { pageNum, content, viewport } of allResults) {
                    if (!content) continue;
                    const { text, items } = processTextContent(content);
                    pageTextData.push({
                        text,
                        viewport: { width: viewport.width, height: viewport.height, offsetX: viewport.offsetX, offsetY: viewport.offsetY },
                        items
                    });
                }
                dom.loaderProgressFill.style.width = '80%';
                const fileName = state.docDataCache[fileUrl]?.name || 'Document';
                cached = {
                    totalPages: state.totalPages,
                    pages: pageTextData,
                    fileName,
                    _lastAccess: Date.now(),
                    _size: JSON.stringify(pageTextData).length + fileName.length
                };
                state.docTextCache[fileUrl] = cached;
                state.totalCacheSize += cached._size;
                evictCaches();
            }
            if (cached) {
                cached._lastAccess = Date.now();
                for (let i = 0; i < cached.pages.length; i++) {
                    state.textPageCache[i + 1] = cached.pages[i];
                }
                dom.loaderProgressFill.style.width = '80%';
                await fn.precomputeAllSearches();

                // Populate sidebar keyword counts from search results
                const counts = {};
                for (const [kw, matches] of Object.entries(state.searchCache)) {
                    if (kw === '_deduplicated') continue;
                    counts[kw] = matches.length;
                }
                if (state.docDataCache[fileUrl]) {
                    state.docDataCache[fileUrl].counts = counts;
                }
            }

            // Auto-detect measurement scale from embedded metadata or page text
            const detected = await autoDetectScale(fileUrl);
            if (detected) {
                setScale(detected);
                const scaleInput = document.getElementById('scaleInput');
                if (scaleInput) scaleInput.value = '1:' + detected;
                fn.refreshAllMeasurements();
            }

            dom.loaderProgressFill.style.width = '100%';
            dom.loader.style.display = 'none';
            fn.updatePageInfo();
            fn.updateZoomDisplay();
            dom.pageInput.max = state.totalPages;
            dom.pageTotal.textContent = state.totalPages;

            fn.renderPageHeatmaps();
            fn.refreshAllMeasurements();

            fn.renderResultsArea();

            if (keyword) fn.performSearch(keyword);
        } catch (err) {
            dom.loaderFilename.textContent = 'Error loading PDF';
            dom.loaderStatus.textContent = err.message;
            dom.loaderProgressFill.style.width = '0%';
            console.error('PDF load error:', err);
        }
    })();
}

export function loadDocument(fileUrl, keyword) {
    const type = getDocTypeFromUrl(fileUrl);
    if (type === 'pdf') {
        loadPDF(fileUrl, keyword);
    } else if (type === 'docx' || type === 'doc') {
        fn.loadDocxDoc(fileUrl, keyword);
    } else {
        loadPDF(fileUrl, keyword);
    }
}
