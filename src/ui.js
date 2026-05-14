import { state } from './state.js';
import * as dom from './dom.js';
import { fn } from './cross.js';

state.currentLayout = window.localStorage.getItem('pdf_layout') || 'cards';
state.expandedTreeItems = new Set();
state.smoothScrollEnabled = false;
state.mobileSidebarOpen = false;
state.settingsOpen = false;
state.settingsJustToggled = false;

let searchOverlay = null;
let searchOverlayInput = null;
let searchOverlayResults = null;
let customSearchResults = [];
let customSearchIndex = 0;

export function clearSearch() {
    state.activeKeyword = '';
    state.searchResults = [];
    state.currentMatchIndex = -1;
    dom.navGroup.classList.remove('active');
    dom.navSep.style.display = 'none';
    fn.clearHighlights();
    dom.keywordSelect.value = '';
    dom.matchInput.value = '';
    dom.matchTotal.textContent = '0';
    fn.updateSidebarBadge();
    fn.renderPageHeatmaps();
}

export function clearAllResults() {
    dom.resultsArea.innerHTML = '<h1 class="status-msg"><img src="icons/folder.svg" width="32" height="32" alt="folder"><img src="icons/pdf.svg" width="32" height="32" alt="pdf"><img src="icons/docx.svg" width="32" height="32" alt="docx"><img src="icons/zip.svg" width="32" height="32" alt="zip"></h1><h2 class="status-msg">Drop here to begin scanning</h2>';

    const viewerDropMsg = document.getElementById('viewerDropMsg');
    if (viewerDropMsg) viewerDropMsg.style.display = 'block';
    dom.statusBar.textContent = '';

    if (state.objectUrls) {
        state.objectUrls.forEach(url => {
            URL.revokeObjectURL(url);
            const pdfEntry = state.docTextCache[url];
            if (pdfEntry) {
                state.totalCacheSize -= pdfEntry._size;
                delete state.docTextCache[url];
            }
            const docxEntry = state.docContentCache[url];
            if (docxEntry) {
                state.totalCacheSize -= docxEntry._size;
                delete state.docContentCache[url];
            }
        });
    }
    state.objectUrls = [];
    state.totalMatchesFound = 0;
    state.totalDocsFound = 0;
    state.docDataCache = {};
    state.totalCacheSize = 0;
    if (state.expandedTreeItems) state.expandedTreeItems.clear();
    fn.updateStats();

    state.pdfDoc = null;
    state.currentDocUrl = '';
    state.currentDocType = 'pdf';
    state.currentScale = 1.0;
    document.documentElement.style.setProperty('--pdf-scale', '1');
    state.currentPage = 1;
    state.totalPages = 0;
    dom.viewer.innerHTML = '';
    state.renderedPages.clear();
    state.renderedScales = {};
    state.pageHeights = {};
    state.searchCache = {};
    clearSearch();
    state.currentScale = 1.0;
    document.documentElement.style.setProperty('--pdf-scale', '1');
    state.currentPage = 1;
    state.textPageCache = {};
    state.docSearchResults = [];
    state.docCurrentMatchIndex = -1;
}

function initSearchOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'searchOverlay';
    overlay.className = 'search-overlay';
    overlay.innerHTML = '<input type="text" id="searchOverlayInput" placeholder="Search PDF... (Esc to close)" autocomplete="off">'
        + '<span class="search-overlay-results" id="searchOverlayResults">0 / 0</span>'
        + '<button class="search-overlay-btn" id="searchOverlayPrev" title="Previous (Shift+F3)">&#8592;</button>'
        + '<button class="search-overlay-btn" id="searchOverlayNext" title="Next (F3)">&#8594;</button>'
        + '<button class="search-overlay-btn search-overlay-close" id="searchOverlayClose" title="Close (Esc)">&#10005;</button>';
    document.querySelector('.viewer-container').appendChild(overlay);
    searchOverlay = overlay;
    searchOverlayInput = document.getElementById('searchOverlayInput');
    searchOverlayResults = document.getElementById('searchOverlayResults');
    document.getElementById('searchOverlayPrev').addEventListener('click', customFindPrev);
    document.getElementById('searchOverlayNext').addEventListener('click', customFindNext);
    document.getElementById('searchOverlayClose').addEventListener('click', closeSearchOverlay);
    searchOverlayInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) customFindPrev();
            else customFindNext();
        }
        if (e.key === 'Escape') closeSearchOverlay();
    });
    searchOverlayInput.addEventListener('input', () => performCustomSearch(searchOverlayInput.value));
}

