export const fn = {};
export let pdfjsLib = null;
export let JSZip = null;
export let mammoth = null;
export let KEYWORDS = [];
export let KEYWORD_LISTS = {};
export let DEFAULT_LIST_NAME = 'Central Supply-Only';

export function register(name, func) {
    fn[name] = func;
}

export function setPdfjsLib(v) { pdfjsLib = v; }
export function setJSZip(v) { JSZip = v; }
export function setMammoth(v) { mammoth = v; }
export function setKeywords(v) { KEYWORDS = v; }
export function setKeywordLists(v) { KEYWORD_LISTS = v; }
export function setDefaultListName(v) { DEFAULT_LIST_NAME = v; }
