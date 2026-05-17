import { state } from './state.js';
import * as dom from './dom.js';

// ── state ──

/** @type {'distance'|'polyline'|'area'|null} */
let activeTool = null;
/** @type {number} the X in "1:X" */
let scaleX = 100;
/** @type {Object<string, Array<{id:string, type:string, points:Array, label:string, areaMm2?:number}>>} */
let measurementsByDoc = {};
/** @type {Array<{page:number, x:number, y:number}>} */
let pendingPoints = [];
/** @type {{x1:number, y1:number, x2:number, y2:number}|null} */
let previewLine = null;
/** @type {number|null} */
let activePage = null;
/** @type {boolean} */
let isListening = false;

const STORAGE_KEY = 'kwpdf_measurements';
const SCALE_STORAGE_KEY = 'kwpdf_measure_scale';
const MAX_SCALE = 10000000;

// ── stable doc key (filenames persist across reloads, blob URLs don't) ──

function getDocKey() {
    const url = state.currentDocUrl;
    if (!url) return null;
    const entry = state.docDataCache[url];
    return entry?.fullPath || url;
}

// ── persistence ──

function loadMeasurements() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) measurementsByDoc = JSON.parse(raw);
    } catch (e) { /* ignore */ }
}

function saveMeasurements() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(measurementsByDoc));
    } catch (e) { /* quota exceeded, ignore */ }
}

function loadScale() {
    try {
        const raw = localStorage.getItem(SCALE_STORAGE_KEY);
        if (raw) {
            const parsed = parseFloat(raw);
            if (!isNaN(parsed) && parsed >= 0.001 && parsed <= MAX_SCALE) scaleX = parsed;
        }
    } catch (e) { /* ignore */ }
}

function saveScale() {
    try {
        localStorage.setItem(SCALE_STORAGE_KEY, String(scaleX));
    } catch (e) { /* ignore */ }
}

loadMeasurements();
loadScale();

// ── helpers (PDF 1x space ↔ real-world) ──

const POINTS_PER_MM = 72 / 25.4;

/** @param {number} pdfPts */
function pdfToMm(pdfPts) {
    return pdfPts / POINTS_PER_MM;
}

/** @param {number} pdfPts */
function realWorldMm(pdfPts) {
    return pdfToMm(pdfPts) * scaleX;
}

/** @param {number} totalMm */
function formatLength(totalMm) {
    if (totalMm < 0) totalMm = 0;
    if (totalMm < 10) return Math.round(totalMm) + ' mm';
    if (totalMm < 1000) return (totalMm / 10).toFixed(1) + ' cm';
    return (totalMm / 1000).toFixed(2) + ' m';
}

/** @param {number} mm2 */
function formatArea(mm2) {
    if (mm2 < 0) mm2 = 0;
    if (mm2 < 100) return Math.round(mm2) + ' mm\xB2';
    if (mm2 < 10000) return (mm2 / 100).toFixed(1) + ' cm\xB2';
    return (mm2 / 1000000).toFixed(2) + ' m\xB2';
}

/** @param {Array<{x:number, y:number}>} points */
function polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        sum += points[i].x * points[j].y;
        sum -= points[j].x * points[i].y;
    }
    return Math.abs(sum) / 2;
}

/** @param {{x:number, y:number}} p1 @param {{x:number, y:number}} p2 */
function distanceBetween(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/** @param {Array<{x:number, y:number}>} points @param {boolean} [closed] */
function polylineLength(points, closed) {
    let total = 0;
    const n = closed ? points.length : points.length - 1;
    for (let i = 0; i < n; i++) {
        total += distanceBetween(points[i], points[(i + 1) % points.length]);
    }
    return total;
}

// ── page → PDF coordinate conversion ──

/** @param {MouseEvent} e @returns {{page:number, x:number, y:number}|null} */
function pageEventToPdfCoords(e) {
    let el = e.target;
    while (el && !el.id?.startsWith('page-')) el = el.parentElement;
    if (!el) return null;
    const pageNum = parseInt(el.id.replace('page-', ''));
    if (isNaN(pageNum)) return null;
    const rect = el.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    const scale = state.currentScale || 1;
    return { page: pageNum, x: xPx / scale, y: yPx / scale };
}

// ── public API ──

/** @param {number|string} value */
export function setScale(value) {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0.001 || parsed > MAX_SCALE) return;
    scaleX = parsed;
    saveScale();
}

