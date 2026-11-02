// Apply before first paint; the preference belongs to this browser, not an account.
(() => {
    'use strict';
    const key = 'warehouse-theme';
    let button;
    function apply(value) {
        const dark = value === 'dark';
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        if (button) {
            button.textContent = dark ? '☀ Світла тема' : '☾ Темна тема';
            button.setAttribute('aria-label', dark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему');
            button.setAttribute('aria-pressed', String(dark));
        }
    }
    let preferred = 'light';
    try { preferred = localStorage.getItem(key); } catch (_) {}
    apply(preferred);
    document.addEventListener('DOMContentLoaded', () => {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'theme-toggle';
        button.addEventListener('click', () => {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            apply(next);
            try { localStorage.setItem(key, next); } catch (_) {}
        });
        document.body.classList.add('has-theme-toggle');
        document.body.append(button);
        apply(document.documentElement.dataset.theme);
    });
    window.addEventListener('storage', event => {
        if (event.key === key || event.key === null) apply(event.newValue);
    });
})();
