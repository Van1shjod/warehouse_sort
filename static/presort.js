(() => {
    'use strict';
    const el = id => document.getElementById(id);
    let state = null, active = null, busy = false;
    let cameraStream = null, cameraGeneration = 0, recognition = null, cameraSaving = false;
    let flashEnabled = false;
    let successTimer = null;
    function notifyCartonAdded() {
        clearTimeout(successTimer);
        el('carton-added-notice').hidden = false;
        successTimer = setTimeout(() => { el('carton-added-notice').hidden = true; }, 2200);
    }
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem('presortPending') || 'null'); } catch (_) { /* no saved request */ }
    const message = (text, error = false) => {
        el('message').textContent = text;
        el('message').className = error ? 'error' : '';
    };
    async function api(path, data) {
        const response = await fetch(path, data === undefined ? {} : {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
        });
        if (response.status === 401) throw new Error('Сесія завершилась. Увійдіть на сайт знову.');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не вдалося виконати дію');
        return result;
    }
    function controls() {
        el('scan-fields').disabled = busy || !active || !!pending || state?.container.status !== 'active';
        el('container').disabled = busy || !!pending;
        el('open').hidden = !!active;
        el('open').disabled = busy || !!pending || state?.container.status !== 'active';
        el('close').hidden = !active;
        el('close').disabled = busy || !!pending;
        el('undo').hidden = !active || !state?.last_scan_id;
        el('undo').disabled = busy || !!pending;
        el('retry').hidden = !pending;
        el('retry').disabled = busy;
        el('refresh').disabled = busy;
        if (el('close-job')) {
            el('close-job').hidden = !state || state.container.status === 'closed';
            el('close-job').disabled = busy || !!pending;
            el('convert-job').hidden = !state || state.container.status !== 'closed';
            el('convert-job').disabled = busy || !!pending;
        }
    }
    async function run(fn) {
        if (busy) return;
        busy = true; controls();
        try { await fn(); } catch (error) {
            if (error.name !== 'AbortError') {
                message(error.message, true);
                if (el('camera-modal').style.display !== 'none') cameraStatus(error.message, 'error');
            }
        }
        finally { busy = false; controls(); }
    }
    async function load() {
        const id = el('container').value;
        if (!id) { state = active = null; el('workspace').hidden = true; return; }
        state = await api(`/api/presort/inventory?container_id=${encodeURIComponent(id)}`);
        el('job-details').textContent = `${state.container.container_number} · ${state.container.unload_date} · ${state.container.type.toUpperCase()}${state.container.description ? ' · ' + state.container.description : ''}`;
        const allowed = state.container.type.split(',');
        for (const option of el('type').options) {
            option.disabled = !allowed.includes(option.value);
            option.hidden = option.disabled;
        }
        if (!allowed.includes(el('type').value)) el('type').value = allowed[0];
        el('type').onchange();
        active = state.pallets.find(p => p.user_id === state.user_id && !p.closed_at);
        el('workspace').hidden = false;
        el('pallet-title').textContent = active ? `Ваша палета №${active.number}` : 'Палету не відкрито';
        el('pallet-count').textContent = active ? `На палеті: ${active.cartons} картонів` : 'Почніть палету, щоб додавати картони.';
        el('totals').textContent = `${state.pallets.length} палет · ${state.items.reduce((n, item) => n + item.cartons, 0)} картонів`;
        el('pallets').replaceChildren();
        for (const pallet of state.pallets) {
            const line = document.createElement('p');
            line.textContent = `№${pallet.number} · ${pallet.cartons} картонів · ${pallet.closed_at ? 'Закрита' : 'Відкрита'} · ${pallet.username || 'Користувач видалений'}`;
            el('pallets').append(line);
        }
        controls();
    }
    function clearPending() {
        pending = null; sessionStorage.removeItem('presortPending');
    }
    async function saveCarton() {
        if (!pending) {
            if (!active) throw new Error('Спочатку відкрийте палету');
            pending = {
                container_id: Number(el('container').value), pallet_id: active.id,
                type: el('type').value, code: el('code').value.trim().toUpperCase(),
                location: el('location').value.trim().toUpperCase(), pack: Number(el('pack').value),
                request_id: crypto.randomUUID()
            };
            sessionStorage.setItem('presortPending', JSON.stringify(pending));
        }
        const payload = pending;
        // Retain the same request ID across network errors and page reloads.
        const response = await fetch('/api/presort/scans', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
            if (response.status === 400) clearPending();
            throw new Error(result.error || 'Збереження не підтверджене. Повторіть цю дію.');
        }
        clearPending();
        el('last-added').textContent = `Останній доданий: ${payload.code} ${payload.location} ${payload.pack ? payload.pack + ' PACK' : ''}`;
        el('code').value = el('location').value = el('pack').value = '';
        message('✓ Картон додано');
        notifyCartonAdded();
        await load();
    }
    el('scan-form').addEventListener('submit', event => { event.preventDefault(); run(saveCarton); });
    el('retry').onclick = () => run(saveCarton);
    el('container').onchange = () => run(async () => { await load(); message('Pre-sort обрано'); });
    el('refresh').onclick = () => run(load);
    if (el('close-job')) el('close-job').onclick = () => {
        if (!state || !confirm('Закрити Pre-sort і всі його відкриті палети? Додавання картонів буде завершено.')) return;
        run(async () => {
            const response = await fetch(`/api/sorts/${state.container.sort_id}/status`, {
                method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status: 'closed'})
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Не вдалося закрити Pre-sort');
            await load(); message('Pre-sort закрито. Можна перевести його в SORT.');
        });
    };
    if (el('convert-job')) el('convert-job').onclick = () => {
        if (!state || !confirm('Перевести Pre-sort в SORT зі збереженням даних палет?')) return;
        run(async () => {
            await api(`/api/sorts/${state.container.sort_id}/convert-to-sort`, {});
            window.location.href = '/dashboard';
        });
    };
    el('open').onclick = () => run(async () => {
        await api('/api/presort/pallets', {container_id: Number(el('container').value)});
        await load(); message(`Позначте палету номером ${active.number}`);
    });
    el('close').onclick = () => {
        if (active && confirm(`Закрити палету №${active.number}? На ній ${active.cartons} картонів.`)) run(async () => {
            await api(`/api/presort/pallets/${active.id}/close`, {});
            await load(); message('Палету закрито. Можна почати наступну.');
        });
    };
    el('undo').onclick = () => run(async () => {
        await api(`/api/presort/scans/${state.last_scan_id}/undo`, {});
        await load(); message('Останній картон скасовано'); el('last-added').textContent = '';
    });
    el('type').onchange = () => {
        const mix = el('type').value === 'mix';
        const unavailable = el('type').value === 'vevor';
        if (el('presort-vevor-notice')) el('presort-vevor-notice').hidden = !unavailable;
        if (el('presort-label-controls')) el('presort-label-controls').hidden = unavailable;
        el('code').required = !unavailable;
        for (const name of ['location', 'pack']) {
            el(name + '-field').hidden = mix; el(name).required = !mix && !unavailable;
        }
    };
    function cameraStatus(text, kind = '') {
        el('scan-status').textContent = text;
        el('scan-status').className = 'scan-status' + (kind ? ' ' + kind : '');
    }
    function closeCamera() {
        if (cameraSaving) return;
        cameraGeneration++;
        window.ocrReadiness?.cancel();
        recognition?.abort(); recognition = null;
        cameraStream?.getTracks().forEach(track => track.stop());
        cameraStream = null; flashEnabled = false;
        el('camera-video').srcObject = null;
        el('camera-modal').style.display = 'none';
        el('scan-result').style.display = 'none';
        el('camera-scan-btn').focus();
    }
    el('camera-scan-btn').onclick = async () => {
        if (busy || pending || !active) return;
        if (el('type').value === 'vevor') { message('Vevor ще в розробці'); return; }
        const generation = ++cameraGeneration;
        el('camera-modal').style.display = 'flex';
        el('camera-close').focus();
        el('camera-capture').disabled = true;
        el('flash-toggle-btn').disabled = true;
        el('flash-toggle-btn').textContent = '🔆 Спалах';
        const preparation = window.ocrReadiness?.prepare() || Promise.resolve(true);
        preparation.catch(error => {
            if (generation === cameraGeneration) cameraStatus(error.message, 'error');
        });
        cameraStatus('Завантаження камери…', 'scanning');
        try {
            if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна. Відкрийте сайт через HTTPS або введіть дані вручну.');
            const stream = await navigator.mediaDevices.getUserMedia({video: {
                facingMode: 'environment', width: {ideal: 1920}, height: {ideal: 1440}, aspectRatio: {ideal: 4/3}
            }});
            if (generation !== cameraGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
            cameraStream = stream;
            el('camera-video').srcObject = stream;
            await el('camera-video').play();
            if (generation !== cameraGeneration) return;
            cameraStatus('');
            if (generation !== cameraGeneration) return;
            el('camera-capture').disabled = false;
            el('flash-toggle-btn').disabled = !stream.getVideoTracks()[0].getCapabilities?.().torch;
            cameraStatus('Камера готова. Наведіть на наклейку і натисніть кнопку фото.');
        } catch (error) {
            if (generation !== cameraGeneration) return;
            cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null;
            window.ocrReadiness?.cancel();
            cameraStatus(error.name === 'NotAllowedError' ? 'Дозвольте доступ до камери у налаштуваннях браузера.' : error.message, 'error');
        }
    };
    el('camera-close').onclick = closeCamera;
    el('flash-toggle-btn').onclick = async () => {
        if (!cameraStream) return;
        try {
            await cameraStream.getVideoTracks()[0].applyConstraints({advanced: [{torch: !flashEnabled}]});
            flashEnabled = !flashEnabled;
            el('flash-toggle-btn').textContent = flashEnabled ? '🔆 Спалах ВКЛ' : '🔆 Спалах';
        } catch (_) { cameraStatus('Не вдалося перемкнути спалах.', 'error'); }
    };
    el('camera-capture').onclick = () => run(async () => {
        const generation = cameraGeneration;
        const video = el('camera-video'), canvas = el('camera-canvas');
        if (!cameraStream || !video.videoWidth || !video.videoHeight) throw new Error('Камера ще не готова. Спробуйте ще раз.');
        el('camera-capture').disabled = true;
        cameraStatus('🔍 Розпізнавання…', 'scanning');
        el('scan-result').style.display = 'none';
        try {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95));
            if (generation !== cameraGeneration) return;
            if (!blob) throw new Error('Не вдалося зробити фото. Спробуйте ще раз.');
            recognition = new AbortController();
            const body = new FormData(); body.append('image', blob, 'scan.jpg'); body.append('type', el('type').value);
            const response = await fetch('/api/ocr/recognize', {method: 'POST', body, signal: recognition.signal});
            const result = await response.json();
            if (generation !== cameraGeneration) return;
            if (!response.ok) throw new Error(result.error || 'Не вдалося розпізнати наклейку');
            const data = result.partial_data || result;
            el('code').value = data.cell || '';
            el('location').value = data.prefix && data.zone ? `${data.prefix}-${data.zone}` : '';
            el('pack').value = data.qtyPack || '';
            const resultDiv = el('scan-result'); resultDiv.replaceChildren();
            for (const [label, value] of [['ICC', data.cell], ['PACK', data.qtyPack], ['Локація', el('location').value]]) {
                if (el('type').value === 'mix' && label !== 'ICC') continue;
                const line = document.createElement('p'); line.textContent = `${label}: ${value || '—'}`; resultDiv.append(line);
            }
            resultDiv.style.display = 'block';
            if (data.cell && (el('type').value === 'mix' || (data.prefix && data.zone && data.qtyPack))) {
                cameraStatus('✓ Всі дані розпізнано! Збереження…', 'success');
                cameraSaving = true; el('camera-close').disabled = true;
                await saveCarton();
                cameraStatus('✓ Картон додано. Наведіть камеру на наступну наклейку.', 'success');
            } else {
                const text = 'Неповне розпізнавання. Спробуйте ще раз або закрийте камеру, виправте поля та натисніть «Додати».';
                cameraStatus(text, 'error'); message(text, true);
            }
        } finally {
            cameraSaving = false; el('camera-close').disabled = false;
            el('camera-capture').disabled = !cameraStream || !!pending || !active || state?.container.status !== 'active';
            recognition = null;
        }
    });
    window.addEventListener('pagehide', () => {
        recognition?.abort(); cameraStream?.getTracks().forEach(track => track.stop());
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && el('camera-modal').style.display !== 'none') closeCamera();
    });
    async function containers(selected) {
        // Closed Pre-sorts remain searchable, but cannot receive cartons.
        const all = await api('/api/presort/containers');
        el('container').replaceChildren(new Option('Оберіть Pre-sort', ''));
        for (const row of all) {
            const option=new Option(`${row.container_number} · ${row.unload_date}${row.status === 'active' ? '' : ' · Закритий / призупинений'}`,row.id);
            option.dataset.i18nProtected=JSON.stringify([row.container_number]);el('container').add(option);
        }
        const requested = new URLSearchParams(window.location.search).get('sort_id');
        if (!selected && requested) selected = all.find(row => String(row.sort_id) === requested)?.id;
        if (selected) el('container').value = String(selected);
        if (!all.length) message('Немає створених Pre-sort. Зверніться до адміністратора.', true);
    }
    run(async () => {
        await containers(pending?.container_id); await load();
        if (pending) message('Є непідтверджене збереження. Натисніть «Повторити», щоб перевірити його без дублювання.', true);
        else if (el('container').value) message('Pre-sort відкрито. Можна продовжувати роботу.');
        else if (el('container').options.length > 1) message('Оберіть створений адміністратором Pre-sort.');
    });
})();
