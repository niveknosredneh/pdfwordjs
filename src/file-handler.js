import { state } from './state.js';
import * as dom from './dom.js';
import { getKeywordRegex } from './keyword-regex.js';
import { fn } from './cross.js';

export function getFileType(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.docx')) return 'docx';
    if (lower.endsWith('.doc')) return 'doc';
    if (lower.endsWith('.zip')) return 'zip';
    return null;
}

function getFileIcon(filename) {
    const type = getFileType(filename);
    if (type === 'pdf') return '<img src="icons/pdf.svg" width="18" height="18" alt="pdf">';
    if (type === 'docx' || type === 'doc') return '<img src="icons/docx.svg" width="18" height="18" alt="docx">';
    if (type === 'zip') return '<img src="icons/zip.svg" width="18" height="18" alt="zip">';
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="#757575"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/></svg>';
}

import { WorkerPool } from './worker-pool.js';

export function initWorkerPool() {
    if (!state.workerPool) {
        state.workerPool = new WorkerPool();
        state.workerPool.init();
    }
}

function truncateFileName(name, maxLen) {
    if (name.length <= maxLen) return name;
    return name.slice(0, maxLen - 2) + '..';
}

function startVerboseStatus(fileName) {
    const keywords = window.KEYWORDS || [];
    const nameWithoutExt = fileName.replace(/\.(pdf|docx?)$/i, '');
    const shortName = truncateFileName(nameWithoutExt, 20);
    if (keywords.length === 0) {
        dom.statusBar.textContent = 'Scanning ' + shortName + '..';
        return;
    }
    let idx = 0;

    function updateStatus() {
        dom.statusBar.textContent = 'Scanning ' + shortName + ' for "' + keywords[idx % keywords.length] + '"';
        idx++;
        state._verboseRAF = requestAnimationFrame(updateStatus);
    }

    state._verboseRAF = requestAnimationFrame(updateStatus);
}

function stopVerboseStatus() {
    if (state._verboseRAF) {
        cancelAnimationFrame(state._verboseRAF);
        state._verboseRAF = null;
    }
}

function updateProgressMainThread() {
    state.processed++;
    const pct = state.totalFiles > 0 ? Math.round((state.processed / state.totalFiles) * 100) : 0;
    dom.progressBar.style.width = pct + '%';
}

function evictCaches() {
    const allEntries = [];

    Object.entries(state.docTextCache).forEach(([key, entry]) => {
        if (key !== state.currentDocUrl) allEntries.push({ key, entry, cacheType: 'pdf' });
    });
    Object.entries(state.docContentCache).forEach(([key, entry]) => {
        if (key !== state.currentDocUrl) allEntries.push({ key, entry, cacheType: 'docx' });
    });

    allEntries.sort((a, b) => a.entry._lastAccess - b.entry._lastAccess);

    for (const { key, entry, cacheType } of allEntries) {
        const pdfCount = Object.keys(state.docTextCache).length;
        const docxCount = Object.keys(state.docContentCache).length;
        const countOk = pdfCount <= state.MAX_CACHE_COUNT_PER_TYPE && docxCount <= state.MAX_CACHE_COUNT_PER_TYPE;
        const sizeOk = state.totalCacheSize <= state.MAX_CACHE_SIZE_TOTAL;
        if (countOk && sizeOk) break;

        if (cacheType === 'pdf') delete state.docTextCache[key];
        if (cacheType === 'docx') delete state.docContentCache[key];
        state.totalCacheSize -= (entry._size || 0);
    }
}

