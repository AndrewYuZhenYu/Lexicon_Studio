// Compact quick navigation for the dictionary inside the workspace only.
(() => {
    'use strict';
    const toggle = document.getElementById('tocToggle');
    const overlay = document.getElementById('tocOverlay');
    const panel = overlay?.querySelector('.toc-panel');
    if (!toggle || !overlay || !panel) return;
    const style = document.createElement('style');
    style.textContent = `
        @media (max-width: 1100px) {
            /* Keep the navigation visible in iPad Safari and avoid its transformed entrance layer. */
            .top-nav { position: sticky; top: 0; z-index: 10; background: var(--bg-color);
                animation: none !important; transform: none !important; opacity: 1 !important; }
            html { scroll-padding-top: 86px; }
            .search-surface, #result { scroll-margin-top: 86px; }
        }
        .toc-overlay, .toc-overlay.show {
            right: auto !important; bottom: auto !important;
            width: 260px; height: auto; max-height: min(65vh, 520px);
            background: transparent !important; backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important; align-items: stretch !important;
            justify-content: stretch !important; z-index: 2001;
        }
        .toc-overlay.show { display: flex !important; }
        .toc-panel, .toc-overlay.show .toc-panel {
            width: 100% !important; max-width: none !important; max-height: min(65vh, 520px) !important;
            border: 1px solid var(--glass-border); border-radius: 16px !important;
            background: var(--bg-color); box-shadow: var(--shadow-xl);
            transform: none !important; animation: none !important; overflow: hidden;
        }
        .toc-panel-header { display: none !important; }
        .toc-panel .toc-list { padding: 6px !important; overscroll-behavior: contain; }
        .toc-panel .toc-item { display: block; width: 100%; min-height: 44px; padding: 9px 12px !important;
            border-radius: 9px; text-align: left; line-height: 1.4; }
        .toc-panel .toc-item.workspace-hover { background: var(--clickable-hover-bg); color: var(--c-title-1); }
        .toc-toggle { touch-action: none; }
    `;
    document.head.appendChild(style);

    function place() {
        if (!overlay.classList.contains('show')) return;
        const anchor = toggle.getBoundingClientRect();
        const width = Math.min(280, Math.max(150, anchor.left - 20));
        overlay.style.width = `${width}px`;
        overlay.style.left = `${Math.max(8, anchor.left - width - 9)}px`;
        overlay.style.top = `${Math.max(8, Math.min(innerHeight - panel.offsetHeight - 8, anchor.bottom - panel.offsetHeight))}px`;
    }
    new MutationObserver(place).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', event => {
        if (overlay.classList.contains('show') && !overlay.contains(event.target) && event.target !== toggle) closeTocOverlay();
    });

    let timer, holding = false, suppressNextClick = false, selected = null, startX = 0, startY = 0;
    toggle.addEventListener('contextmenu', event => event.preventDefault());
    toggle.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse') return;
        startX = event.clientX; startY = event.clientY;
        selected = null; holding = false;
        toggle.setPointerCapture(event.pointerId);
        timer = setTimeout(() => { holding = true; openTocOverlay(); place(); }, 380);
    });
    toggle.addEventListener('pointermove', event => {
        if (!holding) {
            if (Math.hypot(event.clientX - startX, event.clientY - startY) > 14) clearTimeout(timer);
            return;
        }
        const item = document.elementFromPoint(event.clientX, event.clientY)?.closest('.toc-panel .toc-item');
        if (selected !== item) {
            selected?.classList.remove('workspace-hover');
            selected = item;
            selected?.classList.add('workspace-hover');
        }
    });
    toggle.addEventListener('pointerup', () => {
        clearTimeout(timer);
        if (holding) suppressNextClick = true;
        if (holding && selected) selected.click();
        selected?.classList.remove('workspace-hover');
        selected = null;
        holding = false;
        if (suppressNextClick) setTimeout(() => { suppressNextClick = false; }, 500);
    });
    toggle.addEventListener('pointercancel', () => {
        clearTimeout(timer);
        selected?.classList.remove('workspace-hover'); selected = null; holding = false;
    });
    toggle.addEventListener('click', event => {
        if (suppressNextClick || overlay.classList.contains('show')) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (suppressNextClick) suppressNextClick = false;
            else closeTocOverlay();
        }
    }, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && overlay.classList.contains('show')) closeTocOverlay();
    });
})();
