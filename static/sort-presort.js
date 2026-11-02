// Source locations belong only to the selected SORT; they are not destination pallets.
(() => {
    let items = [], generation = 0, active = false, phase = 'idle';
    let hasSource = false, error = '', stepSelection = null, lastSelection = null;
    const el = id => document.getElementById(id);
    const normalize = (data, type) => ({
        type, code: String(data?.iccCode ?? data?.code ?? '').trim().toUpperCase(),
        location: type === 'mix' ? '' : String(data?.locationCode ?? data?.location ?? '').trim().toUpperCase(),
        pack: type === 'mix' ? 0 : Number(data?.totalCartons ?? data?.pack ?? 0)
    });
    function currentSelection() {
        return normalize({code: el(currentType === 'mix' ? 'mix-icc-code-input' : 'icc-code-input').value,
            location: el('location-code-input').value, pack: el('cartons-count-input').value}, currentType);
    }
    function render(output, selection) {
        if (!output) return;
        output.replaceChildren();
        if (!active) return;
        if (phase === 'loading') { output.textContent = 'Завантажую палети з Pre-sort…'; return; }
        if (phase === 'error') { output.textContent = error; return; }
        if (!hasSource) {
            output.textContent = 'Цей SORT не має джерела Pre-sort. Для пошуку палет оберіть завдання, яке адміністратор перевів із Pre-sort у SORT.';
            return;
        }
        if (!items.length) {
            output.textContent = 'У Pre-sort цього завдання немає збережених картонів. Тому номери джерельних палет не відображаються.';
            return;
        }
        if (!selection?.code) { output.textContent = 'Введіть або відскануйте код наклейки — тут з’являться номери палет.'; return; }
        const matches = items.filter(item => item.type === selection.type && item.code === selection.code
            && (!selection.location || item.location === selection.location) && (!selection.pack || item.pack === selection.pack));
        if (!matches.length) { output.textContent = 'Такого товару в Pre-sort цього завдання немає. Перевірте тип, код, букви та PACK.'; return; }
        const groups = new Map();
        for (const item of matches) {
            const key = JSON.stringify([item.type, item.code, item.location, item.pack]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        }
        for (const rows of groups.values()) {
            const first = rows[0], card = document.createElement('div');
            card.style.cssText = 'margin: .75rem 0; padding: .75rem; background: white; border-radius: 8px;';
            const heading = document.createElement('strong');
            heading.textContent = `${first.code} ${first.location} ${first.pack ? first.pack + ' PACK' : ''}`;
            card.append(heading);
            for (const row of rows) {
                const line = document.createElement('p');
                line.textContent = `Палета №${row.number} — ${row.cartons} картонів`;
                card.append(line);
            }
            output.append(card);
        }
    }
    function renderAll() {
        el('presort-source-area').hidden = !active;
        render(el('presort-source-results'), currentSelection());
        for (const [section, output] of [
            ['presort-confirm-source', 'presort-confirm-results'], ['presort-location-source', 'presort-location-results']
        ]) {
            if (el(section)) el(section).hidden = !active || !stepSelection;
            render(el(output), stepSelection);
        }
        if (el('presort-last-source')) el('presort-last-source').hidden = !active || !lastSelection;
        if (lastSelection && el('presort-last-label')) {
            el('presort-last-label').textContent = `${lastSelection.code} ${lastSelection.location} ${lastSelection.pack ? lastSelection.pack + ' PACK' : ''}`;
        }
        render(el('presort-last-results'), lastSelection);
    }
    window.loadPresortSource = async sort => {
        const request = ++generation;
        items = []; hasSource = false; error = '';
        stepSelection = lastSelection = null;
        active = !!sort && sort.mode !== 'presort';
        phase = active ? 'loading' : 'idle'; renderAll();
        if (!active) return;
        try {
            const response = await fetch(`/api/sorts/${sort.id}/presort-items`);
            if (!response.ok) throw new Error(response.status === 401 ? 'Сесія завершилась. Увійдіть знову.' : 'Не вдалося завантажити палети Pre-sort. Спробуйте ще раз обрати SORT.');
            const result = await response.json();
            if (request !== generation) return;
            items = result.items;
            hasSource = result.has_source ?? items.length > 0;
            phase = 'loaded'; renderAll();
        } catch (failure) {
            if (request !== generation) return;
            phase = 'error'; error = failure.message; renderAll();
        }
    };
    window.refreshPresortMatches = renderAll;
    window.showPresortStepMatches = (data, type) => { stepSelection = normalize(data, type); renderAll(); };
    window.rememberPresortMatch = (data, type) => { lastSelection = normalize(data, type); renderAll(); };
    for (const id of ['icc-code-input', 'location-code-input', 'cartons-count-input', 'mix-icc-code-input']) {
        el(id).addEventListener('input', renderAll);
    }
})();