export function getScale() {
    return scaleX;
}

export function getActiveTool() {
    return activeTool;
}

/** @param {'distance'|'polyline'|'area'} tool */
export function activateTool(tool) {
    if (activeTool === tool) {
        deactivateTool();
        return;
    }
    deactivateTool();
    activeTool = tool;
    pendingPoints = [];
    previewLine = null;
    activePage = null;
    if (!isListening) {
        dom.viewerScroll.addEventListener('mousemove', onMouseMove);
        isListening = true;
    }
}

export function deactivateTool() {
    activeTool = null;
    pendingPoints = [];
    previewLine = null;
    activePage = null;
    if (isListening) {
        dom.viewerScroll.removeEventListener('mousemove', onMouseMove);
        isListening = false;
    }
    renderAllMeasurements();
}

export function cancelMeasurement() {
    pendingPoints = [];
    previewLine = null;
    activePage = null;
    renderAllMeasurements();
}

export function clearAllMeasurements() {
    const url = getDocKey();
    if (!url) return;
    delete measurementsByDoc[url];
    saveMeasurements();
    renderAllMeasurements();
}

/** @param {string} id */
export function deleteMeasurement(id) {
    const url = getDocKey();
    if (!url || !measurementsByDoc[url]) return;
    measurementsByDoc[url] = measurementsByDoc[url].filter(m => m.id !== id);
    saveMeasurements();
    renderAllMeasurements();
}

/** @param {string} url */
export function getDocMeasurements(url) {
    return measurementsByDoc[url] || [];
}

// ── click handling ──

/** @param {MouseEvent} e */
export function onPageClick(e) {
    if (!activeTool) return;
    const coords = pageEventToPdfCoords(e);
    if (!coords) return;

    if (activeTool === 'distance') {
        handleDistanceClick(coords);
    } else if (activeTool === 'perimeter') {
        handlePerimeterClick(coords);
    } else if (activeTool === 'area') {
        handlePerimeterClick(coords);
    }
}

/** @param {{page:number, x:number, y:number}} coords */
function handleDistanceClick(coords) {
    if (pendingPoints.length === 0) {
        pendingPoints.push(coords);
        activePage = coords.page;
        renderAllMeasurements();
        return;
    }

    if (pendingPoints.length === 1) {
        if (pendingPoints[0].page !== coords.page) {
            pendingPoints = [coords];
            activePage = coords.page;
            renderAllMeasurements();
            return;
        }
        pendingPoints.push(coords);
        finalizeDistance();
    }
}

