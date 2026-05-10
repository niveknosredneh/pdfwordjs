import JSZip from 'jszip';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';

window.pdfjsLib = pdfjsLib;
window.JSZip = JSZip;
window.mammoth = mammoth;

import { state } from './state.js';
import * as dom from './dom.js';
import { register } from './cross.js';

import * as pdfRenderer from './pdf-renderer.js';
import * as pdfSearch from './pdf-search.js';
import * as docxEngine from './docx-engine.js';
import * as pdfLoader from './pdf-loader.js';
import * as fileHandler from './file-handler.js';
import * as rendering from './rendering.js';
import * as ui from './ui.js';
import * as keywords from './keywords.js';

register('setupVirtualPages', pdfRenderer.setupVirtualPages);
register('cancelBgRender', pdfRenderer.cancelBgRender);
register('isPageRendered', pdfRenderer.isPageRendered);
register('renderPageNow', pdfRenderer.renderPageNow);
register('setZoom', pdfRenderer.setZoom);
register('startPrerender', pdfRenderer.startPrerender);

register('precomputeAllSearches', pdfSearch.precomputeAllSearches);
register('performSearch', pdfSearch.performSearch);
register('cycleSearch', pdfSearch.cycleSearch);
register('clearHighlights', pdfSearch.clearHighlights);
register('renderAllHighlights', pdfSearch.renderAllHighlights);
register('renderHighlightsForPage', pdfSearch.renderHighlightsForPage);
register('renderPageHeatmaps', pdfSearch.renderPageHeatmaps);

register('loadDocxDoc', docxEngine.loadDocxDoc);
register('performDocSearch', docxEngine.performDocSearch);
register('cycleDocSearch', docxEngine.cycleDocSearch);
register('renderDocHighlights', docxEngine.renderDocHighlights);
register('goToDocMatch', docxEngine.goToDocMatch);

register('loadDocument', pdfLoader.loadDocument);

register('handleDrop', fileHandler.handleDrop);
register('extractPdfText', fileHandler.extractPdfText);
register('extractDocText', fileHandler.extractDocText);

register('renderPlaceholderCard', rendering.renderPlaceholderCard);
register('renderCard', rendering.renderCard);
register('renderNoMatchCard', rendering.renderNoMatchCard);
register('renderResultsArea', rendering.renderResultsArea);
register('updateStats', rendering.updateStats);
register('updateSidebarBadge', rendering.updateSidebarBadge);
register('updateProgressMainThread', rendering.updateProgressMainThread);

register('clearSearch', ui.clearSearch);
register('showSearchOverlay', ui.showSearchOverlay);
register('closeSearchOverlay', ui.closeSearchOverlay);
register('closeMobileSidebar', ui.closeMobileSidebar);
register('toggleTheme', ui.toggleTheme);
register('zoomIn', ui.zoomIn);
register('zoomOut', ui.zoomOut);
register('updateZoomDisplay', ui.updateZoomDisplay);
register('updatePageInfo', ui.updatePageInfo);
register('findNext', ui.findNext);
register('findPrev', ui.findPrev);
register('goToMatch', ui.goToMatch);
register('toggleSettings', ui.toggleSettings);
register('clearAllResults', ui.clearAllResults);

register('populateKeywordSelect', keywords.populateKeywordSelect);

rendering.setCallbacks({
    loadDocument: pdfLoader.loadDocument,
    cycleSearch: pdfSearch.cycleSearch,
    cycleDocSearch: docxEngine.cycleDocSearch,
    closeMobileSidebar: ui.closeMobileSidebar,
});

window.clearAllResults = ui.clearAllResults;
window.clearSearch = ui.clearSearch;
window.toggleSettings = ui.toggleSettings;
window.toggleMobileSidebar = ui.toggleMobileSidebar;
window.showSearchOverlay = ui.showSearchOverlay;
window.findNext = ui.findNext;
window.findPrev = ui.findPrev;
window.zoomIn = ui.zoomIn;
window.zoomOut = ui.zoomOut;
window.zoomFit = function() { pdfRenderer.setZoom(
    Math.max(0.5, Math.min(4.0,
        (dom.viewerScroll.clientWidth - 32) / 800)
    ), true);
};
window.zoomActual = function() { pdfRenderer.setZoom(1.0, true); };

let pageCount = 0;

