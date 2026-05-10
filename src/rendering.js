import { state } from './state.js';
import * as dom from './dom.js';

let _loadDocument, _cycleSearch, _cycleDocSearch, _closeMobileSidebar;

export function setCallbacks(cbs) {
    _loadDocument = cbs.loadDocument;
    _cycleSearch = cbs.cycleSearch;
    _cycleDocSearch = cbs.cycleDocSearch;
    _closeMobileSidebar = cbs.closeMobileSidebar;
}

function getFileIcon(filename) {
    const type = getFileType(filename);
    if (type === 'pdf') return '<img src="icons/pdf.svg" width="18" height="18" alt="pdf">';
    if (type === 'docx' || type === 'doc') return '<img src="icons/docx.svg" width="18" height="18" alt="docx">';
    if (type === 'zip') return '<img src="icons/zip.svg" width="18" height="18" alt="zip">';
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="#757575"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/></svg>';
}

function getFileType(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.docx')) return 'docx';
    if (lower.endsWith('.doc')) return 'doc';
    if (lower.endsWith('.zip')) return 'zip';
    return null;
}

function getPathParts(file, baseFolderName) {
    let fileName;
    if (file && (file.relativePath || file.name)) fileName = file.relativePath || file.name;
    else if (baseFolderName) fileName = baseFolderName;
    else fileName = '';

    if (fileName.includes('/') || fileName.includes('\\')) {
        const parts = fileName.split(/[/\\]/);
        const name = parts.pop();
        const folder = parts.join('/');
        return { name, folder };
    }
    return { name: fileName, folder: baseFolderName || state.basePath || '' };
}