function generateId() {
    return Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function finalizeDistance() {
    const url = getDocKey();
    if (!url || pendingPoints.length < 2) return;
    if (!measurementsByDoc[url]) measurementsByDoc[url] = [];

    const p1 = pendingPoints[0];
    const p2 = pendingPoints[1];
    const pdfDist = distanceBetween(p1, p2);
    const realMm = realWorldMm(pdfDist);
    const label = formatLength(realMm);

    measurementsByDoc[url].push({
        id: generateId(),
        type: 'distance',
        points: [p1, p2],
        label
    });

    pendingPoints = [];
    previewLine = null;
    activePage = null;
    saveMeasurements();
    renderAllMeasurements();
}

// ── perimeter ──

/** @param {{page:number, x:number, y:number}} coords */
function handlePerimeterClick(coords) {
    if (pendingPoints.length === 0) {
        pendingPoints.push(coords);
        activePage = coords.page;
        renderAllMeasurements();
        return;
    }
    if (coords.page !== activePage) return;
    pendingPoints.push(coords);
    renderAllMeasurements();
}

function finalizePerimeter() {
    const url = getDocKey();
    if (!url || pendingPoints.length < 2) return;
    if (!measurementsByDoc[url]) measurementsByDoc[url] = [];

    let totalPdf = 0;
    for (let i = 0; i < pendingPoints.length - 1; i++) {
        totalPdf += distanceBetween(pendingPoints[i], pendingPoints[i + 1]);
    }
    const realMm = realWorldMm(totalPdf);
    const label = formatLength(realMm);

    measurementsByDoc[url].push({
        id: generateId(),
        type: 'polyline',
        points: pendingPoints.slice(),
        label
    });

    pendingPoints = [];
    previewLine = null;
    activePage = null;
    saveMeasurements();
    renderAllMeasurements();
}

export function finishPerimeter() {
    if (activeTool !== 'perimeter' || pendingPoints.length < 2) return;
    finalizePerimeter();
    deactivateTool();
}

// ── area ──

function finalizeArea() {
    const url = getDocKey();
    if (!url || pendingPoints.length < 3) return;
    if (!measurementsByDoc[url]) measurementsByDoc[url] = [];

    const pdfArea = polygonArea(pendingPoints);
    const realMm2 = pdfArea / (POINTS_PER_MM * POINTS_PER_MM) * scaleX * scaleX;
    const label = formatArea(realMm2);

    measurementsByDoc[url].push({
        id: generateId(),
        type: 'area',
        points: pendingPoints.slice(),
        label,
        areaMm2: realMm2
    });

    pendingPoints = [];
    previewLine = null;
    activePage = null;
    saveMeasurements();
    renderAllMeasurements();
}

export function finishArea() {
    if (activeTool !== 'area' || pendingPoints.length < 3) return;
    finalizeArea();
    deactivateTool();
}

// ── mouse move preview ──

/** @param {MouseEvent} e */
function onMouseMove(e) {
    if (!activeTool || pendingPoints.length === 0) return;
    const coords = pageEventToPdfCoords(e);
    if (!coords) return;
    if (coords.page !== activePage) {
        if (previewLine) {
            previewLine = null;
            renderAllMeasurements();
        }
        return;
    }
    const last = pendingPoints[pendingPoints.length - 1];
    previewLine = {
        x1: last.x,
        y1: last.y,
        x2: coords.x,
        y2: coords.y
    };
    renderAllMeasurements();
}

// ── rendering ──

function clearMeasurementOverlays() {
    document.querySelectorAll('.measure-layer').forEach(el => el.remove());
}

export function renderAllMeasurements() {
    clearMeasurementOverlays();

    const url = getDocKey();
    const docs = measurementsByDoc[url] || [];

    for (const m of docs) {
        renderMeasurement(m);
    }

    if (pendingPoints.length > 0 && activePage) {
        if (activeTool === 'distance') {
            renderPendingPoint();
        } else if ((activeTool === 'perimeter' || activeTool === 'area') && pendingPoints.length >= 2) {
            renderPendingPerimeter();
        }
    }

    if (previewLine && activePage) {
        renderPreviewLine();
    }
}

/** @param {number} pageNum */
function getPageEl(pageNum) {
    return document.getElementById('page-' + pageNum);
}

/** @param {{id:string, type:string, points:Array, label:string, areaMm2?:number}} m */
function renderMeasurement(m) {
    if (m.type === 'distance') {
        renderDistance(m.points[0], m.points[1], m.label, false, m.id);
    } else if (m.type === 'polyline') {
        renderPerimeter(m.points, m.label, false, m.id);
    } else if (m.type === 'area') {
        renderArea(m.points, m.label, false, m.id);
    }
}

// ── label helper ──

/** @param {number} x @param {number} y @param {string} color @param {string} text @param {string} [measId] */
function createLabel(x, y, color, text, measId) {
    const lbl = document.createElement('div');
    lbl.className = 'measure-label';
    lbl.style.left = (x + 6) + 'px';
    lbl.style.top = (y - 10) + 'px';
    lbl.style.color = color;
    lbl.style.borderColor = color;
    if (measId) {
        lbl.textContent = text + '  \u00D7';
        lbl.title = 'Click to delete';
        lbl.style.cursor = 'pointer';
        lbl.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteMeasurement(measId);
        });
    } else {
        lbl.textContent = text;
    }
    return lbl;
}

