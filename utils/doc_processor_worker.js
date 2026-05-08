// doc_processor_worker.js - Web worker for REGEX MATCHING ONLY
// Text extraction (PDF.js, Mammoth) stays on main thread

// Helper: Create keyword regex from keywords array
function getKeywordRegex(keywords) {
    if (!keywords || keywords.length === 0) return null;
    const pattern = keywords
        .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    return new RegExp(`\\b(${pattern})\\b`, 'gi');
}

// Process regex matching on text (for DOCX or plain text)
function processRegexOnText(text, keywords) {
    const counts = {};
    let totalMatches = 0;
    const combinedRegex = getKeywordRegex(keywords);

    if (combinedRegex && text) {
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

    return { counts, totalMatches };
}

// Process regex on PDF page text data (for rescan with PDF cache)
function processRegexOnPDFCache(pages, keywords) {
    const counts = {};
    let totalMatches = 0;

    const combinedRegex = getKeywordRegex(keywords);

    if (combinedRegex) {
        for (let i = 0; i < pages.length; i++) {
            const pageData = pages[i];
            const text = pageData.text || '';

            if (text) {
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
    }

    return { counts, totalMatches };
}

// Main message handler
self.onmessage = function(e) {
    const { task, data } = e.data;

    switch (task) {
        case 'regex-text':
            {
                const result = processRegexOnText(data.text, data.keywords);
                self.postMessage({
                    type: 'regex-result',
                    fileName: data.fileName,
                    cacheKey: data.cacheKey,
                    fileType: data.fileType,
                    counts: result.counts,
                    totalMatches: result.totalMatches
                });
            }
            break;

        case 'regex-pdf-cache':
            {
                const result = processRegexOnPDFCache(data.pages, data.keywords);
                self.postMessage({
                    type: 'regex-result',
                    fileName: data.fileName,
                    cacheKey: data.cacheKey,
                    fileType: 'pdf',
                    counts: result.counts,
                    totalMatches: result.totalMatches
                });
            }
            break;

        default:
            self.postMessage({ type: 'error', error: 'Unknown task: ' + task });
    }
};