export async function extractPdfText(arrayBuffer, fileName, id, file) {
    try {
        const fakeDoc = {
            createElement: name => name === 'canvas' ? new OffscreenCanvas(1, 1) : null,
            fonts: {}
        };

        const pdfData = new Uint8Array(arrayBuffer);
        const pdf = await window.pdfjsLib.getDocument({ data: pdfData, ownerDocument: fakeDoc }).promise;
        const numPages = pdf.numPages;
        const pageTextData = [];

        for (let p = 1; p <= numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            const vp = page.getViewport({ scale: 1.0 });
            let pageText = '';
            for (const item of content.items) pageText += item.str;
            const textItems = [];
            for (const item of content.items) {
                textItems.push({ text: item.str, transform: item.transform, width: item.width, height: item.height });
            }
            pageTextData.push({ text: pageText, viewport: { width: vp.width, height: vp.height }, items: textItems });
        }

        const keywords = window.KEYWORDS || [];
        const combinedRegex = getKeywordRegex(keywords);
        const counts = {};
        let totalMatches = 0;

        if (combinedRegex) {
            for (const pageData of pageTextData) {
                const text = pageData.text || '';
                let match;
                const regex = new RegExp(combinedRegex.source, 'gi');
                while ((match = regex.exec(text)) !== null) {
                    if (match[0].length < 3) continue;
                    if (!/[a-zA-Z]/.test(match[0])) continue;
                    const lower = match[0].toLowerCase();
                    const key = keywords.find(k => k.toLowerCase() === lower) || lower;
                    counts[key] = (counts[key] || 0) + 1;
                    totalMatches++;
                }
            }
        }

        const pdfCacheEntry = {
            totalPages: numPages,
            pages: pageTextData,
            fileName,
            _lastAccess: Date.now(),
            _size: JSON.stringify(pageTextData).length + fileName.length
        };
        state.docTextCache[id] = pdfCacheEntry;
        state.totalCacheSize += pdfCacheEntry._size;
        evictCaches();
        state.totalDocsFound++;

        fn.renderCard(fileName, counts, id, file);
        state.totalMatchesFound += totalMatches;
        fn.updateStats();

        return pdfCacheEntry;
    } catch (err) {
        console.error('[PDF] Error processing PDF:', err);
    }
}

export async function extractDocText(arrayBuffer, fileName, id, file) {
    try {
        const type = getFileType(fileName);
        let htmlContent = '';
        let plainText = '';

        if (type === 'docx' || type === 'doc') {
            const htmlResult = await window.mammoth.convertToHtml({ arrayBuffer });
            htmlContent = htmlResult.value;
            const textResult = await window.mammoth.extractRawText({ arrayBuffer });
            plainText = textResult.value.replace(/\s+/g, ' ').trim();
        }

        if (!plainText && !htmlContent) {
            console.warn('[DOC] No text extracted from:', fileName);
            updateProgressMainThread();
            return;
        }

        const keywords = window.KEYWORDS || [];
        const combinedRegex = getKeywordRegex(keywords);
        const counts = {};
        let totalMatches = 0;
        let match;

        if (combinedRegex) {
            const regex = new RegExp(combinedRegex.source, 'gi');
            while ((match = regex.exec(plainText)) !== null) {
                if (match[0].length < 3) continue;
                if (!/[a-zA-Z]/.test(match[0])) continue;
                const lower = match[0].toLowerCase();
                const key = keywords.find(k => k.toLowerCase() === lower) || lower;
                counts[key] = (counts[key] || 0) + 1;
                totalMatches++;
            }
        }

        const docxCacheEntry = {
            html: htmlContent,
            text: plainText,
            fileName,
            type,
            _lastAccess: Date.now(),
            _size: JSON.stringify({ html: htmlContent, text: plainText }).length + fileName.length
        };
        state.docContentCache[id] = docxCacheEntry;
        state.totalCacheSize += docxCacheEntry._size;
        evictCaches();
        state.totalDocsFound++;

        fn.renderCard(fileName, counts, id, file);
        state.totalMatchesFound += totalMatches;
        fn.updateStats();

        return docxCacheEntry;
    } catch (err) {
        console.error('[DOC] Error processing document:', err);
    }
}

async function processFiles(files) {
    if (files.length === 0) return;

    const viewerMsg = document.getElementById('viewerDropMsg');
    if (viewerMsg) viewerMsg.style.display = 'none';

    const statusMsgs = dom.resultsArea.querySelectorAll('.status-msg');
    statusMsgs.forEach(el => el.remove());

    dom.progressBar.style.width = '0%';

    state.processed = 0;
    state.totalFiles = files.length;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const url = URL.createObjectURL(file);
        state.objectUrls.push(url);

        startVerboseStatus(file.name);

        fn.renderPlaceholderCard(file.name, url, file);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const type = getFileType(file.name);

            if (type === 'pdf') {
                await extractPdfText(arrayBuffer, file.name, url, file);
            } else if (type === 'docx' || type === 'doc') {
                await extractDocText(arrayBuffer, file.name, url, file);
            }
        } finally {
            stopVerboseStatus();
            updateProgressMainThread();
            fn.updateStats();
        }
    }
}

