(() => {
    'use strict';
    const byId = id => document.getElementById(id);
    const visible = node => {
        for (let current = node; current && current !== document; current = current.parentElement) {
            if (current.hidden || getComputedStyle(current).display === 'none') return false;
        }
        return !!node;
    };
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'site-back-button';
    button.setAttribute('aria-label', 'Назад до попереднього вікна'); button.title = 'Назад';
    const icon = document.createElement('span'); icon.className = 'site-back-icon'; icon.textContent = '←'; icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.textContent = 'Назад'; button.append(icon, label);
    const notice = document.createElement('div'); notice.className = 'site-back-status'; notice.setAttribute('role', 'status');
    let noticeTimer = null;
    document.body.classList.add('has-site-back'); document.body.append(button, notice);

    // Only remember actual application pages; never return through logout or an external URL.
    const allowed = new Set(['/dashboard', '/admin', '/presort', '/lider', '/test_ocr_images']);
    const key = 'warehouse-page-back';
    let routes = [];
    const safeRoute = value => {
        try {
            const url = new URL(value, location.origin);
            return url.origin === location.origin && allowed.has(url.pathname) ? url.pathname + url.search : null;
        } catch (_) { return null; }
    };
    const saveRoutes = () => { try { sessionStorage.setItem(key, JSON.stringify(routes)); } catch (_) {} };
    try {
        const saved = JSON.parse(sessionStorage.getItem(key) || '[]');
        if (Array.isArray(saved)) routes = saved.map(safeRoute).filter(Boolean).slice(-30);
    } catch (_) {}
    const currentRoute = safeRoute(location.href);
    if (!currentRoute) routes = [];
    else if (routes.at(-1) !== currentRoute) routes.push(currentRoute);
    saveRoutes();

    const panelHistory = [];
    let panelDepth = 0;
    let writesInProgress = 0;
    function snapshot() {
        const panels = [...document.querySelectorAll('.admin-tab-content, .sort-subtab-content, #login-form, #register-form')]
            .map(node => ({node, display: node.style.display}));
        const tabs = [...document.querySelectorAll('.tab-btn, .sort-subtab-btn')]
            .map(node => ({node, active: node.classList.contains('active')}));
        return {panels, tabs, signature: JSON.stringify([panels.map(p => p.display), tabs.map(t => t.active)])};
    }
    // Preserve the existing DOM/form values when returning to a prior tab.
    for (const name of ['showAdminTab', 'showSortSubtab', 'showLiderTab', 'showTab']) {
        const original = window[name];
        if (typeof original !== 'function') continue;
        window[name] = function (...args) {
            const previous = panelDepth === 0 ? snapshot() : null;
            panelDepth++;
            try { return original.apply(this, args); }
            finally {
                panelDepth--;
                if (previous && previous.signature !== snapshot().signature) {
                    panelHistory.push(previous);
                    if (panelHistory.length > 50) panelHistory.shift();
                }
                update();
            }
        };
    }
    for (const name of ['confirmAndSubmit', 'saveICCChanges']) {
        const original = window[name];
        if (typeof original !== 'function') continue;
        window[name] = async function (...args) {
            if (writesInProgress) return;
            writesInProgress++; update();
            try { return await original.apply(this, args); }
            finally { writesInProgress--; update(); }
        };
    }
    function topModal() {
        return [...document.querySelectorAll('.modal, #ocr-lightbox')].filter(visible)
            .map((node, index) => ({node, index, z: Number(getComputedStyle(node).zIndex) || 0}))
            .sort((a, b) => a.z - b.z || a.index - b.index).at(-1)?.node;
    }
    function previousRoute() {
        const previous = routes.slice(0, -1).at(-1);
        return previous || (currentRoute && location.pathname !== '/dashboard' ? '/dashboard' : null);
    }
    function update() {
        button.disabled = navigating || writesInProgress > 0 || !!window.hasPendingIdPackSave?.() || window.hasPendingSortSave?.() || !!window.hasPendingCollectionSave?.() || !!window.hasPendingInventoryAdminSave?.() || !(topModal() || panelHistory.length || visible(byId('work-area'))
            || visible(byId('sort-selection')) || (location.pathname === '/presort' && byId('container')?.value) || previousRoute());
    }
    function blocked() {
        clearTimeout(noticeTimer);
        notice.textContent = 'Дочекайтеся завершення збереження, потім натисніть «Назад».';
        noticeTimer = setTimeout(() => { notice.textContent = ''; }, 2500);
    }
    let navigating = false;
    async function back() {
        if (navigating) return;
        notice.textContent = '';
        if (writesInProgress || window.hasPendingIdPackSave?.() || window.hasPendingSortSave?.() || window.hasPendingCollectionSave?.() || window.hasPendingInventoryAdminSave?.()) { blocked(); return; }
        navigating = true; update();
        try {
            const modal = topModal();
            if (modal?.id !== 'camera-modal' && window.idPackBackHandler?.()) return;
            if (modal?.id !== 'camera-modal' && window.collectionBackHandler?.()) return;
            if (modal?.id === 'inventory-admin-modal' && window.inventoryAdminBackHandler?.()) return;
            if (modal) {
                if (modal.id === 'camera-modal') {
                    const close = byId('camera-close');
                    if (close) { if (close.disabled) blocked(); else close.click(); }
                    else if (typeof window.closeCameraScanner === 'function') await window.closeCameraScanner();
                    return;
                }
                const actions = {
                    'location-modal': 'backToQuantity', 'edit-icc-modal': 'closeEditICCModal',
                    'ocr-detail-modal': 'closeOcrDetail', 'confirm-modal': 'closeConfirmModal',
                    'create-container-modal': 'closeCreateContainerModal', 'create-sort-modal': 'closeCreateSortModal'
                };
                if (typeof window[actions[modal.id]] === 'function') {
                    await window[actions[modal.id]](); return;
                }
                if (modal.id === 'sort-menu') {
                    window.closeSortMenu(); await window.showSortSelection(); return;
                }
                if (['confirmation-modal', 'new-item-modal', 'ocr-lightbox'].includes(modal.id)) {
                    modal.style.display = 'none'; return;
                }
                return; // Unknown dialogs must be closed by their own controls.
            }
            if (visible(byId('sort-selection'))) { window.cancelSortSelection(); return; }
            if (visible(byId('work-area'))) {
                byId('work-area').style.display = 'none'; window.showSortMenu(); return;
            }
            if (location.pathname === '/presort' && byId('container')?.value) {
                const select = byId('container');
                if (select.disabled) { blocked(); return; }
                select.value = ''; select.dispatchEvent(new Event('change', {bubbles: true})); return;
            }
            if (panelHistory.length) {
                const previous = panelHistory.pop();
                previous.panels.forEach(({node, display}) => { node.style.display = display; });
                previous.tabs.forEach(({node, active}) => { node.classList.toggle('active', active); });
                return;
            }
            const target = previousRoute();
            if (target) {
                routes.pop(); saveRoutes(); location.assign(target);
            }
        } finally { navigating = false; update(); }
    }
    button.addEventListener('click', back);
    new MutationObserver(update).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden']});
    update();
})();
