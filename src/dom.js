export const viewer = document.getElementById('pdfViewer');
export const viewerScroll = document.getElementById('viewerScroll');
export const loader = document.getElementById('viewerLoader');
export const loaderFilename = document.getElementById('loaderFilename');
export const loaderStatus = document.getElementById('loaderStatus');
export const loaderProgressFill = document.getElementById('loaderProgressFill');
export const matchTotal = document.getElementById('matchTotal');
export const navGroup = document.getElementById('navGroup');
export const navSep = document.getElementById('navSep');
export const zoomLevelEl = document.getElementById('zoomLevel');
export const pageInput = document.getElementById('pageInput');
export const pageTotal = document.getElementById('pageTotal');
export const matchInput = document.getElementById('matchInput');
export const keywordSelect = document.getElementById('keywordSelect');
export const resultsArea = document.getElementById('results');
let _progressPb = null;

async function initProgressBar() {
    const container = document.querySelector('.progress-svg-wrap');
    if (!container) return;
    try {
        const resp = await fetch('icons/logo.svg');
        const text = await resp.text();
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(text, 'image/svg+xml');
        const srcPath = svgDoc.querySelector('path');
        if (!srcPath) return;
        const d = srcPath.getAttribute('d');
        const vb = svgDoc.documentElement.getAttribute('viewBox') || '0 0 1000 1000';
        container.innerHTML = '<svg viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet">'
            + '<path d="' + d + '" fill="none" stroke="var(--grey-500)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />'
            + '<path id="progressBar-svg-path" d="' + d + '" fill="none" stroke="#8cc63f" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />'
            + '</svg>';
        if (typeof ProgressBar !== 'undefined') {
            _progressPb = new ProgressBar.Path('#progressBar-svg-path', { duration: 500, easing: 'easeInOut' });
        }
    } catch (e) {
        console.warn('[Progress] Failed to load logo.svg:', e);
    }
}

initProgressBar();

const _proxyStyle = {};
Object.defineProperty(_proxyStyle, 'width', {
    set(v) {
        const pct = parseInt(v) / 100;
        if (!isNaN(pct) && _progressPb) {
            if (pct <= 0) _progressPb.set(0);
            else _progressPb.animate(pct);
        }
    }
});
export const progressBar = { style: _proxyStyle };
export const sidebar = document.getElementById('sidebar');
export const statusBar = document.getElementById('statusBar');
export const verboseStatusBar = document.getElementById('verboseStatusBar');
export const folderInput = document.getElementById('folderInput');
export const keywordManager = document.getElementById('keywordManager');
export const keywordInput = document.getElementById('keywordInput');
export const listSelector = document.getElementById('listSelector');
export const keywordListSelect = document.getElementById('keywordListSelect');
export const newListDialog = document.getElementById('newListDialog');
export const newListName = document.getElementById('newListName');
export const deleteListBtn = document.getElementById('deleteListBtn');
export const listInfo = document.getElementById('listInfo');
export const settingsBtn = document.getElementById('settingsBtn');
export const resizer = document.getElementById('resizer');
export const viewerContainer = document.querySelector('.viewer-container');
export const viewerDropMsg = document.getElementById('viewerDropMsg');
