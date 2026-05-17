import { state } from './state.js';
import * as dom from './dom.js';

// ── state ──

let activeTool = null;     // 'distance' | 'polyline' | 'area'
let scaleX = 100;           // the X in "1:X"
let measurementsByDoc = {}; // url -> Measurement[]
let pendingPoints = [];    // points for the in-progress measurement
let previewLine = null;    // {x1,y1,x2,y2} during mouse move
let activePage = null;     // page number where the first point was placed
let isListening = false;   // whether we've attached the mousemove handler

// ── types ──

// Measurement = { id, type:'distance'|'polyline'|'area', points:[{page,x,y}], label:'...' }

// ── helpers (PDF 1x space ↔ real-world) ──

const POINTS_PER_MM = 72 / 25.4;

function pdfToMm(pdfPts) {
    return pdfPts / POINTS_PER_MM;
}

function realWorldMm(pdfPts) {
    return pdfToMm(pdfPts) * scaleX;
}

function formatLength(totalMm) {
    if (totalMm < 0) totalMm = 0;
    if (totalMm < 10) return Math.round(totalMm) + ' mm';
    if (totalMm < 1000) return (totalMm / 10).toFixed(1) + ' cm';
    return (totalMm / 1000).toFixed(2) + ' m';
}

function formatArea(mm2) {
    if (mm2 < 0) mm2 = 0;
    if (mm2 < 100) return Math.round(mm2) + ' mm\xB2';
    if (mm2 < 10000) return (mm2 / 100).toFixed(1) + ' cm\xB2';
    return (mm2 / 1000000).toFixed(2) + ' m\xB2';
}

function polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        sum += points[i].x * points[j].y;
        sum -= points[j].x * points[i].y;
    }
    return Math.abs(sum) / 2;
}

function distanceBetween(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// ── page → PDF coordinate conversion ──

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

export function setScale(value) {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0.001) return;
    scaleX = parsed;
}

export function getScale() {
    return scaleX;
}

export function getActiveTool() {
    return activeTool;
}

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
    const url = state.currentDocUrl;
    if (!url) return;
    delete measurementsByDoc[url];
    renderAllMeasurements();
}

export function getDocMeasurements(url) {
    return measurementsByDoc[url] || [];
}

// ── click handling ──

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

function finalizeDistance() {
    const url = state.currentDocUrl;
    if (!url || pendingPoints.length < 2) return;
    if (!measurementsByDoc[url]) measurementsByDoc[url] = [];

    const p1 = pendingPoints[0];
    const p2 = pendingPoints[1];
    const pdfDist = distanceBetween(p1, p2);
    const realMm = realWorldMm(pdfDist);
    const label = formatLength(realMm);

    measurementsByDoc[url].push({
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'distance',
        points: [p1, p2],
        label
    });

    pendingPoints = [];
    previewLine = null;
    activePage = null;
    renderAllMeasurements();
}

// ── perimeter ──

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
    const url = state.currentDocUrl;
    if (!url || pendingPoints.length < 2) return;
    if (!measurementsByDoc[url]) measurementsByDoc[url] = [];

    let totalPdf = 0;
    for (let i = 0; i < pendingPoints.length - 1; i++) {
        totalPdf += distanceBetween(pendingPoints[i], pendingPoints[i + 1]);
    }
    const realMm = realWorldMm(totalPdf);
    const label = formatLength(realMm);

    measurementsByDoc[url].push({
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'polyline',
        points: pendingPoints.slice(),
        label
    });

    pendingPoints = [];
    previewLine = null;
    activePage = null;
    renderAllMeasurements();
}

export function finishPerimeter() {
    if (activeTool !== 'perimeter' || pendingPoints.length < 2) return;
    finalizePerimeter();
    deactivateTool();
}

// ── area ──