/** @param {number} x @param {number} y @param {number} tickLen @param {number} tickW @param {number} deg @param {string} color @param {string} className */
function createTick(x, y, tickLen, tickW, deg, color, className) {
    const tick = document.createElement('div');
    tick.className = className;
    tick.style.left = (x - tickLen / 2) + 'px';
    tick.style.top = (y - tickW / 2) + 'px';
    tick.style.width = tickLen + 'px';
    tick.style.height = tickW + 'px';
    tick.style.background = color;
    tick.style.transform = 'rotate(' + deg + 'deg)';
    return tick;
}

function renderDistance(p1, p2, label, isPreview, measId) {
    const pageEl = getPageEl(p1.page);
    if (!pageEl) return;
    const s = state.currentScale || 1;
    const color = isPreview ? 'var(--green)' : 'var(--highlight-current)';
    const lineW = isPreview ? 1 : 2;

    const layer = getOrCreateLayer(pageEl);

    const dx = (p2.x - p1.x) * s;
    const dy = (p2.y - p1.y) * s;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.5) return;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    const line = document.createElement('div');
    line.className = 'measure-line m-line';
    line.style.left = (p1.x * s) + 'px';
    line.style.top = (p1.y * s) + 'px';
    line.style.width = len + 'px';
    line.style.transform = 'rotate(' + angle + 'deg)';
    line.dataset.lineW = lineW;
    line.dataset.color = color;
    if (!isPreview) {
        line.classList.add('m-line-final');
        line.style.borderTopColor = color;
    }
    layer.appendChild(line);

    const tickLen = isPreview ? 8 : 10;
    const tickW = 2;
    const tickAngle = angle + 90;
    for (const p of [p1, p2]) {
        const tx = p.x * s;
        const ty = p.y * s;
        const tick = createTick(tx, ty, tickLen, tickW, tickAngle, color, 'measure-tick');
        layer.appendChild(tick);
    }

    if (label) {
        const midX = ((p1.x + p2.x) / 2) * s;
        const midY = ((p1.y + p2.y) / 2) * s;
        const lbl = createLabel(midX, midY, color, label, measId);
        layer.appendChild(lbl);
    }
}

function renderPendingPoint() {
    const p = pendingPoints[0];
    const pageEl = getPageEl(p.page);
    if (!pageEl) return;
    const s = state.currentScale || 1;
    const layer = getOrCreateLayer(pageEl);
    const tx = p.x * s;
    const ty = p.y * s;
    const tick = createTick(tx, ty, 10, 2, 0, 'var(--green)', 'measure-tick-pending');
    tick.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.6)';
    layer.appendChild(tick);
}

function renderPerimeter(points, label, isPreview, measId) {
    if (points.length < 2) return;
    const pageEl = getPageEl(points[0].page);
    if (!pageEl) return;
    const s = state.currentScale || 1;
    const color = isPreview ? 'var(--green)' : 'var(--highlight-current)';
    const lineW = isPreview ? 1 : 2;
    const layer = getOrCreateLayer(pageEl);

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        drawLineSegment(layer, p1, p2, s, color, lineW, !isPreview);
    }

    const tickLen = isPreview ? 8 : 10;
    const tickW = 2;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let deg = 0;
        if (i > 0) {
            const dx = (p.x - points[i - 1].x) * s;
            const dy = (p.y - points[i - 1].y) * s;
            deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        } else if (points.length > 1) {
            const dx = (points[i + 1].x - p.x) * s;
            const dy = (points[i + 1].y - p.y) * s;
            deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        }
        const tx = p.x * s;
        const ty = p.y * s;
        const tick = createTick(tx, ty, tickLen, tickW, deg, color, 'measure-tick');
        layer.appendChild(tick);
    }

    if (label) {
        const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        const lbl = createLabel(cx * s, cy * s, color, label, measId);
        layer.appendChild(lbl);
    }
}

