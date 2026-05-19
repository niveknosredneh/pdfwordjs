import { state } from './state.js';
import * as dom from './dom.js';
import { fn } from './cross.js';
import { getKeywordRegex } from './keyword-regex.js';

let ocrEnabled = true;
const ocrFileState = new Map();
let ocrWorker = null;
let workerTaskId = 0;
const workerCallbacks = new Map();

const OCR_SCALE = 2.0;

export function isOcrEnabled() {
    return ocrEnabled;
}

export function getOcrState(url) {
    return ocrFileState.get(url);
}

export function getOcrMatchesForKeyword(keyword, url) {
    const s = ocrFileState.get(url);
    if (!s || !s.keywordMatches) return [];
    return s.keywordMatches[keyword] || [];
}

export function initOcr() {
    ocrEnabled = true;
}

export function toggleOcrGlobal() {
    ocrEnabled = !ocrEnabled;
    localStorage.setItem('pdf_ocr_enabled', ocrEnabled);
    fn.renderResultsArea();
    return ocrEnabled;
}

export function toggleOcrForFile(url) {
    const existing = ocrFileState.get(url);
    if (existing && existing.status === 'processing') return false;

    if (existing && existing.status === 'done') {
        ocrFileState.delete(url);
        const data = state.docDataCache[url];
        if (data && data._originalCounts) {
            data.counts = { ...data._originalCounts };
            state.totalMatchesFound -= data._ocrTotalMatches || 0;
        }
        if (data) {
            delete data._originalCounts;
            delete data._ocrCounts;
            delete data._ocrTotalMatches;
        }
        fn.renderResultsArea();
        fn.updateStats();
        return false;
    }

    ocrFileState.set(url, { status: 'processing', texts: [], counts: {}, totalMatches: 0 });
    startOcrForFile(url).catch(err => {
        console.error('[OCR] Error:', err);
        ocrFileState.set(url, { status: 'error', texts: [], counts: {}, totalMatches: 0 });
        fn.renderResultsArea();
    });
    fn.renderResultsArea();
    return true;
}

function initWorker() {
    if (ocrWorker) return;
    ocrWorker = new Worker('src/ocr_worker.js?h=__BUNDLE_HASH__');
    ocrWorker.onmessage = (e) => {
        const cb = workerCallbacks.get(e.data.cacheKey);
        if (cb) {
            workerCallbacks.delete(e.data.cacheKey);
            if (e.data.type === 'ocr-result') {
                cb.resolve(e.data);
            } else {
                cb.reject(new Error(e.data.error));
            }
        }
    };
    ocrWorker.onerror = (err) => {
        for (const [, cb] of workerCallbacks) cb.reject(err);
        workerCallbacks.clear();
    };
}

const PAGE_TIMEOUT_MS = 30_000;

function runOcrOnImage(blob, pageNum, cacheKey, imageWidth, imageHeight) {
    return new Promise((resolve, reject) => {
        const id = cacheKey + ':' + pageNum;
        const timer = setTimeout(() => {
            workerCallbacks.delete(id);
            reject(new Error('OCR page ' + pageNum + ' timed out'));
        }, PAGE_TIMEOUT_MS);
        workerCallbacks.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        ocrWorker.postMessage({
            task: 'ocr-page',
            data: { imageData: blob, pageNum, cacheKey: id, imageWidth, imageHeight }
        });
    });
}