function setActiveCard(card) {
    document.querySelectorAll('.doc-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
}

export function setActiveCardFromUrl(url) {
    document.querySelectorAll('.doc-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.doc-card[data-url="${CSS.escape(url)}"]`);
    if (card) card.classList.add('active');

    document.querySelectorAll('.file.active').forEach(el => el.classList.remove('active'));
    const fileItem = document.querySelector(`.tree-file-item[data-url="${CSS.escape(url)}"]`);
    if (fileItem) {
        const fileSpan = fileItem.querySelector('.file');
        if (fileSpan) fileSpan.classList.add('active');
    }

    if (state.currentLayout === 'tree') {
        state.expandedTreeItems.clear();
        state.expandedTreeItems.add(url);
    }
}

export function renderPlaceholderCard(fileName, url, file) {
    const type = getFileType(fileName);
    const { name: baseName, folder } = getPathParts(file, null);
    state.docDataCache[url] = { name: baseName, folder, fullPath: fileName, counts: {}, url, type };

    if (state.currentLayout === 'tree') { renderResultsArea(); return; }

    const card = document.createElement('div');
    card.className = 'doc-card doc-card-minimal';
    card.dataset.url = url;
    card.dataset.type = type;
    card.onclick = () => { setActiveCard(card); _loadDocument(url); _closeMobileSidebar(); };
    card.innerHTML = `<div class="doc-name">${getFileIcon(fileName)} ${fileName}</div>`;
    card.appendChild(document.createElement('div'));
    dom.resultsArea.appendChild(card);
}

export function renderCard(fileName, counts, url, file) {
    const existing = state.docDataCache[url];
    const baseName = file ? getPathParts(file, null).name : (existing?.name || fileName);
    const folder = file ? getPathParts(file, null).folder : (existing?.folder || state.basePath || '');
    const type = getFileType(fileName);
    state.docDataCache[url] = { name: baseName, folder, fullPath: fileName, counts, url, type };

    if (state.currentLayout === 'tree') { renderResultsArea(); return; }

    let card = dom.resultsArea.querySelector(`.doc-card[data-url="${CSS.escape(url)}"]`);
    if (!card) {
        card = document.createElement('div');
        card.className = 'doc-card';
        card.dataset.url = url;
        card.dataset.type = type;
        card.onclick = () => { setActiveCard(card); _loadDocument(url); _closeMobileSidebar(); };
        dom.resultsArea.appendChild(card);
    }

    card.className = 'doc-card';
    card.dataset.type = type;
    card.innerHTML = `<div class="doc-name">${getFileIcon(fileName)} ${fileName}</div>`;

    const grid = document.createElement('div');
    grid.className = 'badge-grid';

    const keywordCounts = {};
    const keywords = window.KEYWORDS || [];
    keywords.forEach(k => {
        const count = counts[k] || 0;
        if (count > 0) keywordCounts[k] = count;
    });
    card.dataset.counts = JSON.stringify(keywordCounts);

    keywords.forEach(k => {
        const count = counts[k] || 0;
        if (count > 0) {
            const b = document.createElement('div');
            b.className = 'badge';
            b.dataset.keyword = k;
            b.dataset.count = count;
            b.textContent = `${k}: ${count}`;
            b.onclick = (e) => {
                e.stopPropagation();
                setActiveCard(card);
                _closeMobileSidebar();
                if (state.currentDocUrl === url) {
                    if (type === 'pdf') _cycleSearch(k);
                    else _cycleDocSearch(k);
                } else {
                    _loadDocument(url, k);
                }
            };
            grid.appendChild(b);
        }
    });
    card.appendChild(grid);
}

export function renderNoMatchCard(fileName, url, file) {
    const existing = state.docDataCache[url];
    const baseName = file ? getPathParts(file, null).name : (existing?.name || fileName);
    const folder = file ? getPathParts(file, null).folder : (existing?.folder || state.basePath || '');
    const type = getFileType(fileName);
    state.docDataCache[url] = { name: baseName, folder, fullPath: fileName, counts: {}, url, type };

    if (state.currentLayout === 'tree') { renderResultsArea(); return; }

    let card = dom.resultsArea.querySelector(`.doc-card[data-url="${CSS.escape(url)}"]`);
    if (!card) {
        card = document.createElement('div');
        card.className = 'doc-card doc-card-minimal';
        card.dataset.url = url;
        card.dataset.type = type;
        card.onclick = () => { setActiveCard(card); _loadDocument(url); _closeMobileSidebar(); };
        dom.resultsArea.appendChild(card);
    }

    card.className = 'doc-card doc-card-minimal';
    card.dataset.type = type;
    card.innerHTML = `<div class="doc-name">${getFileIcon(fileName)} ${fileName}</div>`;
}

function buildTreeData() {
    const root = { name: '', children: {}, docs: [] };
    Object.values(state.docDataCache).forEach(doc => {
        const folder = doc.folder || '';
        const parts = folder ? folder.split('/').filter(Boolean) : [];
        let current = root;
        for (const part of parts) {
            if (!current.children[part]) current.children[part] = { name: part, children: {}, docs: [] };
            current = current.children[part];
        }
        current.docs.push(doc);
    });
    return root;
}

function renderTree(node, path = '') {
    const ul = document.createElement('ul');

    const folderNames = Object.keys(node.children).sort();
    for (const name of folderNames) {
        const child = node.children[name];
        const li = document.createElement('li');
        const folderSpan = document.createElement('span');
        folderSpan.className = 'folder open';
        folderSpan.innerHTML = '<img src="icons/folder.svg" width="16" height="16" alt="folder"> ' + name;
        folderSpan.addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.toggle('open');
            const nested = this.nextElementSibling;
            if (nested && nested.classList.contains('tree-nested')) nested.classList.toggle('expanded');
        });
        li.appendChild(folderSpan);
        const childUl = renderTree(child, path ? path + '/' + name : name);
        childUl.className = 'tree-nested expanded';
        li.appendChild(childUl);
        ul.appendChild(li);
    }

    const sortedDocs = [...node.docs].sort((a, b) => a.name.localeCompare(b.name));
    for (const doc of sortedDocs) {
        const li = document.createElement('li');
        li.className = 'tree-file-item';
        li.dataset.url = doc.url;

        const fileSpan = document.createElement('span');
        fileSpan.className = 'file';
        if (doc.url === state.currentDocUrl) fileSpan.classList.add('active');
        fileSpan.innerHTML = getFileIcon(doc.name);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = doc.name;
        fileSpan.appendChild(nameSpan);

        const totalMatches = Object.values(doc.counts).reduce((a, b) => a + b, 0);
        if (totalMatches > 0) {
            const countSpan = document.createElement('span');
            countSpan.className = 'tree-count';
            countSpan.textContent = totalMatches;
            fileSpan.appendChild(countSpan);
        }

        fileSpan.addEventListener('click', function(e) {
            e.stopPropagation();
            state.expandedTreeItems.clear();
            state.expandedTreeItems.add(doc.url);
            _loadDocument(doc.url);
            _closeMobileSidebar();
            renderResultsArea();
        });
        li.appendChild(fileSpan);

        if (totalMatches > 0) {
            const kwUl = document.createElement('ul');
            kwUl.className = 'tree-nested' + (state.expandedTreeItems.has(doc.url) ? ' expanded' : '');
            const keywords = window.KEYWORDS || [];
            keywords.forEach(k => {
                const cnt = doc.counts[k] || 0;
                if (cnt > 0) {
                    const kwLi = document.createElement('li');
                    kwLi.className = 'tree-child';
                    kwLi.onclick = (e) => {
                        e.stopPropagation();
                        if (doc.url === state.currentDocUrl) {
                            if (doc.type === 'pdf') _cycleSearch(k);
                            else _cycleDocSearch(k);
                        } else {
                            _loadDocument(doc.url, k);
                        }
                    };
                    kwLi.textContent = k + ': ' + cnt;
                    kwUl.appendChild(kwLi);
                }
            });
            li.appendChild(kwUl);
        }
        ul.appendChild(li);
    }
    return ul;
}