function updateHeatmap() {}

export function showSearchOverlay() {
    if (!searchOverlay) initSearchOverlay();
    searchOverlay.classList.add('visible');
    searchOverlayInput.value = '';
    searchOverlayInput.focus();
    searchOverlayInput.placeholder = state.currentDocUrl && state.docContentCache[state.currentDocUrl]
        ? 'Search document... (Esc to close)' : 'Search PDF... (Esc to close)';

    if (state.currentDocUrl && state.docContentCache[state.currentDocUrl]) {
        state.docSearchResults = [];
        state.docCurrentMatchIndex = 0;
        fn.renderDocHighlights();
    } else {
        customSearchResults = [];
        customSearchIndex = 0;
        clearCustomHighlights();
    }

    searchOverlayResults.textContent = '0 / 0';
    closeMobileSidebar();
}

export function closeSearchOverlay() {
    if (searchOverlay) searchOverlay.classList.remove('visible');
    clearCustomHighlights();
    customSearchResults = [];
    customSearchIndex = 0;
}

function performCustomSearch(query) {
    if (state.currentDocUrl && state.docContentCache[state.currentDocUrl]) {
        if (!query) {
            state.docSearchResults = [];
            state.docCurrentMatchIndex = 0;
            searchOverlayResults.textContent = '0 / 0';
            fn.renderDocHighlights();
            return;
        }
        fn.performDocSearch(query);
        if (state.docSearchResults.length > 0) {
            searchOverlayResults.textContent = (state.docCurrentMatchIndex + 1) + ' / ' + state.docSearchResults.length;
        } else {
            searchOverlayResults.textContent = '0 / 0';
        }
        return;
    }

    if (!query || !state.pdfDoc) {
        customSearchResults = [];
        customSearchIndex = 0;
        searchOverlayResults.textContent = '0 / 0';
        clearCustomHighlights();
        return;
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const localRegex = new RegExp(escaped, 'gi');
    const results = [];

    for (let pageNum = 1; pageNum <= state.totalPages; pageNum++) {
        const cached = state.textPageCache[pageNum];
        if (!cached) continue;
        const pageText = cached.text;
        let match;
        while ((match = localRegex.exec(pageText)) !== null) {
            results.push({ page: pageNum, startIndex: match.index, endIndex: match.index + match[0].length, text: match[0] });
        }
        localRegex.lastIndex = 0;
    }

    customSearchResults = results;
    customSearchIndex = 0;

    if (results.length > 0) {
        searchOverlayResults.textContent = '1 / ' + results.length;
        customGoToMatch(0);
    } else {
        searchOverlayResults.textContent = '0 / 0';
        clearCustomHighlights();
    }
}

async function customGoToMatch(index) {
    if (customSearchResults.length === 0) return;

    customSearchIndex = ((index % customSearchResults.length) + customSearchResults.length) % customSearchResults.length;
    searchOverlayResults.textContent = (customSearchIndex + 1) + ' / ' + customSearchResults.length;

    const result = customSearchResults[customSearchIndex];

    await fn.renderPageNow(result.page);
    scrollToPage(result.page);
    renderAllCustomHighlights();
}

function renderAllCustomHighlights() {
    clearCustomHighlights();
    if (customSearchResults.length === 0) return;

    const currentResult = customSearchResults[customSearchIndex];
    const currentPage = currentResult.page;

    for (let i = 0; i < customSearchResults.length; i++) {
        const result = customSearchResults[i];
        if (result.page !== currentPage) continue;

        const pageEl = document.getElementById('page-' + result.page);
        if (!pageEl) continue;

        const cached = state.textPageCache[result.page];
        if (!cached || !cached.items) continue;

        const coords = getTextCoords(cached, result.startIndex, result.endIndex);
        if (!coords) continue;

        const mark = document.createElement('div');
        mark.className = 'custom-highlight' + (i === customSearchIndex ? ' current' : '');
        mark.style.left = (coords.startX * state.currentScale) + 'px';
        mark.style.top = (coords.startY * state.currentScale) + 'px';
        mark.style.width = ((coords.endX - coords.startX) * state.currentScale) + 'px';
        mark.style.height = (coords.height * state.currentScale) + 'px';
        pageEl.appendChild(mark);
    }

    const currentResultCoords = getTextCoords(state.textPageCache[currentPage], currentResult.startIndex, currentResult.endIndex);
    if (currentResultCoords) {
        const halfViewport = dom.viewerScroll.clientHeight / 2;
        const halfHeight = (currentResultCoords.height * state.currentScale) / 2;
        const pageEl = document.getElementById('page-' + currentPage);
        const targetTop = pageEl.offsetTop + currentResultCoords.startY * state.currentScale - halfViewport + halfHeight;
        dom.viewerScroll.scrollTo({ top: Math.max(0, targetTop), behavior: state.smoothScrollEnabled ? 'smooth' : 'auto' });
    }
}

function getTextCoords(cached, startIndex, endIndex) {
    if (!cached || !cached.items) return null;

    const viewHeight = cached.viewport.height;
    let startY = 0, startX = 0, endY = 0, endX = 0, height = 0;
    let charOffset = 0;

    for (const item of cached.items) {
        const itemStart = charOffset;
        const itemEnd = charOffset + item.text.length;

        if (startIndex >= itemStart && startIndex < itemEnd) {
            const frac = (startIndex - itemStart) / item.text.length;
            startX = item.transform[4] + frac * item.width;
            startY = viewHeight - (item.transform[5] + item.height);
            height = item.height;
        }

        if (endIndex > itemStart && endIndex <= itemEnd) {
            const frac = (endIndex - itemStart) / item.text.length;
            endX = item.transform[4] + frac * item.width;
            endY = viewHeight - (item.transform[5] + item.height);
            break;
        }

        charOffset = itemEnd;
    }

    if (endX === 0) endX = startX + 50;
    if (endY === 0) endY = startY;

    return { startX, startY, endX, endY, height };
}

function clearCustomHighlights() {
    document.querySelectorAll('.custom-highlight').forEach(el => el.remove());
}

function customFindNext() {
    if (state.currentDocUrl && state.docContentCache[state.currentDocUrl]) {
        const query = searchOverlayInput.value;
        if (query && state.docSearchResults.length > 0) {
            fn.cycleDocSearch(query);
            if (state.docSearchResults.length > 0) {
                searchOverlayResults.textContent = (state.docCurrentMatchIndex + 1) + ' / ' + state.docSearchResults.length;
            }
        }
        return;
    }

    if (customSearchResults.length > 0) customGoToMatch(customSearchIndex + 1);
}

function customFindPrev() {
    if (state.currentDocUrl && state.docContentCache[state.currentDocUrl]) {
        if (state.docSearchResults.length > 0) {
            state.docCurrentMatchIndex = (state.docCurrentMatchIndex - 1 + state.docSearchResults.length) % state.docSearchResults.length;
            fn.goToDocMatch(state.docCurrentMatchIndex);
            searchOverlayResults.textContent = (state.docCurrentMatchIndex + 1) + ' / ' + state.docSearchResults.length;
        }
        return;
    }

    if (customSearchResults.length > 0) customGoToMatch(customSearchIndex - 1);
}

export function toggleTheme() {
    const html = document.documentElement;
    if (html.getAttribute('data-theme') === 'light') {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('pdf_theme', 'dark');
    } else {
        html.setAttribute('data-theme', 'light');
        localStorage.setItem('pdf_theme', 'light');
    }
    const btn = document.querySelector('#settingsMenu button:first-child');
    if (btn) btn.textContent = html.getAttribute('data-theme') === 'light' ? 'Dark Mode' : 'Light Mode';
}

export function toggleSettings(e) {
    if (e) e.stopPropagation();
    state.settingsOpen = !state.settingsOpen;

    const existing = document.getElementById('settingsMenu');
    if (!state.settingsOpen) {
        if (existing) existing.remove();
        return;
    }
    if (existing) existing.remove();

    state.settingsJustToggled = true;

    const rect = dom.settingsBtn.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.id = 'settingsMenu';
    menu.className = 'settings-menu';
    menu.style.cssText = 'display:flex;position:fixed;left:' + rect.left + 'px;top:' + (rect.bottom + 4) + 'px;flex-direction:column;gap:6px';

    const themeBtn = document.createElement('button');
    const html = document.documentElement;
    themeBtn.innerHTML = '&#9728; ' + (html.getAttribute('data-theme') === 'light' ? 'Dark Mode' : 'Light Mode');
    themeBtn.onclick = toggleTheme;
    menu.appendChild(themeBtn);

    const animateBtn = document.createElement('button');
    animateBtn.className = 'toggle-btn' + (state.smoothScrollEnabled ? ' on' : '');
    animateBtn.onclick = function() {
        this.classList.toggle('on');
        toggleAnimate();
    };

    const label = document.createElement('span');
    label.className = 'toggle-label';
    label.textContent = 'Animate PDF Scroll ';
    animateBtn.appendChild(label);

    const stateEl = document.createElement('span');
    stateEl.className = 'toggle-state';
    stateEl.textContent = state.smoothScrollEnabled ? 'ON' : 'OFF';
    animateBtn.appendChild(stateEl);

    menu.appendChild(animateBtn);

    const layoutSection = document.createElement('div');
    layoutSection.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px;padding-top:8px;border-top:1px solid var(--grey-600)';

    const layoutLabel = document.createElement('span');
    layoutLabel.className = 'toggle-label';
    layoutLabel.textContent = 'Sidebar Layout:';
    layoutSection.appendChild(layoutLabel);

    const layoutBtns = document.createElement('div');
    layoutBtns.style.cssText = 'display:flex;gap:4px';

    ['cards', 'tree'].forEach(l => {
        const btn = document.createElement('button');
        btn.textContent = l.charAt(0).toUpperCase() + l.slice(1);
        btn.style.cssText = 'flex:1;padding:6px 8px;font-size:0.75rem;border:1px solid var(--grey-600);border-radius:4px;cursor:pointer;'
            + 'background:' + (state.currentLayout === l ? 'var(--green)' : 'transparent') + ';'
            + 'color:' + (state.currentLayout === l ? 'white' : 'var(--grey-300)');
        btn.onclick = () => {
            state.settingsJustToggled = true;
            setLayout(l);
            layoutBtns.querySelectorAll('button').forEach(b => {
                const isSelected = b.textContent.toLowerCase() === l;
                b.style.background = isSelected ? 'var(--green)' : 'transparent';
                b.style.color = isSelected ? 'white' : 'var(--grey-300)';
            });
        };
        layoutBtns.appendChild(btn);
    });

    layoutSection.appendChild(layoutBtns);
    menu.appendChild(layoutSection);

    const githubSection = document.createElement('div');
    githubSection.style.cssText = 'margin-top:4px;padding-top:8px;border-top:1px solid var(--grey-600);display:flex;justify-content:center';

    const githubLink = document.createElement('a');
    githubLink.href = 'https://github.com/kvnhndrsn/kwpdf';
    githubLink.target = '_blank';
    githubLink.rel = 'noopener noreferrer';
    githubLink.style.cssText = 'display:flex;align-items:center;gap:6px;color:var(--grey-300);text-decoration:none;font-size:0.8rem';

    const githubIcon = document.createElement('img');
    githubIcon.src = 'icons/github.svg';
    githubIcon.alt = 'GitHub';
    githubIcon.style.cssText = 'width:16px;height:16px;filter:brightness(0) invert(0.7)';

    githubLink.onmouseenter = () => {
        githubLink.style.color = 'var(--green-light)';
        githubIcon.style.filter = 'brightness(0) invert(0.85) saturate(1.5) hue-rotate(80deg)';
    };
    githubLink.onmouseleave = () => {
        githubLink.style.color = 'var(--grey-300)';
        githubIcon.style.filter = 'brightness(0) invert(0.7)';
    };

    githubLink.appendChild(githubIcon);
    githubLink.appendChild(document.createTextNode('source code on GitHub'));

    githubSection.appendChild(githubLink);
    menu.appendChild(githubSection);

    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener('click', closeSettingsOnClickOutside);
    }, 0);
}