function finalizeArea() {
    const url = state.currentDocUrl;
    if (!url || pendingPoints.length < 3) return;
    if (!measurementsByDoc[url]) measurementsByDoc[url] = [];

    const pdfArea = polygonArea(pendingPoints);
    const pdfPerimeter = polylineLength(pendingPoints);
    const realMm2 = pdfArea / (POINTS_PER_MM * POINTS_PER_MM) * scaleX * scaleX;
    const realPerimMm = polylineLength(pendingPoints, true) * scaleX / POINTS_PER_MM;
    const label = formatArea(realMm2);

    measurementsByDoc[url].push({
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'area',
        points: pendingPoints.slice(),
        label,
        areaMm2: realMm2
    });

    pendingPoints = [];
    previewLine = null;
    activePage = null;
    renderAllMeasurements();
}

function polylineLength(points, closed) {
    let total = 0;
    const n = closed ? points.length : points.length - 1;
    for (let i = 0; i < n; i++) {
        total += distanceBetween(points[i], points[(i + 1) % points.length]);
    }
    return total;
}

export function finishArea() {
    if (activeTool !== 'area' || pendingPoints.length < 3) return;
    finalizeArea();
    deactivateTool();
}

// ── mouse move preview ──

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

    const url = state.currentDocUrl;
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

function getPageEl(pageNum) {
    return document.getElementById('page-' + pageNum);
}

function renderMeasurement(m) {
    if (m.type === 'distance') {
        renderDistance(m.points[0], m.points[1], m.label, false);
    } else if (m.type === 'polyline') {
        renderPerimeter(m.points, m.label, false);
    } else if (m.type === 'area') {
        renderArea(m.points, m.label, false);
    }
}

function renderDistance(p1, p2, label, isPreview) {
    const pageEl = getPageEl(p1.page);
    if (!pageEl) return;
    const s = state.currentScale || 1;
    const color = isPreview ? 'var(--green)' : 'var(--highlight-current)';
    const lineW = isPreview ? 1 : 2;

    const layer = getOrCreateLayer(pageEl);

    // line
    const dx = (p2.x - p1.x) * s;
    const dy = (p2.y - p1.y) * s;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.5) return;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    const line = document.createElement('div');
    line.className = 'measure-line';
    line.style.cssText = 'position:absolute;left:' + (p1.x * s) + 'px;top:' + (p1.y * s) + 'px;' +
        'width:' + len + 'px;height:' + lineW + 'px;' +
        'background:' + color + ';transform-origin:0 50%;transform:rotate(' + angle + 'deg);' +
        'pointer-events:none;z-index:5;';
    if (!isPreview) {
        line.style.borderTop = lineW + 'px solid ' + color;
        line.style.height = '0';
        line.style.background = 'none';
    }
    layer.appendChild(line);

    // tick marks at endpoints (perpendicular to line)
    for (const p of [p1, p2]) {
        const tick = document.createElement('div');
        tick.className = 'measure-tick';
        const tickLen = isPreview ? 8 : 10;
        const tickW = 2;
        tick.style.cssText = 'position:absolute;left:' + ((p.x * s) - tickLen/2) + 'px;top:' + ((p.y * s) - tickW/2) + 'px;' +
            'width:' + tickLen + 'px;height:' + tickW + 'px;' +
            'background:' + color + ';transform-origin:50% 50%;transform:rotate(' + (angle + 90) + 'deg);' +
            'pointer-events:none;z-index:6;';
        layer.appendChild(tick);
    }

    // label
    if (label) {
        const midX = ((p1.x + p2.x) / 2) * s;
        const midY = ((p1.y + p2.y) / 2) * s;
        const lbl = document.createElement('div');
        lbl.className = 'measure-label';
        lbl.style.cssText = 'position:absolute;left:' + (midX + 6) + 'px;top:' + (midY - 10) + 'px;' +
            'font-size:11px;color:' + color + ';background:var(--toolbar-bg);padding:1px 5px;' +
            'border-radius:3px;pointer-events:none;z-index:7;white-space:nowrap;' +
            'font-family:sans-serif;border:1px solid ' + color + ';';
        lbl.textContent = label;
        layer.appendChild(lbl);
    }
}