export async function handleDrop(e) {
    const entries = [];
    if (e.dataTransfer.items) {
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
            const entry = e.dataTransfer.items[i].webkitGetAsEntry();
            if (entry) entries.push(entry);
        }
    }
    state.basePath = '';
    let filesToProcess = [];

    const viewerMsg = document.getElementById('viewerDropMsg');
    if (viewerMsg) viewerMsg.style.display = 'none';
    const statusMsgs = dom.resultsArea.querySelectorAll('.status-msg');
    statusMsgs.forEach(el => el.remove());

    for (const entry of entries) {
        if (entry.isFile && entry.name.toLowerCase().endsWith('.zip')) {
            dom.statusBar.textContent = 'Unzipping ' + entry.name + '...';
            dom.progressBar.style.width = '0%';
            const zipFile = await new Promise((resolve) => entry.file(resolve));
            state.basePath = zipFile.name.replace(/\.zip$/i, '');
            filesToProcess = filesToProcess.concat(await extractAllFromZip(zipFile));
        } else {
            dom.statusBar.textContent = 'Reading folder "' + entry.name + '"...';
            dom.progressBar.style.width = '0%';
            await traverseFileTree(entry, filesToProcess, '');
            state.basePath = entry.name;
        }
    }

    if (filesToProcess.length === 0) {
        dom.statusBar.textContent = 'No supported files found';
        dom.progressBar.style.width = '0%';
    } else {
        processFiles(filesToProcess);
    }
}

async function traverseFileTree(item, fileList, baseDir = '') {
    const currentPath = baseDir ? baseDir + '/' + item.name : item.name;
    const type = getFileType(item.name);
    if (item.isFile && type) {
        const file = await new Promise((resolve) => item.file(resolve));
        file.relativePath = currentPath;
        fileList.push(file);
        if (fileList.length % 10 === 0) {
            dom.statusBar.textContent = 'Reading folder: found ' + fileList.length + ' files...';
        }
    } else if (item.isDirectory) {
        const dirReader = item.createDirectoryReader ? item.createDirectoryReader() : item.createReader();
        let entries = [];
        while (true) {
            const batch = await new Promise((resolve) => dirReader.readEntries(resolve));
            if (batch.length === 0) break;
            entries.push(...batch);
        }
        for (const entry of entries) await traverseFileTree(entry, fileList, currentPath);
    }
}