function closeSettingsOnClickOutside(e) {
    const menu = document.getElementById('settingsMenu');
    if (state.settingsJustToggled) {
        state.settingsJustToggled = false;
        return;
    }
    if (menu && !menu.contains(e.target) && e.target !== dom.settingsBtn) {
        menu.remove();
        state.settingsOpen = false;
        document.removeEventListener('click', closeSettingsOnClickOutside);
    }
}

function toggleAnimate() {
    state.smoothScrollEnabled = !state.smoothScrollEnabled;
    localStorage.setItem('pdf_smooth_scroll', state.smoothScrollEnabled);
    const label = document.querySelector('.toggle-state');
    if (label) label.textContent = state.smoothScrollEnabled ? 'ON' : 'OFF';
}

function setLayout(layout) {
    state.currentLayout = layout;
    localStorage.setItem('pdf_layout', layout);
    fn.renderResultsArea();
}

export function closeMobileSidebar() {
    const sidebarEl = document.getElementById('sidebar');
    const viewerEl = document.querySelector('.viewer-container');
    sidebarEl.classList.remove('open');
    sidebarEl.classList.add('collapsed');
    viewerEl.style.height = 'calc(100% - 44px)';
    state.mobileSidebarOpen = false;
}

function openMobileSidebar() {
    const sidebarEl = document.getElementById('sidebar');
    const viewerEl = document.querySelector('.viewer-container');
    sidebarEl.classList.add('open');
    sidebarEl.classList.remove('collapsed');
    viewerEl.style.height = 'calc(100% - 44px)';
    state.mobileSidebarOpen = true;
}