function renderPendingPoint() {
    const p = pendingPoints[0];
    const pageEl = getPageEl(p.page);
    if (!pageEl) return;
    const s = state.currentScale || 1;
    const layer = getOrCreateLayer(pageEl);
    const tickLen = 10, tickW = 2;
    const tick = document.createElement('div');
    tick.className = 'measure-tick-pending';
    tick.style.cssText = 'position:absolute;left:' + ((p.x * s) - tickLen/2) + 'px;top:' + ((p.y * s) - tickW/2) + 'px;' +
        'width:' + tickLen + 'px;height:' + tickW + 'px;' +
        'background:var(--green);transform-origin:50% 50%;' +
        'pointer-events:none;z-index:6;box-shadow:0 0 0 1px rgba(255,255,255,0.6);';
    layer.appendChild(tick);
}

function renderPerimeter(points, label, isPreview) {
    if (points.length < 2) return;
    const pageEl = getPageEl(points[0].page);
    if (!pageEl) return;
    const s = state.currentScale || 1;
    const color = isPreview ? 'var(--green)' : 'var(--highlight-current)';
    const lineW = isPreview ? 1 : 2;
    const layer = getOrCreateLayer(pageEl);

    // draw each segment
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        const dx = (p2.x - p1.x) * s;
        const dy = (p2.y - p1.y) * s;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.5) continue;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const line = document.createElement('div');
        line.className = 'measure-line';
        line.style.cssText = 'position:absolute;left:' + (p1.x * s) + 'px;top:' + (p1.y * s) + 'px;' +
            'width:' + len + 'px;height:' + lineW + 'px;' +
            'background:' + color + ';transform-origin:0 50%;transform:rotate(' + angle + 'deg);' +
            'pointer-events:none;z-index:5;';
        if (!isPreview) {
            line.style.borderTop = lineW + 'px solid ' + color;
            line.style.height = '0';
            line.style.background = 'none';
        }
        layer.appendChild(line);
    }

    // tick at each vertex (perpendicular to incoming segment)
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let deg = 0;
        if (i > 0) {
            const dx = (p.x - points[i - 1].x) * s;
            const dy = (p.y - points[i - 1].y) * s;
            deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        } else if (i === 0 && points.length > 1) {
            const dx = (points[i + 1].x - p.x) * s;
            const dy = (points[i + 1].y - p.y) * s;
            deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        }
        const tickLen = isPreview ? 8 : 10;
        const tickW = 2;
        const tick = document.createElement('div');
        tick.className = 'measure-tick';
        tick.style.cssText = 'position:absolute;left:' + ((p.x * s) - tickLen/2) + 'px;top:' + ((p.y * s) - tickW/2) + 'px;' +
            'width:' + tickLen + 'px;height:' + tickW + 'px;' +
            'background:' + color + ';transform-origin:50% 50%;transform:rotate(' + deg + 'deg);' +
            'pointer-events:none;z-index:6;';
        layer.appendChild(tick);
    }

    // total label at centroid
    if (label) {
        const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        const midX = cx * s;
        const midY = cy * s;
        const lbl = document.createElement('div');
        lbl.className = 'measure-label';
        lbl.style.cssText = 'position:absolute;left:' + (midX + 6) + 'px;top:' + (midY - 10) + 'px;' +
            'font-size:11px;color:' + color + ';background:var(--toolbar-bg);padding:1px 5px;' +
            'border-radius:3px;pointer-events:none;z-index:7;white-space:nowrap;' +
            'font-family:sans-serif;border:1px solid ' + color + ';';
        lbl.textContent = label;
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
    const lineW = 1;

    // segments between consecutive points
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        const dx = (p2.x - p1.x) * s;
        const dy = (p2.y - p1.y) * s;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.5) continue;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const line = document.createElement('div');
        line.className = 'measure-line';
        line.style.cssText = 'position:absolute;left:' + (p1.x * s) + 'px;top:' + (p1.y * s) + 'px;' +
            'width:' + len + 'px;height:' + lineW + 'px;' +
            'background:' + color + ';transform-origin:0 50%;transform:rotate(' + angle + 'deg);' +
            'pointer-events:none;z-index:5;' +
            'border-top:' + lineW + 'px solid ' + color + ';height:0;background:none;';
        layer.appendChild(line);
    }

    // tick at each vertex
    const tickLen = 8, tickW = 2;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let angle = 0;
        if (i < points.length - 1) {
            const dx = (points[i + 1].x - p.x) * s;
            const dy = (points[i + 1].y - p.y) * s;
            angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        }
        const tick = document.createElement('div');
        tick.className = 'measure-tick-pending';
        tick.style.cssText = 'position:absolute;left:' + ((p.x * s) - tickLen/2) + 'px;top:' + ((p.y * s) - tickW/2) + 'px;' +
            'width:' + tickLen + 'px;height:' + tickW + 'px;' +
            'background:' + color + ';transform-origin:50% 50%;transform:rotate(' + angle + 'deg);' +
            'pointer-events:none;z-index:6;';
        layer.appendChild(tick);
    }
}

