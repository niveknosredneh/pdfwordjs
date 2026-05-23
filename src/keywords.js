import { state } from './state.js';
import * as dom from './dom.js';
import { clearKeywordRegexCache, getKeywordRegex } from './keyword-regex.js';

let DEFAULT_LIST_NAME = 'Central Supply-Only';
let KEYWORD_LISTS = {};
let BUILT_IN_LISTS = [];
let currentListName = DEFAULT_LIST_NAME;
let KEYWORDS = [];

export function getKeywords() {
    return KEYWORDS;
}

export function getKeywordLists() {
    return KEYWORD_LISTS;
}

export function getDefaultListName() {
    return DEFAULT_LIST_NAME;
}

export function getCurrentListName() {
    return currentListName;
}

export async function loadKeywords() {
    try {
        const response = await fetch('./keywords.json');
        const data = await response.json();

        KEYWORD_LISTS = data.lists || {};
        DEFAULT_LIST_NAME = data.defaultList || 'Central Supply-Only';
        BUILT_IN_LISTS = data.builtIn || [];

        loadCustomLists();

        const savedList = localStorage.getItem('tender_keyword_list');
        currentListName = (savedList && KEYWORD_LISTS[savedList]) ? savedList : DEFAULT_LIST_NAME;

        KEYWORDS = KEYWORD_LISTS[currentListName] || [];
    } catch (e) {
        console.error('Failed to load keywords.json:', e);
        KEYWORD_LISTS = {};
        KEYWORDS = [];
    }
}

function loadCustomLists() {
    try {
        const saved = localStorage.getItem('tender_custom_lists');
        if (saved) {
            const custom = JSON.parse(saved);
            KEYWORD_LISTS = { ...KEYWORD_LISTS, ...custom };
        }
    } catch (e) {}
}

function saveCustomLists() {
    const custom = {};

    for (const name of Object.keys(KEYWORD_LISTS)) {
        if (!BUILT_IN_LISTS.includes(name)) {
            custom[name] = KEYWORD_LISTS[name];
        }
    }
    localStorage.setItem('tender_custom_lists', JSON.stringify(custom));
}

export function isCustomList(name) {
    return !BUILT_IN_LISTS.includes(name);
}

function createList(name, words) {
    KEYWORD_LISTS[name] = words;
    saveCustomLists();
}

function updateList(name, words) {
    KEYWORD_LISTS[name] = words;
    saveCustomLists();
}

function deleteList(name) {
    if (isCustomList(name)) {
        delete KEYWORD_LISTS[name];
        saveCustomLists();
        return true;
    }
    return false;
}

export function switchKeywordList(listName) {
    if (!KEYWORD_LISTS[listName]) return false;

    localStorage.setItem('tender_keyword_list', listName);
    currentListName = listName;
    KEYWORDS = KEYWORD_LISTS[listName];
    localStorage.setItem('tender_keywords', JSON.stringify(KEYWORDS));
    clearKeywordRegexCache();

    return true;
}

function saveKeywords() {
    localStorage.setItem('tender_keywords', JSON.stringify(KEYWORDS));
    localStorage.setItem('tender_keyword_list', currentListName || DEFAULT_LIST_NAME);
}

export function populateListSelector() {
    const listSelector = dom.keywordListSelect;
    if (listSelector && KEYWORD_LISTS) {
        listSelector.innerHTML = '';
        for (const name of Object.keys(KEYWORD_LISTS)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = `${name} (${KEYWORD_LISTS[name].length})`;
            listSelector.appendChild(opt);
        }
        const savedListName = localStorage.getItem('tender_keyword_list') || DEFAULT_LIST_NAME;
        if (KEYWORD_LISTS[savedListName]) {
            listSelector.value = savedListName;
        }
    }

    const modalSelector = dom.listSelector;
    if (modalSelector && KEYWORD_LISTS) {
        modalSelector.innerHTML = '';
        for (const name of Object.keys(KEYWORD_LISTS)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = `${name} (${KEYWORD_LISTS[name].length})`;
            modalSelector.appendChild(opt);
        }
        if (KEYWORD_LISTS[currentListName]) {
            modalSelector.value = currentListName;
        }
    }
}

export function populateKeywordSelect() {
    dom.keywordSelect.innerHTML = '';
    KEYWORDS.forEach(k => {
        if (state.searchCache[k] && state.searchCache[k].length > 0) {
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = `${k} (${state.searchCache[k].length})`;
            if (k === state.activeKeyword) opt.selected = true;
            dom.keywordSelect.appendChild(opt);
        }
    });
}