export function toggleMobileSidebar() {
    if (state.mobileSidebarOpen) closeMobileSidebar();
    else openMobileSidebar();
}

function checkMobileLayout() {
    const isMobile = window.innerWidth <= 600;
    const sidebarEl = document.getElementById('sidebar');
    const toggleBtn = document.querySelector('.mobile-toggle-sidebar');
    const viewerEl = document.querySelector('.viewer-container');
    if (toggleBtn) toggleBtn.style.display = isMobile ? 'flex' : 'none';
    if (!isMobile) {
        sidebarEl.classList.remove('collapsed', 'open');
        viewerEl.style.height = '';
        sidebarEl.style.height = '';
        state.mobileSidebarOpen = false;
    } else if (!state.mobileSidebarOpen) {
        sidebarEl.classList.add('collapsed');
        sidebarEl.classList.remove('open');
        viewerEl.style.height = 'calc(100% - 44px)';
    }
}

export function zoomIn() { fn.setZoom(state.currentScale + 0.15); }
export function zoomOut() { fn.setZoom(state.currentScale - 0.15); }

function zoomFit() {
    if (!state.pdfDoc || state.totalPages === 0) return;
    state.pdfDoc.getPage(1).then(page => {
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth = dom.viewerScroll.clientWidth - 32;
        const fitScale = Math.max(0.5, Math.min(4.0, containerWidth / viewport.width));
        fn.setZoom(fitScale);
    });
}