function renderPendingPerimeter() {
    const points = pendingPoints;
    if (points.length < 2 || !activePage) return;
    const pageEl = getPageEl(activePage);
    if (!pageEl) return;
    const s = state.currentScale || 1;
    const layer = getOrCreateLayer(pageEl);
    const color = 'var(--green)';

    for (let i = 0; i < points.length - 1; i++) {
        drawLineSegment(layer, points[i], points[i + 1], s, color, 1, true);
    }

    const tickLen = 8, tickW = 2;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let deg = 0;
        if (i < points.length - 1) {
            const dx = (points[i + 1].x - p.x) * s;
            const dy = (points[i + 1].y - p.y) * s;
            deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        }
        const tx = p.x * s;
        const ty = p.y * s;
        const tick = createTick(tx, ty, tickLen, tickW, deg, color, 'measure-tick-pending');
        layer.appendChild(tick);
    }

    // running length label for perimeter/area
    const totalPdf = polylineLength(points, false);
    if (activeTool === 'perimeter') {
        const realMm = realWorldMm(totalPdf);
        const lblText = formatLength(realMm);
        const last = points[points.length - 1];
        const lbl = createLabel(last.x * s + 10, last.y * s - 10, 'var(--green)', lblText);
        layer.appendChild(lbl);
    }
}

/** @param {HTMLElement} layer @param {{x:number, y:number}} p1 @param {{x:number, y:number}} p2 @param {number} s @param {string} color @param {number} lineW @param {boolean} finalStyle */
function drawLineSegment(layer, p1, p2, s, color, lineW, finalStyle) {
    const dx = (p2.x - p1.x) * s;
    const dy = (p2.y - p1.y) * s;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.5) return;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    const line = document.createElement('div');
    line.className = 'measure-line m-line';
    line.style.left = (p1.x * s) + 'px';
    line.style.top = (p1.y * s) + 'px';
    line.style.width = len + 'px';
    line.style.transform = 'rotate(' + angle + 'deg)';
    line.dataset.lineW = lineW;
    line.dataset.color = color;
    if (finalStyle) {
        line.classList.add('m-line-final');
        line.style.borderTopColor = color;
    }
    layer.appendChild(line);
}

function renderArea(points, label, isPreview, measId) {
    if (points.length < 3) return;
    const pageEl = getPageEl(points[0].page);
    if (!pageEl) return;
    const s = state.currentScale || 1;
    const color = isPreview ? 'var(--green)' : 'var(--highlight-current)';
    const lineW = isPreview ? 1 : 2;
    const layer = getOrCreateLayer(pageEl);

    for (let i = 0; i < points.length; i++) {
        const p1 = points[i], p2 = points[(i + 1) % points.length];
        drawLineSegment(layer, p1, p2, s, color, lineW, !isPreview);
    }

    const tickLen = isPreview ? 8 : 10;
    const tickW = 2;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const prev = points[(i - 1 + points.length) % points.length];
        const dx = (p.x - prev.x) * s;
        const dy = (p.y - prev.y) * s;
        const deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        const tx = p.x * s;
        const ty = p.y * s;
        const tick = createTick(tx, ty, tickLen, tickW, deg, color, 'measure-tick');
        layer.appendChild(tick);
    }

    // fill
    const fill = document.createElement('div');
    fill.className = 'measure-fill';
    const clip = points.map(p => (p.x * s) + 'px ' + (p.y * s) + 'px').join(', ');
    fill.style.clipPath = 'polygon(' + clip + ')';
    fill.style.background = color + '18';
    layer.appendChild(fill);

    if (label) {
        const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        const lbl = createLabel(cx * s, cy * s, color, label, measId);
        layer.appendChild(lbl);
    }
}

function renderPreviewLine() {
    if (!previewLine) return;
    const p1 = { x: previewLine.x1, y: previewLine.y1 };
    const p2 = { x: previewLine.x2, y: previewLine.y2 };
    const pdfDist = distanceBetween(p1, p2);
    const realMm = realWorldMm(pdfDist);
    const label = formatLength(realMm);
    renderDistance(p1, p2, label, true);
}

/** @param {HTMLElement} pageEl @returns {HTMLElement} */
function getOrCreateLayer(pageEl) {
    let layer = pageEl.querySelector('.measure-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'measure-layer';
        pageEl.appendChild(layer);
    }
    return layer;
}

export function refreshAllMeasurements() {
    renderAllMeasurements();
}

export function handleZoomChange() {
    renderAllMeasurements();
}
