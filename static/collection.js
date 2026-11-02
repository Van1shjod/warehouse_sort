// Guided Single/Mix collection: exactly one confirmed label = one atomic transfer.
(() => {
    'use strict';
    const el = id => document.getElementById(id);
    const key = 'warehouse-collection-' + userId;
    const oldSelectType = window.selectType;
    const oldSingle = window.submitSingleData, oldMix = window.submitMixData;
    const oldBlocked = window.sortActionBlocked;
    let state = null, busy = false, generation = 0, focusAfterRun = false;
    let completionTimer = null;
    const completionNotice = document.createElement('div');
    completionNotice.className = 'collection-complete-notice';
    completionNotice.hidden = true;
    completionNotice.setAttribute('role','status');
    completionNotice.setAttribute('aria-live','polite');
    document.body.append(completionNotice);
    function notifyPalletComplete(number, allCollected) {
        clearTimeout(completionTimer);
        el('toast-message').classList.remove('show');
        completionNotice.textContent = `✓ Усі потрібні картони\nз палети № ${number} забрано` + (allCollected ? '\n\nТовар повністю зібрано' : '');
        completionNotice.hidden = false;
        completionTimer = setTimeout(()=>{completionNotice.hidden=true;},3500);
    }
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) {}
    const norm = value => String(value ?? '').trim().toUpperCase();
    const label = pack => `${pack.code}${pack.location ? ' / ' + pack.location : ''}${pack.label_pack ? ' / ' + pack.label_pack + ' PACK' : ''}`;
    const pending = () => !!(state?.pending || saved?.pending);
    const persist = () => {
        try {
            if (state) sessionStorage.setItem(key, JSON.stringify(state));
            else sessionStorage.removeItem(key);
            return true;
        } catch (_) { return false; }
    };
    const announce = (message, error=false) => {
        el('collection-message').textContent = message;
        el('collection-message').style.color = error ? '#b42318' : '#175b32';
    };
    function inputs(show) {
        el('single-input-section').style.display = show && currentType === 'single' ? 'block' : 'none';
        el('mix-input-section').style.display = show && currentType === 'mix' ? 'block' : 'none';
    }
    function clearInputs() {
        for (const id of ['icc-code-input','location-code-input','cartons-count-input','mix-icc-code-input']) el(id).value = '';
    }
    function focusLabel() {
        if (busy) { focusAfterRun=true; return; }
        focusWorkInput(el(currentType === 'mix' ? 'mix-icc-code-input' : 'icc-code-input'));
    }
    function identity() {
        return {sort_id:currentSort.id, type:currentType,
            icc_code:norm(el(currentType === 'mix' ? 'mix-icc-code-input' : 'icc-code-input').value),
            total_cartons:currentType === 'mix' ? 0 : Number(el('cartons-count-input').value),
            location_code:currentType === 'mix' ? '' : norm(el('location-code-input').value)};
    }
    function sources() {
        return (state?.card?.pallets || []).filter(p => p.stage === 'source' && p.balance > 0);
    }
    function ordered() {
        return sources().filter(p => p.state === 'open').sort((a,b) =>
            String(a.pallet_number).localeCompare(String(b.pallet_number),'uk',{numeric:true,sensitivity:'base'}) * (state.order === 'desc' ? -1 : 1) || a.id-b.id);
    }
    function nextLocation() {
        const next = ordered()[0];
        state.source = next || null; state.confirmedNumber = '';
        state.phase = next ? 'location' : 'empty';
        if (!next && sources().length) announce('Решта картонів на закритих палетах. Зверніться до адміністратора.', true);
        else if (!next) {
            resetToIdentify(`✓ ${label(state.card.pack)}: усі наявні картони цього товару зібрано.\nНа палетах SORT: ${state.card.pack.collected}. Можна обрати наступний товар.`);
            return;
        }
        el('collection-source-number').value = '';
        persist(); render();
        if (next) el('collection-location').scrollIntoView({block:'start'});
    }
    async function api(path, value) {
        const response = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
        let result;
        try { result = await response.json(); } catch (_) { throw new Error('Відповідь сервера не підтверджена. Повторіть запит.'); }
        if (!response.ok) {
            const failure = new Error(result.error || 'Не вдалося виконати дію');
            failure.code = result.code;
            failure.definitive = [400,403,404,409].includes(response.status);
            throw failure;
        }
        return result;
    }
    async function run(fn) {
        if (busy) return;
        busy = true; render();
        try { await fn(); } catch (error) { announce(error.message,true); if(!state) showToast(error.message,'error'); }
        finally { busy = false; render(); if(focusAfterRun){focusAfterRun=false;focusLabel();} }
    }
    function render() {
        const active = !!state;
        document.body.classList.toggle('collection-working',active);
        syncWorkView();
        el('collection-panel').hidden = !active;
        el('collection-tools').hidden = !active;
        el('collection-active-label').hidden = !active || state.phase !== 'confirm';
        el('collection-resume').hidden = !saved;
        document.querySelectorAll('[data-label-submit]').forEach(button => {
            button.textContent = !active ? 'Продовжити' : state.phase === 'confirm' ? 'Підтвердити картон' : 'Знайти товар';
        });
        if (!active) return;
        const phase = state.phase;
        el('collection-heading').textContent = {identify:'Оберіть товар',location:'Наступна палета',confirm:'Картон',empty:'Збирання'}[phase] || 'Збирання';
        el('collection-identify').hidden = phase !== 'identify';
        el('collection-location').hidden = phase !== 'location';
        el('collection-confirm').hidden = phase !== 'confirm';
        el('collection-empty').hidden = phase !== 'empty';
        el('collection-retry').hidden = !state.pending;
        el('collection-refresh').hidden = !state.card || !!state.pending;
        el('collection-undo').hidden = !state.lastPick || !!state.pending;
        el('collection-order-row').hidden = !['location','confirm'].includes(phase);
        inputs(['identify','confirm'].includes(phase) && !state.pending);
        if (state.card) {
            const p = state.card.pack;
            el('collection-summary').textContent = `${label(p)}\nЗібрано вами: ${p.mine ?? 0} · Залишилось: ${p.remaining}`;
        } else el('collection-summary').textContent = '';
        el('collection-summary').hidden = phase === 'confirm';
        el('collection-order').value = state.order;
        if (state.source) {
            el('collection-source-title').textContent = state.source.pallet_number;
            el('collection-source-count').textContent = `${state.source.balance} картонів`;
            el('collection-confirm-title').textContent = `Палета № ${state.source.pallet_number}`;
            el('collection-hint').textContent = `Очікувана наклейка: ${label(state.card.pack)}\nЗалишилося на цій палеті: ${state.source.balance}`;
            el('collection-active-label').textContent = `Палета ${state.source.pallet_number} · Залишилось: ${state.source.balance}\n${label(state.card.pack)}`;
        }
        const confirming = phase === 'confirm';
        el('icc-code-input').placeholder = confirming ? state.card.pack.code : 'Введіть 4 цифри';
        el('location-code-input').placeholder = confirming ? state.card.pack.location : 'Наприклад: JP-A';
        el('cartons-count-input').placeholder = confirming ? String(state.card.pack.label_pack) : 'PACK із наклейки';
        el('mix-icc-code-input').placeholder = confirming ? state.card.pack.code : 'Введіть код з наклейки';
        el('collection-order').title = phase === 'confirm' ? 'Напрямок після поточної палети' : 'Напрямок обходу';
        document.querySelectorAll('#collection-panel input, #collection-panel button, #collection-panel select, #collection-tools button, #single-input-section input, #single-input-section button, #mix-input-section input, #mix-input-section button').forEach(node => {node.disabled = busy || !!state.pending;});
        el('collection-retry').disabled = busy;
    }
    function resetToIdentify(message='') {
        state = {sort:currentSort,type:currentType,order:state?.order || 'asc',phase:'identify',lastPick:state?.lastPick};
        clearInputs(); announce(message); persist(); render(); focusLabel();
        el('collection-tools').open = false;
    }
    function exit() {
        if (busy || pending()) return;
        generation++;
        state = null; persist(); render(); clearInputs();
        el('work-area').style.display='none';
        el('collection-mode').style.display='flex';
    }
    window.selectType = type => {
        if (oldBlocked() || busy || pending()) return;
        if (!currentSort || !allowedSortTypes().includes(type)) return;
        currentType = type;
        closeSortMenu();
        el('work-area').style.display='none';
        if (type === 'vevor') { el('vevor-development').style.display='flex'; return; }
        el('collection-mode-title').textContent = type.toUpperCase() + ' · спосіб сортування';
        el('collection-mode').style.display='flex';
    };
    window.chooseCollectionMode = mode => {
        if (busy || pending() || oldBlocked()) return;
        saved = null;
        el('collection-mode').style.display='none';
        oldSelectType(currentType);
        el('work-steps').hidden = mode === 'one';
        if (mode === 'one') resetToIdentify();
        else { state = null; persist(); render(); }
    };
    window.sortActionBlocked = () => {
        if (busy || pending()) { showToast('Спочатку завершіть або повторіть збереження картона.','warning'); return true; }
        return oldBlocked();
    };
    window.hasPendingCollectionSave = () => busy || pending();
    // Source lookup now belongs to the guided mode, not the random SORT wizard.
    window.loadPresortSource = () => {};
    for (const id of ['presort-source-area','presort-last-source','presort-confirm-source','presort-location-source']) el(id).hidden = true;
    const closeOriginal = window.closeWorkArea;
    window.closeWorkArea = () => {
        if (busy || pending()) return;
        if (state && !confirm('Завершити збирання? Уже підтверджені картони збережені.')) return;
        state=null; persist(); render(); closeOriginal();
    };
    async function submit() {
        if (!state || busy || pending()) return;
        await run(async () => {
            const entered = identity(), phase = state.phase, version = generation;
            if (phase === 'identify') {
                const card = await api('/api/collection/resolve',entered);
                if (version !== generation) return;
                state.identity=entered; state.card=card;
                if (!sources().length) {
                    announce(card.has_source ? 'Цього товару немає на джерельних палетах або його вже зібрано. Можна обрати наступний.' : 'Цей SORT не має даних Pre-sort. Для «Один товар» оберіть SORT, переведений із Pre-sort.',true);
                    state.phase='empty';
                } else { announce(''); nextLocation(); }
                clearInputs(); persist();
            } else if (phase === 'confirm') {
                const expected=state.identity;
                if (['type','icc_code','location_code','total_cartons'].some(k=>entered[k]!==expected[k])) throw new Error('Це інший картон. Дані мають повністю збігатися з підказкою.');
                state.pending={...entered,pack_id:state.card.pack.id,source_pallet_id:state.source.id,
                    source_number:state.confirmedNumber,request_id:crypto.randomUUID()};
                if(!persist()){
                    delete state.pending;
                    throw new Error('Браузер не дозволив зберегти запит. Дозвольте зберігання даних сайту й повторіть підтвердження.');
                }
                await sendPick();
            }
        });
    }
    window.submitSingleData = () => state ? submit() : oldSingle();
    window.submitMixData = () => state ? submit() : oldMix();
    window.confirmCollectionScan = async (data, type) => {
        if (!state || !['identify','confirm'].includes(state.phase) || type !== currentType) return false;
        if (busy || pending()) return true;
        const complete = data.cell && (type === 'mix' || (Number.isInteger(Number(data.qtyPack))
            && Number(data.qtyPack)>0 && data.prefix && data.zone));
        if (!complete) return false;
        if (type === 'mix') el('mix-icc-code-input').value = norm(data.cell);
        else {
            el('icc-code-input').value = norm(data.cell);
            el('cartons-count-input').value = data.qtyPack;
            el('location-code-input').value = norm(data.prefix) + '-' + norm(data.zone);
        }
        await closeCameraScanner();
        await submit();
        return true;
    };
    async function sendPick() {
        if (state.pendingUndo) {
            const previous = state.lastPick;
            let card;
            try { card=await api('/api/collection/operations/'+state.pendingUndo+'/undo',state.pending); }
            catch (error) { if(error.definitive){delete state.pending;delete state.pendingUndo;persist();} throw error; }
            delete state.pending; delete state.pendingUndo;
            state.card=card; state.identity=previous.identity; state.lastPick=null;
            announce('Останній картон повернуто на джерельну палету.'); nextLocation(); persist(); return;
        }
        const sourceNumber = state.source.pallet_number;
        let result;
        try {
            try { result = await api('/api/collection/pick',state.pending); }
            catch (error) {
                // A prior page may have saved the old destination protocol. The
                // server returns this code only after checking its retry receipt.
                if(error.code!=='destination_removed' || !('destination_pallet_id' in state.pending)) throw error;
                const legacyDestination=state.pending.destination_pallet_id;
                delete state.pending.destination_pallet_id;
                if(!persist()){
                    state.pending.destination_pallet_id=legacyDestination;
                    throw new Error('Браузер не дозволив зберегти запит для безпечного повторення.');
                }
                result=await api('/api/collection/pick',state.pending);
            }
        }
        catch (error) {
            if (error.definitive) { delete state.pending; persist(); }
            throw error;
        }
        delete state.pending; state.card=result;
        state.lastPick={operation_id:result.operation_id,identity:state.identity};
        persist(); clearInputs();
        const source = result.pallets.find(p=>p.id === state.source.id);
        if (source?.balance > 0 && source.state === 'open') {
            state.source=source;
            announce('');
            state.phase='confirm';
            showToast('✓ Картон забрано','success',1800);
        } else {
            announce(`✓ Усі потрібні картони з палети № ${sourceNumber} забрано.`);
            notifyPalletComplete(sourceNumber,result.pack.remaining === 0);
            nextLocation();
        }
        persist(); render();
        if (state.phase==='confirm') focusLabel();
    }
    el('collection-source-form').addEventListener('submit',event=>{
        event.preventDefault();
        if (busy || pending()) return;
        if (norm(el('collection-source-number').value)!==norm(state.source.pallet_number)) { announce('Номер не збігається. Перевірте локацію.',true); return; }
        state.confirmedNumber=norm(el('collection-source-number').value);
        state.phase='confirm'; clearInputs(); announce(''); persist(); render(); focusLabel();
    });
    el('collection-order').addEventListener('change',()=>{
        if (!state || busy || pending()) return;
        state.order=el('collection-order').value;
        if (state.phase==='location') nextLocation();
        persist(); render();
    });
    el('collection-next-item').addEventListener('click',()=>resetToIdentify());
    el('collection-retry').addEventListener('click',()=>run(sendPick));
    el('collection-undo').addEventListener('click',()=>run(async()=>{
        if (!state.lastPick || !confirm('Повернути останній картон на джерельну палету?')) return;
        state.pendingUndo=state.lastPick.operation_id;
        state.pending={request_id:crypto.randomUUID()};
        if(!persist()){
            delete state.pending;delete state.pendingUndo;
            throw new Error('Браузер не дозволив зберегти запит для скасування.');
        }
        await sendPick();
    }));
    el('collection-exit').addEventListener('click',exit);
    el('collection-refresh').addEventListener('click',()=>run(async()=>{
        state.card=await api('/api/collection/resolve',state.identity);
        if (state.phase==='confirm') {
            const source=state.card.pallets.find(p=>p.id===state.source.id && p.state==='open' && p.balance>0);
            if (source) state.source=source; else nextLocation();
        } else nextLocation();
        persist();
    }));
    el('collection-resume-button').addEventListener('click',()=>run(async()=>{
        const response=await fetch('/api/sorts/'+saved.sort.id);
        const sort=await response.json();
        if (!response.ok) throw new Error(sort.error || 'SORT недоступний');
        currentSort=sort; currentType=saved.type; showCurrentSortInfo(sort);
        // The original selector refuses navigation while a saved mutation exists.
        const restored=saved; saved=null; state=restored;
        el('current-type').textContent=currentType.toUpperCase();
        closeSortMenu();
        el('work-area').style.display='block'; el('work-steps').hidden=true;
        if (state.pending) await sendPick();
        else if (state.identity) {
            state.card=await api('/api/collection/resolve',state.identity);
            nextLocation();
        }
        persist();
    }));
    window.collectionBackHandler = () => {
        if (el('vevor-development').style.display==='flex') { el('vevor-development').style.display='none'; showSortMenu(); return true; }
        if (el('collection-mode').style.display==='flex') { el('collection-mode').style.display='none'; showSortMenu(); return true; }
        if (!state) return false;
        if (busy || pending()) return true;
        if (state.phase==='confirm') { state.phase='location';state.confirmedNumber='';clearInputs();persist();render(); }
        else exit();
        return true;
    };
    window.addEventListener('beforeunload', event=>{ if (busy || pending()) {event.preventDefault();event.returnValue='';} });
    // Capture Enter on any label field so confirmation cannot accidentally submit
    // another wizard or treat a scanner's final Enter as two cartons.
    for (const id of ['icc-code-input','cartons-count-input','location-code-input','mix-icc-code-input']) {
        el(id).addEventListener('keypress',event=>{
            if (state && event.key==='Enter') {event.preventDefault();event.stopImmediatePropagation();submit();}
        },true);
    }
    function syncWorkView() {
        document.body.classList.toggle('sort-working',el('work-area').style.display !== 'none');
    }
    new MutationObserver(syncWorkView).observe(el('work-area'),{attributes:true,attributeFilter:['style']});
    render();
})();
