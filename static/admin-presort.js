(() => {
    'use strict';
    const el = name => document.getElementById('admin-presort-' + name);
    let jobs = [], page = 1, pages = 1, generation = 0, listGeneration = 0;
    let timer = null, preferredJob = null, busy = false;
    const statusLabel = job => `${job.mode === 'sort' ? 'Переведено в SORT' : 'Pre-sort'} · ${{active:'Активний',closed:'Закритий',paused:'Призупинений'}[job.status] || job.status}`;
    function message(text, error = false) {
        el('message').textContent = text;
        el('message').className = error ? 'error' : '';
    }
    async function read(url) {
        const response = await fetch(url);
        if (response.status === 401) throw new Error('Сесія завершилась. Увійдіть знову.');
        if (response.status === 403) throw new Error('Перегляд доступний лише адміністратору.');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не вдалося завантажити записи');
        return data;
    }
    function paging() {
        el('prev').disabled = busy || !el('job').value || page <= 1;
        el('next').disabled = busy || !el('job').value || page >= pages;
    }
    const scanLabels = ['Час','Тип','ICC код','Локація','PACK','Палета','Працівник','Статус запису'];
    const productLabels = ['Товар','Тип','Додано / PACK','Залишилось','Прогрес','Палет','Розміщення','Останнє додавання'];
    const formatDate = value => {
        const date = new Date(value.replace(' ', 'T') + 'Z');
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString('uk-UA');
    };
    function appendRow(values, labels, cancelled = false) {
        const row = document.createElement('tr');
        if (cancelled) row.className = 'cancelled';
        for (const [index, value] of values.entries()) {
            const cell = document.createElement('td'); cell.dataset.label = labels[index];
            if (['Товар','ICC код','Локація','Працівник'].includes(labels[index])) cell.dataset.noTranslate='';
            cell.textContent = String(value); row.append(cell);
        }
        el('scans').append(row);
    }
    async function loadRows() {
        const version = ++generation;
        const job = jobs.find(item => String(item.id) === el('job').value);
        const grouped = el('view').value === 'products';
        el('status-field').hidden = grouped;
        el('query-label').textContent = grouped ? 'Пошук за кодом, локацією або PACK' : 'Пошук за кодом, локацією, PACK, палетою або працівником';
        el('view-note').hidden = !grouped;
        const labels = grouped ? productLabels : scanLabels;
        const heading = document.createElement('tr');
        for (const label of labels) {
            const cell = document.createElement('th'); cell.textContent = label; heading.append(cell);
        }
        el('head').replaceChildren(heading);
        busy = true; paging();
        el('scans').replaceChildren(); el('page').textContent = '';
        el('summary').textContent = job ? `${job.name} · ${statusLabel(job)} · Палет: ${job.pallets_count} · Картонів: ${job.cartons_count} · Скасовано: ${job.undone_count}` : '';
        if (!job) {
            busy = false; paging(); message(jobs.length ? 'Оберіть завдання для перегляду.' : 'Завдань Pre-sort ще немає.'); return;
        }
        message('Завантаження записів…');
        const params = new URLSearchParams({page: String(page), type: el('type').value, q: el('query').value.trim()});
        if (!grouped) params.set('scan_status', el('status').value);
        try {
            const result = await read(`/api/admin/presort/jobs/${job.id}/${grouped ? 'products' : 'scans'}?${params}`);
            if (version !== generation) return;
            page = result.page; pages = result.pages;
            if (grouped) for (const item of result.products) {
                const title = `${item.code}${item.location ? ' ' + item.location : ''}${item.planned ? ' ' + item.pack + ' PACK' : ''}`;
                const progress = item.planned ? `${item.percent}%${item.excess ? ' · понад PACK: ' + item.excess : item.remaining === 0 ? ' · зібрано' : ''}` : 'Без плану';
                appendRow([title, item.type.toUpperCase(), item.planned ? `${item.cartons} із ${item.planned}` : `${item.cartons} шт.`,
                    item.remaining ?? '—', progress, `${item.pallets_count} (закрито: ${item.closed_pallets})`,
                    item.pallets.map(p => `№${p.number} — ${p.cartons} шт. (${p.closed ? 'закрита' : 'відкрита'})`).join('; '),
                    formatDate(item.last_added_at)], productLabels);
            }
            else for (const scan of result.scans) {
                const values = [formatDate(scan.created_at),
                    scan.type.toUpperCase(), scan.code, scan.location || '—', scan.pack || '—',
                    `№${scan.pallet_number} · ${scan.pallet_closed_at ? 'Закрита' : 'Відкрита'}`,
                    scan.username || `Користувач #${scan.user_id} (видалений)`, scan.undone ? 'Скасовано' : 'Додано'];
                appendRow(values, scanLabels, !!scan.undone);
            }
            message(result.total ? `${grouped ? 'Знайдено товарів' : 'Знайдено записів'}: ${result.total}` : 'За вибраними умовами записів немає.');
            el('page').textContent = `Сторінка ${page} з ${pages}`;
        } catch (error) { if (version === generation) message(error.message, true); }
        finally { if (version === generation) { busy = false; paging(); } }
    }
    window.loadAdminPresort = async () => {
        const version = ++listGeneration;
        ++generation;
        const selected = preferredJob || el('job').value;
        preferredJob = null;
        el('job').disabled = true; el('refresh').disabled = true;
        busy = true; paging();
        el('scans').replaceChildren(); el('summary').textContent = ''; el('page').textContent = '';
        message('Завантаження завдань…');
        try {
            const result = await read('/api/admin/presort/jobs');
            if (version !== listGeneration) return;
            jobs = result.jobs;
            el('job').replaceChildren(new Option('Оберіть Pre-sort', ''));
            for (const job of jobs) {
                const option=new Option(`#${job.id} · ${job.name} · ${job.unload_date} · ${statusLabel(job)}`,job.id);
                option.dataset.i18nProtected=JSON.stringify([job.name]);el('job').add(option);
            }
            el('job').value = jobs.some(job => String(job.id) === selected) ? selected : String(jobs[0]?.id || '');
            page = 1; await loadRows();
        } catch (error) { if (version === listGeneration) { busy = false; paging(); message(error.message, true); } }
        finally { if (version === listGeneration) { el('job').disabled = false; el('refresh').disabled = false; } }
    };
    window.openAdminPresortJob = id => {
        preferredJob = String(id);
        showAdminTab('presort');
    };
    const filter = () => { clearTimeout(timer); page = 1; return loadRows(); };
    el('job').onchange = filter;
    el('view').onchange = filter;
    el('type').onchange = filter;
    el('status').onchange = filter;
    el('query').oninput = () => { clearTimeout(timer); timer = setTimeout(filter, 300); };
    el('refresh').onclick = () => { clearTimeout(timer); window.loadAdminPresort(); };
    el('prev').onclick = () => { if (!busy && page > 1) { page--; loadRows(); } };
    el('next').onclick = () => { if (!busy && page < pages) { page++; loadRows(); } };
})();