export function renderResultsArea() {
    dom.resultsArea.innerHTML = '';
    dom.resultsArea.className = 'results-area' + (state.currentLayout === 'tree' ? ' tree-mode' : '');

    if (state.currentLayout === 'tree') {
        const treeData = buildTreeData();
        const treeUl = renderTree(treeData);
        treeUl.id = 'file-tree';
        dom.resultsArea.appendChild(treeUl);
        if (Object.keys(state.docDataCache).length === 0) {
            dom.resultsArea.innerHTML = '<h1 class="status-msg">&#10548;</h1><h1 class="status-msg">Drop a folder to begin scanning</h1>';
        }
    } else {
        const docs = Object.values(state.docDataCache);
        docs.forEach(doc => {
            const isActive = doc.url === state.currentDocUrl;
            const type = getFileType(doc.name);
            const keywords = window.KEYWORDS || [];
            if (Object.keys(doc.counts).length > 0) {
                const card = document.createElement('div');
                card.className = 'doc-card' + (isActive ? ' active' : '');
                card.dataset.url = doc.url;
                card.dataset.type = type;
                card.onclick = () => { setActiveCard(card); _loadDocument(doc.url); _closeMobileSidebar(); };
                card.innerHTML = `<div class="doc-name">${getFileIcon(doc.name)} ${doc.name}</div>`;
                const grid = document.createElement('div');
                grid.className = 'badge-grid';
                keywords.forEach(k => {
                    const count = doc.counts[k] || 0;
                    if (count > 0) {
                        const b = document.createElement('div');
                        b.className = 'badge';
                        b.dataset.keyword = k;
                        b.dataset.count = count;
                        b.textContent = `${k}: ${count}`;
                        b.onclick = (e) => {
                            e.stopPropagation();
                            setActiveCard(card);
                            _closeMobileSidebar();
                            if (state.currentDocUrl === doc.url) {
                                if (type === 'pdf') _cycleSearch(k);
                                else _cycleDocSearch(k);
                            } else {
                                _loadDocument(doc.url, k);
                            }
                        };
                        grid.appendChild(b);
                    }
                });
                card.appendChild(grid);
                dom.resultsArea.appendChild(card);
            } else {
                const card = document.createElement('div');
                card.className = 'doc-card doc-card-minimal';
                card.dataset.url = doc.url;
                card.dataset.type = type;
                card.onclick = () => { setActiveCard(card); _loadDocument(doc.url); _closeMobileSidebar(); };
                card.innerHTML = `<div class="doc-name">${getFileIcon(doc.name)} ${doc.name}</div>`;
                dom.resultsArea.appendChild(card);
            }
        });
        if (docs.length === 0) {
            dom.resultsArea.innerHTML = '<h1 class="status-msg">&#10548;</h1><h1 class="status-msg">Drop a folder to begin scanning</h1>';
        }
    }
}

export function updateStats() {
    if (state._verboseRAF) return;
    if (state.totalMatchesFound > 0) {
        dom.statusBar.textContent = `${state.totalMatchesFound} matches across ${state.totalDocsFound} document${state.totalDocsFound !== 1 ? 's' : ''}`;
    } else if (state.totalDocsFound > 0) {
        dom.statusBar.textContent = `${state.totalDocsFound} document${state.totalDocsFound !== 1 ? 's' : ''} scanned`;
    }
}

export function updateSidebarBadge() {
    document.querySelectorAll('.badge').forEach(badge => {
        const k = badge.dataset.keyword;
        const total = parseInt(badge.dataset.count) || 0;
        const cardUrl = badge.closest('.doc-card').dataset.url || '';
        const isCurrentFile = cardUrl === state.currentDocUrl;
        const isActiveKeyword = k === state.activeKeyword;
        if (isCurrentFile && isActiveKeyword && state.currentMatchIndex >= 0) {
            badge.textContent = `${k}: ${(state.currentMatchIndex + 1).toString().padStart(Math.max(2, total.toString().length), ' ')}/${total.toString().padStart(Math.max(2, total.toString().length), ' ')}`;
        } else {
            badge.textContent = `${k}: ${total.toString().padStart(Math.max(2, total.toString().length), ' ')}`;
        }
    });
}

export function updateProgressMainThread() {
    state.processed++;
    dom.progressBar.style.width = `${Math.round((state.processed / state.totalFiles) * 100)}%`;
    if (state.processed === state.totalFiles) {
        renderResultsArea();
        dom.statusBar.textContent = state.totalMatchesFound === 0
            ? 'No matches found'
            : `${state.totalMatchesFound} matches across ${state.totalDocsFound} document${state.totalDocsFound !== 1 ? 's' : ''}`;
    }
}