async function extractAllFromZip(zipFile) {
    const sizeMB = (zipFile.size / (1024 * 1024)).toFixed(1);
    dom.statusBar.textContent = sizeMB + ' MB - Unzipping ' + zipFile.name + '...';
    const zip = await window.JSZip.loadAsync(zipFile);

    const entries = [];
    zip.forEach((path, entry) => {
        if (!entry.dir && getFileType(path)) entries.push({ path, entry });
    });

    const total = entries.length;
    const extracted = [];
    let done = 0;

    for (const { path, entry } of entries) {
        const blob = await entry.async('blob');
        let mimeType = 'application/pdf';
        const type = getFileType(path);
        if (type === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (type === 'doc') mimeType = 'application/msword';
        const file = new File([blob], path, { type: mimeType });
        file.relativePath = path;
        extracted.push(file);
        done++;
        const pct = Math.round((done / total) * 100);
        dom.statusBar.textContent = pct + '% - Unzipping ' + zipFile.name + ': ' + done + '/' + total + ' files';
        dom.progressBar.style.width = pct + '%';
    }

    return extracted;
}

dom.sidebar.addEventListener('drop', (e) => {
    e.preventDefault();
    handleDrop(e);
});

export async function rescanAllDocuments() {
    const viewerMsg = document.getElementById('viewerDropMsg');
    if (viewerMsg) viewerMsg.style.display = 'none';

    dom.statusBar.textContent = 'Scanning ' + state.objectUrls.length + ' documents...';
    dom.progressBar.style.width = '0%';

    dom.resultsArea.innerHTML = '';

    state.totalMatchesFound = 0;
    state.totalDocsFound = 0;
    state.processed = 0;
    state.totalFiles = state.objectUrls.length;

    initWorkerPool();
    const keywords = window.KEYWORDS || [];

    for (let i = 0; i < state.objectUrls.length; i++) {
        const url = state.objectUrls[i];
        const pdfCached = state.docTextCache[url];

        if (pdfCached) {
            try {
                const result = await state.workerPool.runRegexOnPDFCache(
                    pdfCached.pages, pdfCached.fileName || url.split('/').pop(), keywords, url
                );

                const displayName = pdfCached.fileName || 'Document ' + (i + 1);
                state.totalDocsFound++;

                if (result.totalMatches > 0) {
                    fn.renderCard(displayName, result.counts, url);
                    state.totalMatchesFound += result.totalMatches;
                } else {
                    fn.renderNoMatchCard(displayName, url);
                }
            } catch (err) {
                console.error('[Worker] PDF rescan error:', err);
            }
        } else {
            const docCached = state.docContentCache[url];
            if (docCached) {
                try {
                    const result = await state.workerPool.runRegexOnText(
                        docCached.text, docCached.fileName || url.split('/').pop(), keywords, 'docx', url
                    );

                    const displayName = docCached.fileName || 'Document ' + (i + 1);
                    state.totalDocsFound++;

                    if (result.totalMatches > 0) {
                        fn.renderCard(displayName, result.counts, url);
                        state.totalMatchesFound += result.totalMatches;
                    } else {
                        fn.renderNoMatchCard(displayName, url);
                    }
                } catch (err) {
                    console.error('[Worker] DOCX rescan error:', err);
                }
            }
        }

        state.processed++;
        const pct = Math.round(((i + 1) / state.objectUrls.length) * 100);
        dom.progressBar.style.width = pct + '%';
    }

    fn.updateStats();

    if (state.totalMatchesFound === 0) {
        dom.statusBar.textContent = 'No matches found';
    } else {
        dom.statusBar.textContent = state.totalMatchesFound + ' matches across ' + state.totalDocsFound + ' document' + (state.totalDocsFound !== 1 ? 's' : '');
    }
}

export async function rescanWithNewKeywords() {
    if (!state.pdfDoc || !state.currentDocUrl) return;

    initWorkerPool();
    const keywords = window.KEYWORDS || [];

    let fullText = '';
    for (let p = 1; p <= state.totalPages; p++) {
        if (state.textPageCache[p] && state.textPageCache[p].text) {
            fullText += state.textPageCache[p].text;
        }
    }

    try {
        const result = await state.workerPool.runRegexOnText(fullText, 'current-document', keywords, 'pdf', state.currentDocUrl);

        const docCounts = result.counts || {};
        const totalMatches = result.totalMatches || 0;

        const activeCard = dom.viewer.querySelector('.doc-card.active, .file.active')?.closest('.doc-card') || dom.viewer.querySelector('.doc-card.active');
        if (activeCard) {
            const cardName = activeCard.querySelector('.doc-name').textContent;
            const badgeGrid = activeCard.querySelector('.badge-grid');
            if (badgeGrid) {
                badgeGrid.innerHTML = '';
                keywords.forEach(k => {
                    const count = docCounts[k] || 0;
                    if (count > 0) {
                        const b = document.createElement('div');
                        b.className = 'badge';
                        b.textContent = k + ': ' + count;
                        b.onclick = (e) => {
                            e.stopPropagation();
                            fn.cycleSearch(k);
                        };
                        badgeGrid.appendChild(b);
                    }
                });
            }
        }

        state.totalMatchesFound = totalMatches;
        fn.updateStats();
        fn.precomputeAllSearches();
    } catch (err) {
        console.error('[Worker] Rescan with new keywords error:', err);
    }
}

dom.folderInput.addEventListener('change', async (e) => {
    const viewerMsg = document.getElementById('viewerDropMsg');
    if (viewerMsg) viewerMsg.style.display = 'none';
    const statusMsgs = dom.resultsArea.querySelectorAll('.status-msg');
    statusMsgs.forEach(el => el.remove());

    let filesToProcess = [];
    const items = Array.from(e.target.files);
    const hasZip = items.some(f => f.name.toLowerCase().endsWith('.zip'));
    const folderName = items.length > 0 ? (items[0].webkitRelativePath || '').split('/')[0] : '';

    if (hasZip) {
        dom.statusBar.textContent = 'Processing ZIP file...';
        dom.progressBar.style.width = '0%';
    } else if (folderName) {
        dom.statusBar.textContent = 'Reading folder "' + folderName + '"...';
        dom.progressBar.style.width = '0%';
    }

    for (const file of items) {
        const type = getFileType(file.name);
        if (file.name.toLowerCase().endsWith('.zip')) {
            filesToProcess = filesToProcess.concat(await extractAllFromZip(file));
        } else if (type) {
            file.relativePath = file.webkitRelativePath || file.name;
            filesToProcess.push(file);
        }
    }

    if (filesToProcess.length === 0) {
        dom.statusBar.textContent = 'No supported files found';
        dom.progressBar.style.width = '0%';
    } else {
        processFiles(filesToProcess);
    }
});