export function toggleKeywordManager() {
    const modal = dom.keywordManager;
    if (!modal) return;

    const isShowing = modal.classList.toggle('show');

    if (isShowing) {
        if (dom.listSelector && KEYWORD_LISTS) {
            dom.listSelector.innerHTML = '';
            for (const name of Object.keys(KEYWORD_LISTS)) {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                dom.listSelector.appendChild(opt);
            }
        }
        loadListIntoEditor();
    }
}

function loadListIntoEditor() {
    const listName = dom.listSelector ? dom.listSelector.value : currentListName;

    const finalName = listName || DEFAULT_LIST_NAME;
    const keywords = KEYWORD_LISTS[finalName] || [];
    dom.keywordInput.value = keywords.join('\n');

    if (dom.deleteListBtn) {
        dom.deleteListBtn.style.display = isCustomList(finalName) ? '' : 'none';
    }
    if (dom.listInfo) {
        dom.listInfo.textContent = `${keywords.length} keywords`;
    }
    if (dom.listSelector && finalName) {
        dom.listSelector.value = finalName;
    }
}

function showNewListDialog() {
    if (dom.newListDialog) dom.newListDialog.classList.add('show');
    if (dom.newListName) {
        dom.newListName.value = '';
        dom.newListName.focus();
    }
}

function hideNewListDialog() {
    if (dom.newListDialog) dom.newListDialog.classList.remove('show');
}

function createNewList() {
    const name = dom.newListName.value.trim();
    if (!name) return;
    if (KEYWORD_LISTS[name]) {
        alert('A list with this name already exists.');
        return;
    }
    createList(name, []);
    hideNewListDialog();
    populateListSelector();
    if (dom.listSelector) dom.listSelector.value = name;
    loadListIntoEditor();
}

function deleteCurrentList() {
    const listName = dom.listSelector ? dom.listSelector.value : '';
    if (!listName || !isCustomList(listName)) return;
    if (!confirm(`Delete list "${listName}"?`)) return;
    deleteList(listName);
    populateListSelector();
    loadListIntoEditor();
}

function saveCurrentList() {
    const listName = dom.listSelector ? dom.listSelector.value : currentListName;

    const lines = dom.keywordInput.value.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .slice(0, state.MAX_KEYWORDS_PER_LIST)
        .map(k => k.slice(0, state.MAX_KEYWORD_LENGTH));

    updateList(listName, lines);
    switchKeywordList(listName);

    toggleKeywordManager();

    if (typeof window._performSearch === 'function') {
        window._performSearch();
    }
}

function exportKeywords() {
    const listName = currentListName || DEFAULT_LIST_NAME;
    const keywords = KEYWORD_LISTS[listName] || [];

    const data = {
        name: listName,
        keywords: keywords,
        exported: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${listName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_keywords.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importKeywords() {
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

                if (!data.keywords || !Array.isArray(data.keywords)) {
                    alert('Invalid file format. Expected keywords array.');
                    return;
                }

                const listName = data.name || 'Imported List';
                const words = data.keywords.filter(k => typeof k === 'string' && k.trim());

                createList(listName, words);
                switchKeywordList(listName);

                populateListSelector();
                populateListSelector();

                if (typeof window._performSearch === 'function') {
                    window._performSearch();
                }

                alert(`Imported "${listName}" with ${words.length} keywords.`);
            } catch (err) {
                alert('Failed to parse JSON file: ' + err.message);
            }
        };
        reader.readAsText(file);
    };

    input.click();
}

export function initKeywordBridge() {
    window.KEYWORDS = KEYWORDS;
    window.KEYWORD_LISTS = KEYWORD_LISTS;
    window.DEFAULT_LIST_NAME = DEFAULT_LIST_NAME;
    window.switchKeywordList = switchKeywordList;
    window.populateListSelector = populateListSelector;
    window.populateKeywordSelect = populateKeywordSelect;
    window.toggleKeywordManager = toggleKeywordManager;
    window.loadListIntoEditor = loadListIntoEditor;
    window.showNewListDialog = showNewListDialog;
    window.hideNewListDialog = hideNewListDialog;
    window.createNewList = createNewList;
    window.deleteCurrentList = deleteCurrentList;
    window.exportKeywords = exportKeywords;
    window.importKeywords = importKeywords;
    window.saveCurrentList = saveCurrentList;
}

export function syncKeywordsToWindow() {
    window.KEYWORDS = KEYWORDS;
    window.KEYWORD_LISTS = KEYWORD_LISTS;
    window.DEFAULT_LIST_NAME = DEFAULT_LIST_NAME;
}