async function startOcrForFile(url) {
    const cacheEntry = state.docTextCache[url];
    if (!cacheEntry) return;

    const numPages = cacheEntry.totalPages || 0;
    if (!numPages) return;

    const lowerName = (cacheEntry.fileName || '').toLowerCase();
    if (!lowerName.endsWith('.pdf')) return;

    initWorker();

    let pdfDoc;
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const pdfData = new Uint8Array(arrayBuffer);
        pdfDoc = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
    } catch (err) {
        console.error('[OCR] Failed to load PDF for OCR:', err);
        return;
    }

    const actualNumPages = pdfDoc.numPages;
    const pageWordData = [];
    const HIGHLIGHT_PAD = 3;

    const totalToProcess = Math.min(actualNumPages, numPages);
    dom.statusBar.textContent = 'OCR scanning ' + (cacheEntry.fileName || 'document') + '...';
    dom.progressBar.style.width = '0%';

    for (let pageNum = 1; pageNum <= totalToProcess; pageNum++) {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: OCR_SCALE });
            const canvasWidth = Math.ceil(viewport.width);
            const canvasHeight = Math.ceil(viewport.height);
            dom.statusBar.textContent = 'OCR page ' + pageNum + '/' + totalToProcess + ' - rendering page... - ' + (cacheEntry.fileName || 'document');
            const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            const blob = await canvas.convertToBlob({ type: 'image/png' });
            const startTime = Date.now();
            const pulse = setInterval(() => {
                const secs = Math.floor((Date.now() - startTime) / 1000);
                dom.statusBar.textContent = 'OCR page ' + pageNum + '/' + totalToProcess + ' - recognizing ' + secs + 's - ' + (cacheEntry.fileName || 'document');
            }, 500);
            const ocrResult = await runOcrOnImage(blob, pageNum, url, canvasWidth, canvasHeight);
            clearInterval(pulse);
            pageWordData[pageNum - 1] = {
                words: ocrResult.words || [],
                imageWidth: ocrResult.imageWidth,
                imageHeight: ocrResult.imageHeight,
                flatText: ocrResult.text || ''
            };
            dom.statusBar.textContent = 'OCR page ' + pageNum + '/' + totalToProcess + ' done - ' + (cacheEntry.fileName || 'document');
            dom.progressBar.style.width = Math.round((pageNum / totalToProcess) * 100) + '%';
        } catch (err) {
            console.error('[OCR] Page ' + pageNum + ' error:', err);
            pageWordData[pageNum - 1] = null;
        }
    }

    try { pdfDoc.destroy(); } catch (e) { /* ignore */ }

    const keywords = window.KEYWORDS || [];
    const combinedRegex = getKeywordRegex(keywords);
    const counts = {};
    let totalMatches = 0;
    const keywordMatches = {};

    for (const key of keywords) {
        keywordMatches[key] = [];
    }

    for (let p = 0; p < pageWordData.length; p++) {
        const pageData = pageWordData[p];
        if (!pageData) continue;

        const pageNum = p + 1;

        if (combinedRegex && pageData.flatText) {
            const regex = new RegExp(combinedRegex.source, 'gi');
            let match;
            while ((match = regex.exec(pageData.flatText)) !== null) {
                if (match[0].length < 3) continue;
                if (!/[a-zA-Z]/.test(match[0])) continue;
                const lower = match[0].toLowerCase();
                const key = keywords.find(k => k.toLowerCase() === lower) || lower;
                counts[key] = (counts[key] || 0) + 1;
                totalMatches++;
            }
        }

        if (!combinedRegex) continue;

        const wordRegex = new RegExp(combinedRegex.source, 'gi');
        for (const word of (pageData.words || [])) {
            const wordText = (word.text || '').trim();
            if (wordText.length < 3) continue;
            if (!/[a-zA-Z]/.test(wordText)) continue;

            wordRegex.lastIndex = 0;
            let m;
            let matchedOnWord = false;
            while ((m = wordRegex.exec(wordText)) !== null) {
                if (m[0].length < 3) continue;
                if (!/[a-zA-Z]/.test(m[0])) continue;
                const lower = m[0].toLowerCase();
                const key = keywords.find(k => k.toLowerCase() === lower) || lower;
                if (!matchedOnWord) {
                    matchedOnWord = true;
                    const bbox = word.bbox;
                    if (!bbox || bbox.x0 === undefined) break;

                    const x = (bbox.x0 / OCR_SCALE) - HIGHLIGHT_PAD;
                    const y = (bbox.y0 / OCR_SCALE) - HIGHLIGHT_PAD;
                    const width = ((bbox.x1 - bbox.x0) / OCR_SCALE) + HIGHLIGHT_PAD * 2;
                    const height = ((bbox.y1 - bbox.y0) / OCR_SCALE) + HIGHLIGHT_PAD * 2;

                    keywordMatches[key].push({ page: pageNum, x, y, width, height });
                }
            }
        }
    }

    const docData = state.docDataCache[url];
    if (docData) {
        docData._originalCounts = { ...docData.counts };
        docData._ocrCounts = counts;
        docData._ocrTotalMatches = totalMatches;
        for (const [kw, c] of Object.entries(counts)) {
            docData.counts[kw] = (docData.counts[kw] || 0) + c;
        }
    }

    ocrFileState.set(url, { status: 'done', pageWordData, counts, totalMatches, keywordMatches });
    state.totalMatchesFound += totalMatches;
    fn.renderResultsArea();
    fn.updateStats();
    dom.statusBar.textContent = 'OCR done - ' + (cacheEntry.fileName || 'document') + ': ' + totalMatches + ' new matches';
    dom.progressBar.style.width = '100%';
    setTimeout(() => { dom.progressBar.style.width = '0%'; }, 800);
}
