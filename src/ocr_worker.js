importScripts('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');

let worker = null;
let ready = false;
const queue = [];

async function init() {
    worker = await Tesseract.createWorker('eng');
    ready = true;
    for (const msg of queue) processMessage(msg);
    queue.length = 0;
}

init();

async function processMessage(e) {
    const { task, data } = e.data;
    if (task === 'ocr-page') {
        try {
            const result = await worker.recognize(data.imageData);
            self.postMessage({
                type: 'ocr-result',
                text: result.data.text,
                words: result.data.words,
                imageWidth: data.imageWidth,
                imageHeight: data.imageHeight,
                pageNum: data.pageNum,
                cacheKey: data.cacheKey
            });
        } catch (err) {
            self.postMessage({
                type: 'error',
                error: err.message,
                pageNum: data.pageNum,
                cacheKey: data.cacheKey
            });
        }
    } else if (task === 'terminate') {
        if (worker) { await worker.terminate(); worker = null; }
        self.close();
    }
}

self.onmessage = function(e) {
    if (!ready) { queue.push(e); return; }
    processMessage(e);
};
