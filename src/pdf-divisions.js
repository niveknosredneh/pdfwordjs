import { state } from './state.js';

function scrollToPage(pageNum) {
    const pageEl = document.getElementById('page-' + pageNum);
    let targetOffset = 0;
    if (pageEl) {
        targetOffset = pageEl.offsetTop;
    } else {
        for (let i = 1; i < pageNum; i++) {
            targetOffset += (state.pageHeights[i] * state.currentScale || 800) + 32;
        }
    }
    const viewerScroll = document.getElementById('viewerScroll');
    if (viewerScroll) {
        viewerScroll.scrollTo({ top: targetOffset, behavior: state.smoothScrollEnabled ? 'smooth' : 'auto' });
    }
    state.currentPage = pageNum;
}

async function resolveDest(dest, pdfDoc) {
    if (!dest) return null;
    try {
        let destArray;
        if (typeof dest === 'string') {
            const ref = await pdfDoc.getDestination(dest);
            destArray = ref;
        } else if (Array.isArray(dest)) {
            destArray = dest;
        } else if (dest instanceof Uint8Array || typeof dest === 'object') {
            destArray = await pdfDoc.getDestination(dest);
        } else {
            return null;
        }
        if (destArray && destArray[0]) {
            const pageIndex = await pdfDoc.getPageIndex(destArray[0]);
            return pageIndex + 1;
        }
    } catch (e) {
        return null;
    }
    return null;
}

async function flattenOutline(outline, pdfDoc) {
    const items = [];
    const seen = new Set();

    async function walk(list) {
        if (!list) return;
        for (const item of list) {
            const pageNum = await resolveDest(item.dest, pdfDoc);
            if (pageNum && !seen.has(pageNum)) {
                seen.add(pageNum);
                items.push({ title: item.title.trim(), pageNum });
            }
            if (item.items && item.items.length > 0) {
                await walk(item.items);
            }
        }
    }

    await walk(outline);
    return items;
}

export async function extractDivisions(pdfDoc) {
    if (!pdfDoc) return [];
    try {
        const outline = await pdfDoc.getOutline();
        if (!outline || outline.length === 0) return [];
        return flattenOutline(outline, pdfDoc);
    } catch (e) {
        console.warn('Failed to extract PDF outline:', e);
        return [];
    }
}

export function populateRibbon(divisions) {
    const ribbon = document.getElementById('divisionRibbon');
    if (!ribbon) return;

    if (!divisions || divisions.length === 0) {
        ribbon.style.display = 'none';
        return;
    }

    ribbon.innerHTML = '';
    divisions.forEach((div, index) => {
        const tab = document.createElement('button');
        tab.className = 'division-tab';
        tab.textContent = div.title;
        tab.title = div.title;
        tab.dataset.pageNum = div.pageNum;
        tab.addEventListener('click', (e) => {
            if (ribbon.classList.contains('is-dragging')) {
                e.preventDefault();
                return;
            }
            setActiveTab(index);
            scrollToPage(div.pageNum);
        });
        ribbon.appendChild(tab);
    });

    ribbon.style.display = 'flex';
    ribbon.scrollLeft = 0;
}

export function clearDivisions() {
    const ribbon = document.getElementById('divisionRibbon');
    if (ribbon) {
        ribbon.style.display = 'none';
        ribbon.innerHTML = '';
    }
}

function setActiveTab(index) {
    const ribbon = document.getElementById('divisionRibbon');
    if (!ribbon) return;
    ribbon.querySelectorAll('.division-tab').forEach((tab, i) => {
        tab.classList.toggle('active', i === index);
    });
}

export function setupRibbonScroll() {
    const ribbon = document.getElementById('divisionRibbon');
    if (!ribbon) return;

    let isDown = false;
    let startX;
    let scrollLeft;
    let isDragging = false;

    ribbon.addEventListener('mousedown', (e) => {
        isDown = true;
        isDragging = false;
        startX = e.pageX - ribbon.offsetLeft;
        scrollLeft = ribbon.scrollLeft;
    });

    ribbon.addEventListener('mouseleave', () => {
        isDown = false;
        ribbon.classList.remove('is-dragging');
    });

    ribbon.addEventListener('mouseup', () => {
        isDown = false;
        setTimeout(() => {
            ribbon.classList.remove('is-dragging');
        }, 10);
    });

    ribbon.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - ribbon.offsetLeft;
        const walk = x - startX;
        if (Math.abs(walk) > 3) {
            isDragging = true;
            ribbon.classList.add('is-dragging');
        }
        ribbon.scrollLeft = scrollLeft - walk;
    });

    ribbon.addEventListener('click', (e) => {
        if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
        }
    });
}

export function initRibbon() {
    setupRibbonScroll();
}