window.prevPage = function() {
    if (state.currentPage > 1) {
        state.currentPage--;
        const pageEl = document.getElementById('page-' + state.currentPage);
        const targetOffset = pageEl ? pageEl.offsetTop : 0;
        dom.viewerScroll.scrollTo({ top: targetOffset, behavior: state.smoothScrollEnabled ? 'smooth' : 'auto' });
        ui.updatePageInfo();
    }
};

window.nextPage = function() {
    if (state.currentPage < state.totalPages) {
        state.currentPage++;
        const pageEl = document.getElementById('page-' + state.currentPage);
        const targetOffset = pageEl ? pageEl.offsetTop : 0;
        dom.viewerScroll.scrollTo({ top: targetOffset, behavior: state.smoothScrollEnabled ? 'smooth' : 'auto' });
        ui.updatePageInfo();
    }
};

window.toggleKeywordManager = function() {
    keywords.toggleKeywordManager();
};
window.loadListIntoEditor = function() {
    const listName = dom.listSelector ? dom.listSelector.value : keywords.getCurrentListName();
    const finalName = listName || keywords.getDefaultListName();
    const keywordLists = keywords.getKeywordLists();
    const words = keywordLists[finalName] || [];
    dom.keywordInput.value = words.join('\n');
    dom.deleteListBtn.style.display = ['Central Supply-Only', 'Liners', 'Companies'].includes(finalName) ? 'none' : '';
    dom.listInfo.textContent = words.length + ' keywords';
    if (dom.listSelector && finalName) dom.listSelector.value = finalName;
};
window.showNewListDialog = function() {
    if (dom.newListDialog) dom.newListDialog.classList.add('show');
    if (dom.newListName) { dom.newListName.value = ''; dom.newListName.focus(); }
};
window.hideNewListDialog = function() {
    if (dom.newListDialog) dom.newListDialog.classList.remove('show');
};
window.createNewList = function() {
    const name = dom.newListName.value.trim();
    if (!name) return;
    const lists = keywords.getKeywordLists();
    if (lists[name]) { alert('A list with this name already exists.'); return; }
    keywords.switchKeywordList(name);
    window.hideNewListDialog();
    keywords.populateListSelector();
    if (dom.listSelector) dom.listSelector.value = name;
    window.loadListIntoEditor();
};
window.deleteCurrentList = function() {
    const listName = dom.listSelector ? dom.listSelector.value : '';
    if (!listName || ['Central Supply-Only', 'Liners', 'Companies'].includes(listName)) return;
    if (!confirm('Delete list "' + listName + '"?')) return;
    const lists = keywords.getKeywordLists();
    const updated = {};
    for (const k of Object.keys(lists)) if (k !== listName) updated[k] = lists[k];
    keywords.switchKeywordList(listName);
    keywords.populateListSelector();
    window.loadListIntoEditor();
};
window.exportKeywords = function() {
    const listName = keywords.getCurrentListName() || keywords.getDefaultListName();
    const lists = keywords.getKeywordLists();
    const words = lists[listName] || [];
    const data = { name: listName, keywords: words, exported: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = listName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_keywords.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
window.importKeywords = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (!data.keywords || !Array.isArray(data.keywords)) { alert('Invalid file format.'); return; }
                const listName = data.name || 'Imported List';
                const words = data.keywords.filter(k => typeof k === 'string' && k.trim());
                keywords.switchKeywordList(listName);
                keywords.populateListSelector();
                alert('Imported "' + listName + '" with ' + words.length + ' keywords.');
            } catch (err) { alert('Failed to parse JSON: ' + err.message); }
        };
        reader.readAsText(file);
    };
    input.click();
};
window.saveCurrentList = function() {
    const listName = dom.listSelector ? dom.listSelector.value : keywords.getCurrentListName();
    const lines = dom.keywordInput.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    keywords.switchKeywordList(listName);
    keywords.toggleKeywordManager();
};

keywords.initKeywordBridge();

dom.keywordListSelect.addEventListener('change', () => {
    const listName = dom.keywordListSelect.value;
    if (window.switchKeywordList && window.switchKeywordList(listName)) {
        state.searchCache = {};
        window.clearSearch();
        if (state.objectUrls.length > 0) fileHandler.rescanAllDocuments();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await keywords.loadKeywords();
    keywords.populateListSelector();
    keywords.syncKeywordsToWindow();
    ui.setupEventListeners();
});