function zoomActual() { fn.setZoom(1.0, true); }

function scrollToPage(pageNum) {
    const pageEl = document.getElementById('page-' + pageNum);
    let targetOffset = 0;
    if (pageEl) {
        targetOffset = pageEl.offsetTop;
    } else {
        for (let i = 1; i < pageNum; i++) {
            targetOffset += (state.pageHeights[i] * state.currentScale || 800) + 32;
        }
    }
    const behavior = state.smoothScrollEnabled && !state.isNavigating ? 'smooth' : 'auto';
    state.isNavigating = true;
    dom.viewerScroll.scrollTo({ top: targetOffset, behavior });
    state.currentPage = pageNum;
    updatePageInfo();
    setTimeout(() => { state.isNavigating = false; }, 100);
}

export function updatePageInfo() {
    dom.pageInput.value = state.currentPage;
    dom.pageInput.placeholder = state.totalPages > 0 ? state.currentPage : '0';
}

export function updateZoomDisplay() {
    dom.zoomLevelEl.textContent = Math.round(state.currentScale * 100) + '%';
}

export function goToMatch(index) {
    if (state.searchResults.length === 0) return;

    state.currentMatchIndex = ((index % state.searchResults.length) + state.searchResults.length) % state.searchResults.length;
    dom.matchInput.value = state.currentMatchIndex + 1;
    fn.updateSidebarBadge();
    updateHeatmap();

    const result = state.searchResults[state.currentMatchIndex];

    fn.renderPageNow(result.page).then(() => {
        const pageEl = document.getElementById('page-' + result.page);
        if (pageEl) {
            const targetTop = pageEl.offsetTop + result.y * state.currentScale - (dom.viewerScroll.clientHeight / 2);
            dom.viewerScroll.scrollTo({ top: Math.max(0, targetTop), behavior: state.smoothScrollEnabled ? 'smooth' : 'auto' });
        }
        fn.clearHighlights();
        fn.renderAllHighlights();
        updateHeatmap();
    });

    fn.startPrerender();
}

