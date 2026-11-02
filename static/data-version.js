// Each tab drops pre-reset work drafts once; language and theme stay unchanged.
(() => {
    'use strict';
    const version='2026-11-02-clean-1';
    const key='warehouse-data-version';
    try {
        if(sessionStorage.getItem(key)!==version) {
            const stale=[];
            for(let i=0;i<sessionStorage.length;i++) {
                const name=sessionStorage.key(i);
                if(name==='presortPending' || name==='warehouse-page-back'
                    || name?.startsWith('warehouse-sort-pending-')
                    || name?.startsWith('warehouse-collection-')
                    || name?.startsWith('warehouse-inventory-admin-pending-')
                    || name?.startsWith('warehouse-inventory-pending-')) stale.push(name);
            }
            for(const name of stale) sessionStorage.removeItem(name);
            sessionStorage.setItem(key,version);
        }
    } catch (_) { /* Storage can be disabled in the browser. */ }
    try {
        if(localStorage.getItem(key)!==version) {
            localStorage.removeItem('currentSortId');
            localStorage.setItem(key,version);
        }
    } catch (_) {}
})();
