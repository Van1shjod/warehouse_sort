/* SORT stock movements: drafts stay in the browser until the final confirmation. */
(() => {
    'use strict';
    const el = id => document.getElementById(id);
    const user = typeof userId === 'undefined' ? 'unknown' : userId;
    const pendingKey = `inventory-pending-${user}`;
    const legacyKey = `inventory-legacy-draft-${user}`;
    let card = null, context = null, contextSort = null, step = null, previousPath = 'hands';
    let hands = 0, picks = [], resolving = false, saving = false, generation = 0, lastOperation = null;
    let pending = readStored(pendingKey), legacyDraft = readStored(legacyKey);
    const previousPending = window.hasPendingSortSave;
    window.inventoryHasPending = () => !!pending || saving;
    window.hasPendingSortSave = () => !!pending || saving || !!previousPending?.();

    function readStored(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) { return null; } }
    function store(key, value) {
        try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, JSON.stringify(value)); }
        catch (_) { throw new Error('Не вдалося зберегти чернетку в браузері. Оновіть сторінку та спробуйте знову.'); }
    }
    const sort = () => typeof currentSort === 'undefined' ? null : currentSort;
    const type = () => typeof currentType === 'undefined' ? null : currentType;
    const number = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    function message(text = '', error = false) {
        el('inventory-message').textContent = text;
        el('inventory-message').classList.toggle('error', error);
    }
    function title(pack) { return pack.name || `${pack.code}${pack.location ? ' / ' + pack.location : ''}${pack.label_pack ? ' / ' + pack.label_pack + ' PACK' : ''}`; }
    function locked() { return !!pending || saving; }
    function sync() {
        document.querySelectorAll('[data-inventory-action]').forEach(node => { node.disabled = resolving || locked(); });
        document.querySelectorAll('[data-inventory-input]').forEach(node => { node.disabled = resolving || locked() || node.dataset.closed === 'true'; });
        const retry = el('inventory-retry'); retry.disabled = saving;
        el('inventory-pending').hidden = !pending;
        el('inventory-pending-text').textContent = pending ? `${saving ? 'Зберігаю' : 'Збереження не підтверджене'}. Повторіть цю саму операцію — другий рух не буде створено.` : '';
        el('inventory-legacy').hidden = !legacyDraft;
        if (el('inventory-undo')) el('inventory-undo').disabled = !lastOperation || locked();
        if (el('inventory-done-undo')) el('inventory-done-undo').disabled = !lastOperation || locked();
        document.querySelectorAll('#work-area input, #work-area button').forEach(node => { node.disabled = locked(); });
    }
    async function api(path, data) {
        const response = await fetch(path, data === undefined ? {} : {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
        });
        let result;
        try { result = await response.json(); } catch (_) { throw new Error('Сервер не підтвердив операцію. Повторіть збереження.'); }
        if (!response.ok) {
            const error = new Error(response.status === 401 ? 'Увійдіть знову в той самий акаунт і повторіть збереження.' : result.error || 'Не вдалося виконати дію');
            error.status = response.status; throw error;
        }
        return result;
    }
    function closeModals() {
        for (const name of ['card','hands','picks','target','done']) el(`inventory-${name}-modal`).style.display = 'none';
    }
    function show(next) {
        closeModals(); step = next;
        if (next) el(`inventory-${next}-modal`).style.display = 'flex';
        message(); sync();
    }
    function hideLegacySources() {
        for (const id of ['presort-source-area','presort-last-source','presort-confirm-source','presort-location-source']) if (el(id)) el(id).hidden = true;
    }
    function cardPallets() { return (card?.pallets || []).filter(pallet => pallet.balance > 0); }
    function renderCard() {
        if (!card?.pack) return;
        const pack = card.pack;
        el('inventory-card-title').textContent = title(pack);
        el('inventory-card-expected').textContent = pack.expected_qty === null || pack.expected_qty === undefined ? 'Без плану' : String(pack.expected_qty);
        el('inventory-card-collected').textContent = String(pack.collected || 0);
        el('inventory-card-complete').hidden = !pack.complete;
        const list = el('inventory-card-pallets'); list.replaceChildren();
        const pallets = cardPallets();
        for (const pallet of pallets) {
            const row = document.createElement('div'); row.className = 'inventory-pallet';
            const text = document.createElement('strong'); text.textContent = `Палета ${pallet.pallet_number} — ${pallet.balance} шт.`;
            const detail = document.createElement('span');
            detail.textContent = `${pallet.stage === 'source' ? 'Початкова палета Pre-sort' : 'Палета SORT'} · ${pallet.state === 'open' ? 'Доступна' : pallet.state === 'written_off' ? 'Списана' : 'Закрита'}`;
            row.append(text, detail); list.append(row);
        }
        el('inventory-card-new').hidden = pallets.length > 0;
        el('inventory-pick-button').hidden = pallets.length === 0;
        sync();
    }
    async function loadContext(id) {
        context = await api(`/api/inventory/context/${id}`); contextSort = Number(id);
        const enabled = context.icc_validation_enabled !== false;
        const code = el('icc-code-input');
        code.maxLength = enabled ? 4 : 80;
        code.inputMode = enabled ? 'numeric' : 'text';
        code.placeholder = enabled ? 'Введіть 4 цифри' : 'Введіть ICC код';
        if (enabled) code.setAttribute('pattern', '[0-9]*'); else code.removeAttribute('pattern');
        el('inventory-icc-note').textContent = enabled ? 'Перевірка формату ICC увімкнена.' : 'Перевірка формату ICC вимкнена адміністратором для цього сорту.';
        return context;
    }
    function inputIdentity() {
        const selected = sort(), kind = type();
        if (!selected?.id || !kind) throw new Error('Спочатку оберіть SORT і тип наклейки.');
        const code = el(kind === 'mix' ? 'mix-icc-code-input' : 'icc-code-input').value.trim().toUpperCase();
        if (!code) throw new Error('Введіть або відскануйте код картона.');
        const pack = kind === 'mix' ? 0 : number(el('cartons-count-input').value);
        if (kind !== 'mix' && (!pack || !el('location-code-input').value.trim())) throw new Error('Перевірте PACK і кодові букви наклейки.');
        return {sort_id:Number(selected.id),type:kind,icc_code:code,total_cartons:pack,location_code:kind === 'mix' ? '' : el('location-code-input').value.trim().toUpperCase()};
    }
    async function resolveInput(data) {
        if (locked() || resolving) { if (pending) message('Спочатку повторіть непідтверджене збереження.', true); return; }
        const version = ++generation;
        try {
            data ||= inputIdentity();
            resolving = true; card = null; hands = 0; picks = [];
            show('card'); el('inventory-card-title').textContent = 'Завантаження картки…';
            el('inventory-card-pallets').replaceChildren(); el('inventory-card-new').hidden = true;
            await loadContext(data.sort_id);
            const result = await api('/api/inventory/resolve', data);
            if (version !== generation || Number(sort()?.id) !== data.sort_id) return;
            card = result; renderCard();
        } catch (error) { if (version === generation) message(error.message, true); }
        finally { if (version === generation) { resolving = false; sync(); } }
    }
    window.openInventoryCard = () => resolveInput();
    window.submitSingleData = () => resolveInput();
    window.submitMixData = () => resolveInput();
    window.loadPresortSource = async () => hideLegacySources();
    window.refreshPresortMatches = hideLegacySources;
    window.rememberPresortMatch = () => {};

    window.inventoryHands = () => { if (!card || locked()) return; hands = 0; picks = []; previousPath = 'hands'; el('inventory-hands-quantity').value = ''; show('hands'); el('inventory-hands-quantity').focus(); };
    window.inventoryHandsNext = () => {
        const quantity = number(el('inventory-hands-quantity').value);
        if (!quantity) { message('Кількість у руках має бути цілим числом більше нуля.', true); return; }
        hands = quantity; picks = []; previousPath = 'hands'; showTarget();
    };
    window.inventoryPick = () => {
        if (!card || locked()) return;
        previousPath = 'picks'; const list = el('inventory-picks-list'); list.replaceChildren();
        for (const pallet of cardPallets()) {
            const row = document.createElement('div'); row.className = 'inventory-pick-row';
            const label = document.createElement('label'); label.textContent = `Палета ${pallet.pallet_number}: є ${pallet.balance} шт.${pallet.state === 'open' ? '' : ' · недоступна'}`;
            const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = String(pallet.balance); input.step = '1'; input.value = '0';
            input.id = `inventory-pick-${pallet.id}`; input.dataset.palletId = String(pallet.id); input.dataset.balance = String(pallet.balance);
            input.dataset.closed = String(pallet.state !== 'open'); input.setAttribute('data-inventory-input','');
            input.setAttribute('aria-label',`Скільки взяв з палети ${pallet.pallet_number}`);
            label.htmlFor = input.id; row.append(label,input); list.append(row);
        }
        el('inventory-picks-hands').value = '0'; show('picks');
    };
    window.inventoryPicksNext = () => {
        try {
            const selected = [];
            for (const pallet of cardPallets()) {
                const input = el(`inventory-pick-${pallet.id}`), quantity = number(input.value);
                if (quantity === null || quantity > pallet.balance) throw new Error(`Палета ${pallet.pallet_number}: введіть цілу кількість від 0 до ${pallet.balance}.`);
                if (quantity && pallet.state !== 'open') throw new Error(`Палета ${pallet.pallet_number} закрита або списана.`);
                if (quantity) selected.push({pallet_id:pallet.id,quantity});
            }
            const extra = number(el('inventory-picks-hands').value);
            if (extra === null) throw new Error('Кількість у руках має бути цілим невід’ємним числом.');
            if (!extra && !selected.length) throw new Error('Вкажіть, скільки картонів взяли хоча б з однієї палети.');
            hands = extra; picks = selected; previousPath = 'picks'; showTarget();
        } catch (error) { message(error.message,true); }
    };
    function destinations() {
        const list = context?.destination_pallets || card?.destination_pallets || [];
        const found = new Map(list.map(p => [p.id,p]));
        for (const pallet of card?.pallets || []) if (pallet.stage === 'sorted') found.set(pallet.id,pallet);
        return [...found.values()];
    }
    function showTarget() {
        el('inventory-target-total').textContent = String(hands + picks.reduce((sum,item) => sum + item.quantity,0));
        el('inventory-target-breakdown').textContent = `З палет: ${picks.reduce((sum,item)=>sum+item.quantity,0)} · У руках: ${hands}`;
        const list = el('inventory-destinations'); list.replaceChildren();
        for (const pallet of destinations().filter(p=>p.state === 'open')) {
            const option = document.createElement('option'); option.value = pallet.pallet_number; list.append(option);
        }
        el('inventory-target-number').value = legacyDraft?.pallet_number || '';
        el('inventory-target-new').checked = !!legacyDraft?.pallet_number && !destinations().some(p=>p.pallet_number === legacyDraft.pallet_number);
        show('target'); el('inventory-target-number').focus();
    }
    function operationPayload() {
        if (!card?.pack) throw new Error('Спочатку відкрийте картку картона.');
        const target = el('inventory-target-number').value.trim().toUpperCase();
        if (!target || target.length > 80) throw new Error('Введіть номер цільової палети (до 80 символів).');
        const body = {request_id:crypto.randomUUID(),sort_id:Number(sort().id),pack_id:card.pack.id,hands_quantity:hands,picks:picks.map(item=>({...item}))};
        if (el('inventory-target-new').checked) body.new_pallet_number = target;
        else {
            const pallet = destinations().find(item => String(item.pallet_number).toUpperCase() === target);
            if (!pallet) throw new Error('Палета не існує. Виберіть наявну або явно позначте «Нова палета».');
            if (pallet.state !== 'open') throw new Error('Цільова палета закрита або списана.');
            body.destination_pallet_id = pallet.id;
        }
        if (!hands && !picks.length) throw new Error('Немає картонів для переміщення.');
        return body;
    }
    async function savePending() {
        if (!pending || saving) return;
        saving = true; sync(); message('Зберігаю рухи…');
        const operation = pending;
        try {
            const result = await api(operation.path, operation.body);
            store(pendingKey,null); pending = null;
            card = result; if (contextSort !== operation.body.sort_id) context = null;
            if (operation.kind === 'undo') lastOperation = null;
            else lastOperation = {id:result.operation_id,sort_id:operation.body.sort_id};
            legacyDraft = null; store(legacyKey,null);
            if (card.pack) {
                el('inventory-done-title').textContent = title(card.pack);
                el('inventory-completed').hidden = !card.pack.complete;
                el('inventory-done-summary').textContent = `${operation.kind === 'undo' ? 'Операцію скасовано компенсуючим рухом.' : 'Рухи збережено.'} Зібрано: ${card.pack.collected}${card.pack.expected_qty === null || card.pack.expected_qty === undefined ? '' : ' із ' + card.pack.expected_qty}.`;
            }
            el('inventory-last-action').hidden = !lastOperation;
            el('inventory-last-text').textContent = lastOperation ? `Остання операція: ${card.pack ? title(card.pack) : 'картони'}` : '';
            show('done');
        } catch (error) {
            if ([400,403,404,409].includes(error.status)) { store(pendingKey,null); pending = null; }
            message(error.message,true);
        } finally { saving = false; sync(); }
    }
    window.inventoryFinish = async () => {
        if (locked()) return;
        try {
            const body = operationPayload();
            pending = {kind:'movement',path:'/api/inventory/operations',body}; store(pendingKey,pending);
            await savePending();
        } catch (error) { if (!saving) { pending = null; sync(); } message(error.message,true); }
    };
    window.inventoryRetry = () => savePending();
    window.inventoryUndo = async () => {
        if (!lastOperation || locked()) return;
        pending = {kind:'undo',path:`/api/inventory/operations/${lastOperation.id}/undo`,
            body:{request_id:crypto.randomUUID(),sort_id:lastOperation.sort_id,reason:'Скасування останньої операції'}};
        try { store(pendingKey,pending); await savePending(); } catch (error) { pending=null; sync(); message(error.message,true); }
    };
    function manual() {
        ++generation; resolving = false; show(null);
        for (const id of ['icc-code-input','cartons-count-input','location-code-input','mix-icc-code-input']) el(id).value = '';
        el(type() === 'mix' ? 'mix-icc-code-input' : 'icc-code-input').focus();
    }
    window.inventoryManualNext = () => { if (!locked()) manual(); };
    window.inventoryScanNext = async () => {
        if (locked()) return;
        manual();
        if (type() === 'mix') await window.openCameraScannerMix(); else await window.openCameraScanner();
    };
    window.inventoryRefreshCard = async () => {
        if (!card?.pack || locked()) return;
        const id = card.pack.id;
        await resolveInput({sort_id:Number(sort().id),pack_id:id});
    };
    window.inventoryBackHandler = () => {
        if (!step || el(`inventory-${step}-modal`).style.display === 'none') return false;
        if (locked()) { message('Дочекайтеся підтвердження збереження або повторіть його.',true); return true; }
        if (step === 'target') show(previousPath);
        else if (step === 'hands' || step === 'picks') { show('card'); renderCard(); }
        else { ++generation; resolving=false; show(null); }
        return true;
    };
    window.inventoryExit = () => window.inventoryBackHandler();
    for (const name of ['selectType','selectSort','changeSortSelection','checkContainerAndShowSortMenu','closeWorkArea']) {
        const original = window[name];
        if (typeof original !== 'function') continue;
        window[name] = function(...args) {
            if (locked()) { message('Спочатку повторіть непідтверджене збереження.',true); return; }
            const result = original.apply(this,args);
            if (name === 'selectType' && sort()?.id) loadContext(sort().id).catch(error=>message(error.message,true));
            return result;
        };
    }
    async function inspectLegacy() {
        const legacy = typeof pendingSortSave === 'undefined' ? null : pendingSortSave;
        if (!legacy?.request_id) return;
        try {
            const result = await api(`/api/inventory/legacy-operations/${encodeURIComponent(legacy.request_id)}`);
            if (!result.confirmed) { legacyDraft={...legacy}; store(legacyKey,legacyDraft); }
            if (typeof clearPendingSortSave === 'function') clearPendingSortSave();
            if (typeof syncSortSaveControls === 'function') syncSortSaveControls();
            message(result.confirmed ? 'Попереднє збереження підтверджено. Повторно додавати цей картон не потрібно.' : 'Попередня операція не була записана. Можна повернути її як чернетку нового сценарію.');
        } catch (error) { message(error.message,true); }
    }
    window.inventoryRestoreLegacy = async () => {
        if (!legacyDraft || locked()) return;
        const draft = {...legacyDraft};
        try {
            if (Number(sort()?.id) !== Number(draft.sort_id)) await window.selectSort(draft.sort_id);
            window.closeSortMenu?.(); window.selectType(draft.type);
            el(draft.type === 'mix' ? 'mix-icc-code-input' : 'icc-code-input').value = draft.icc_code;
            el('cartons-count-input').value = draft.total_cartons || '';
            el('location-code-input').value = draft.location_code || '';
            await resolveInput();
            if (card?.pack) {
                hands=Number(draft.cartons_count); picks=[]; previousPath='hands';
                el('inventory-hands-quantity').value=String(hands); show('hands');
                message('Це чернетка. Рухи з’являться лише після «Готово».');
            }
        } catch (error) { message(error.message,true); }
    };
    document.addEventListener('DOMContentLoaded', async () => {
        document.body.classList.add('inventory-flow-active'); hideLegacySources(); sync();
        await inspectLegacy(); sync();
        if (sort()?.id) loadContext(sort().id).catch(error=>message(error.message,true));
    });
})();
