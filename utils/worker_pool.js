// worker_pool.js - Manages a pool of web workers for REGEX MATCHING ONLY
// Text extraction (PDF.js, Mammoth) stays on main thread

window.WorkerPool = class WorkerPool {
    constructor(poolSize) {
        this.poolSize = poolSize || Math.min(navigator.hardwareConcurrency || 4, 8);
        this.workers = [];
        this.taskQueue = [];
        this.activeWorkers = new Map();
        this.taskCallbacks = new Map();
        this.nextTaskId = 0;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        for (let i = 0; i < this.poolSize; i++) {
            const worker = new Worker('utils/doc_processor_worker.js');
            worker.onmessage = (e) => this._handleWorkerMessage(worker, e);
            worker.onerror = (err) => this._handleWorkerError(worker, err);
            this.workers.push(worker);
        }
        this.initialized = true;
    }

    _handleWorkerMessage(worker, e) {
        const task = this.activeWorkers.get(worker);
        if (!task) return;

        const data = e.data;

        if (data.type === 'progress') {
            const callbacks = this.taskCallbacks.get(task.id);
            if (callbacks && callbacks.onProgress) {
                callbacks.onProgress(data);
            }
        } else {
            const callbacks = this.taskCallbacks.get(task.id);
            if (callbacks) {
                if (data.type === 'error') {
                    callbacks.reject(new Error(data.error || 'Worker processing failed'));
                } else {
                    callbacks.resolve(data);
                }
                this.taskCallbacks.delete(task.id);
            }
            this.activeWorkers.delete(worker);
            this._processQueue();
        }
    }

    _handleWorkerError(worker, err) {
        const task = this.activeWorkers.get(worker);
        if (task) {
            const callbacks = this.taskCallbacks.get(task.id);
            if (callbacks) {
                callbacks.reject(err);
                this.taskCallbacks.delete(task.id);
            }
            this.activeWorkers.delete(worker);
            this._processQueue();
        }
    }

    _processQueue() {
        if (this.taskQueue.length === 0) return;

        const idleWorker = this.workers.find(w => !this.activeWorkers.has(w));
        if (!idleWorker) return;

        const { taskData, resolve, reject, onProgress } = this.taskQueue.shift();
        const taskId = this.nextTaskId++;

        this.activeWorkers.set(idleWorker, { id: taskId, taskData });
        this.taskCallbacks.set(taskId, { resolve, reject, onProgress });

        idleWorker.postMessage(taskData);
    }

    // Run regex on already-extracted text (for DOCX or plain text)
    runRegexOnText(text, fileName, keywords, fileType, cacheKey) {
        return new Promise((resolve, reject) => {
            const taskData = {
                task: 'regex-text',
                data: {
                    text: text,
                    fileName: fileName,
                    keywords: keywords || window.KEYWORDS || [],
                    fileType: fileType,
                    cacheKey: cacheKey
                }
            };

            this.taskQueue.push({
                taskData,
                resolve,
                reject,
                onProgress: null
            });

            this._processQueue();
        });
    }

    // Run regex on PDF cache data (for rescan)
    runRegexOnPDFCache(pages, fileName, keywords, cacheKey) {
        return new Promise((resolve, reject) => {
            const taskData = {
                task: 'regex-pdf-cache',
                data: {
                    pages: pages,
                    fileName: fileName,
                    keywords: keywords || window.KEYWORDS || [],
                    cacheKey: cacheKey
                }
            };

            this.taskQueue.push({
                taskData,
                resolve,
                reject,
                onProgress: null
            });

            this._processQueue();
        });
    }

    // Get number of pending + active tasks
    get pendingCount() {
        return this.taskQueue.length + this.activeWorkers.size;
    }

    // Get number of active tasks
    get activeCount() {
        return this.activeWorkers.size;
    }

    // Terminate all workers
    terminate() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];
        this.activeWorkers.clear();
        this.taskCallbacks.clear();
        this.taskQueue = [];
        this.initialized = false;
    }
};