export function findNext() {
    if (state.currentDocType === 'pdf' && state.searchResults.length > 0) {
        goToMatch(state.currentMatchIndex + 1);
    } else if (state.docSearchResults.length > 0) {
        fn.goToDocMatch(state.docCurrentMatchIndex + 1);
    }
}

export function findPrev() {
    if (state.currentDocType === 'pdf' && state.searchResults.length > 0) {
        goToMatch(state.currentMatchIndex - 1);
    } else if (state.docSearchResults.length > 0) {
        fn.goToDocMatch(state.docCurrentMatchIndex - 1);
    }
}

function prevPage() {
    if (state.currentPage > 1) {
        state.currentPage--;
        scrollToPage(state.currentPage);
    }
}

function nextPage() {
    if (state.currentPage < state.totalPages) {
        state.currentPage++;
        scrollToPage(state.currentPage);
    }
}

function getTouchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

export function setupEventListeners() {
    window.addEventListener('resize', checkMobileLayout);

    dom.viewerScroll.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            state.touchStartDist = getTouchDist(e);
            state.touchStartScale = state.currentScale;
        }
    }, { passive: true });

    dom.viewerScroll.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = getTouchDist(e);
            const ratio = dist / state.touchStartDist;
            const newScale = Math.max(0.5, Math.min(4.0, state.touchStartScale * ratio));
            if (Math.abs(newScale - state.currentScale) > 0.01) fn.setZoom(newScale);
        }
    }, { passive: false });

    const savedSmooth = localStorage.getItem('pdf_smooth_scroll');
    if (savedSmooth !== null) state.smoothScrollEnabled = savedSmooth === 'true';

    dom.viewerScroll.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            fn.setZoom(state.currentScale + delta);
        }
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomIn(); }
        if (e.ctrlKey && e.key === '-') { e.preventDefault(); zoomOut(); }
        if (e.ctrlKey && e.key === 'f') { e.preventDefault(); showSearchOverlay(); }
        if (e.key === 'F3' && !e.shiftKey) { e.preventDefault(); showSearchOverlay(); }
        if (e.key === 'F3' && e.shiftKey) {
            e.preventDefault();
            if (searchOverlay && searchOverlay.classList.contains('visible')) customFindPrev();
        }
        if (e.key === 'g' && !e.ctrlKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            e.preventDefault();
            dom.pageInput.focus();
            dom.pageInput.select();
        }
        if (e.key === 'Escape') {
            dom.pageInput.blur();
            dom.matchInput.blur();
            closeMobileSidebar();
            closeSearchOverlay();
        }
    });

    dom.pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const num = parseInt(dom.pageInput.value);
            if (num >= 1 && num <= state.totalPages) { scrollToPage(num); dom.pageInput.blur(); }
        }
    });

    dom.pageInput.addEventListener('blur', () => { dom.pageInput.value = state.currentPage; });

    dom.matchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const num = parseInt(dom.matchInput.value);
            if (num >= 1 && num <= state.searchResults.length) { goToMatch(num - 1); dom.matchInput.blur(); }
        }
    });

    dom.matchInput.addEventListener('blur', () => { dom.matchInput.value = state.currentMatchIndex + 1; });

    dom.keywordSelect.addEventListener('change', () => {
        if (dom.keywordSelect.value) {
            if (state.currentDocType === 'pdf') fn.performSearch(dom.keywordSelect.value);
            else fn.performDocSearch(dom.keywordSelect.value);
        }
    });

    dom.viewerScroll.addEventListener('scroll', () => {
        if (!dom.viewer.children.length) return;
        if (state.isNavigating) return;

        const scrollTop = dom.viewerScroll.scrollTop;
        const containerHeight = dom.viewerScroll.clientHeight;
        const scrollHeight = dom.viewerScroll.scrollHeight;
        const midPoint = scrollTop + containerHeight / 2;

        let detectedPage = null;
        for (let i = 1; i <= state.totalPages; i++) {
            const pageEl = document.getElementById('page-' + i);
            if (!pageEl) continue;
            const pageTop = pageEl.offsetTop;
            const pageBottom = pageTop + pageEl.offsetHeight;
            if (midPoint < pageBottom) { detectedPage = i; break; }
        }

        if (!detectedPage && scrollTop + containerHeight >= scrollHeight - 50) detectedPage = state.totalPages;
        if (detectedPage && detectedPage !== state.currentPage) { state.currentPage = detectedPage; updatePageInfo(); }
        if (state.searchResults.length > 0) updateHeatmap();
    });

    const resizer = document.getElementById('resizer');
    const sidebarEl = document.getElementById('sidebar');
    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.body.classList.add('dragging');
        const startX = e.clientX;
        const startWidth = sidebarEl.offsetWidth;
        const onMove = (e) => {
            const width = startWidth + (e.clientX - startX);
            if (width > 150 && width < 900) { sidebarEl.style.width = width + 'px'; sidebarEl.style.flexBasis = width + 'px'; }
        };
        const onUp = () => {
            document.body.classList.remove('dragging');
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    const viewerContainer = document.querySelector('.viewer-container');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
        viewerContainer.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (name === 'dragover') viewerContainer.style.background = 'var(--grey-700)';
            if (name === 'dragleave' || name === 'drop') viewerContainer.style.background = '';
        }, false);
    });

    viewerContainer.addEventListener('drop', (e) => { fn.handleDrop(e); });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
        dom.sidebar.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (name === 'dragenter') dom.sidebar.classList.add('drag-over');
            if ((name === 'dragleave' && !dom.sidebar.contains(e.relatedTarget)) || name === 'drop') dom.sidebar.classList.remove('drag-over');
        }, false);
    });
}

dom.statusBar.textContent = 'Ready';

(function initTheme() {
    const savedTheme = localStorage.getItem('pdf_theme');
    if (savedTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');
})();

state.touchStartDist = 0;
state.touchStartScale = 1.0;
state.pageObserver = null;
state.renderQueue = [];
state.renderQueueBusy = false;