function renderArea(points, label, isPreview) {
    if (points.length < 3) return;
    const pageEl = getPageEl(points[0].page);
    if (!pageEl) return;
    const s = state.currentScale || 1;
    const color = isPreview ? 'var(--green)' : 'var(--highlight-current)';
    const lineW = isPreview ? 1 : 2;
    const layer = getOrCreateLayer(pageEl);

    // draw all segments (closed polygon)
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i], p2 = points[(i + 1) % points.length];
        const dx = (p2.x - p1.x) * s;
        const dy = (p2.y - p1.y) * s;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.5) continue;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const line = document.createElement('div');
        line.className = 'measure-line';
        line.style.cssText = 'position:absolute;left:' + (p1.x * s) + 'px;top:' + (p1.y * s) + 'px;' +
            'width:' + len + 'px;height:' + lineW + 'px;' +
            'background:' + color + ';transform-origin:0 50%;transform:rotate(' + angle + 'deg);' +
            'pointer-events:none;z-index:5;';
        if (!isPreview) {
            line.style.borderTop = lineW + 'px solid ' + color;
            line.style.height = '0';
            line.style.background = 'none';
        }
        layer.appendChild(line);
    }

    // tick at each vertex (perpendicular to incoming segment)
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const prev = points[(i - 1 + points.length) % points.length];
        const dx = (p.x - prev.x) * s;
        const dy = (p.y - prev.y) * s;
        const deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        const tickLen = isPreview ? 8 : 10;
        const tickW = 2;
        const tick = document.createElement('div');
        tick.className = 'measure-tick';
        tick.style.cssText = 'position:absolute;left:' + ((p.x * s) - tickLen/2) + 'px;top:' + ((p.y * s) - tickW/2) + 'px;' +
            'width:' + tickLen + 'px;height:' + tickW + 'px;' +
            'background:' + color + ';transform-origin:50% 50%;transform:rotate(' + deg + 'deg);' +
            'pointer-events:none;z-index:6;';
        layer.appendChild(tick);
    }

    // fill with semi-transparent color
    const fill = document.createElement('div');
    fill.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;' +
        'background:' + color + '10;pointer-events:none;z-index:3;';
    fill.id = 'area-fill-' + Date.now();
    const clip = points.map(p => (p.x * s) + 'px ' + (p.y * s) + 'px').join(', ');
    fill.style.clipPath = 'polygon(' + clip + ')';
    layer.appendChild(fill);

    // area label at centroid
    if (label) {
        const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        const midX = cx * s;
        const midY = cy * s;
        const lbl = document.createElement('div');
        lbl.className = 'measure-label';
        lbl.style.cssText = 'position:absolute;left:' + (midX + 6) + 'px;top:' + (midY - 10) + 'px;' +
            'font-size:11px;color:' + color + ';background:var(--toolbar-bg);padding:1px 5px;' +
            'border-radius:3px;pointer-events:none;z-index:7;white-space:nowrap;' +
            'font-family:sans-serif;border:1px solid ' + color + ';';
        lbl.textContent = label;
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

function getOrCreateLayer(pageEl) {
    let layer = pageEl.querySelector('.measure-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'measure-layer';
        layer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:4;';
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
