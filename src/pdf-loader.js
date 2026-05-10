import { state } from './state.js';
import * as dom from './dom.js';
import { fn } from './cross.js';

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

    if (state.currentLayout === 'tree' && state.currentDocUrl && state.currentDocUrl !== fileUrl) {
        state.expandedTreeItems.delete(state.currentDocUrl);
    }
    if (state.currentLayout === 'tree' && fileUrl) {
        state.expandedTreeItems.add(fileUrl);
    }

    state.currentDocUrl = fileUrl;
    fn.cancelBgRender();

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

            if (!fn.isPageRendered(1)) fn.renderPageNow(1);

            dom.loaderStatus.textContent = 'Extracting text content...';
            dom.loaderProgressFill.style.width = '60%';

            let cached = state.docTextCache[fileUrl];
            if (!cached) {
                dom.loaderFilename.textContent = 'Re-scanning PDF...';
                const blobUrl = state.objectUrls.find(url => url === fileUrl);
                if (blobUrl) {
                    const response = await fetch(blobUrl);
                    const arrayBuffer = await response.arrayBuffer();
                    const fileName = state.docDataCache[fileUrl]?.name || 'Document';
                    await fn.extractPdfText(arrayBuffer, fileName, fileUrl, null);
                    cached = state.docTextCache[fileUrl];
                }
            }
            if (cached) {
                cached._lastAccess = Date.now();
                for (let i = 0; i < cached.pages.length; i++) {
                    state.textPageCache[i + 1] = cached.pages[i];
                }
                dom.loaderProgressFill.style.width = '80%';
                await fn.precomputeAllSearches();
            }

            dom.loaderProgressFill.style.width = '100%';
            dom.loader.style.display = 'none';
            fn.updatePageInfo();
            fn.updateZoomDisplay();
            dom.pageInput.max = state.totalPages;
            dom.pageTotal.textContent = state.totalPages;

            fn.renderPageHeatmaps();
            fn.startBgRender();

            if (state.currentLayout === 'tree') fn.renderResultsArea();

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
