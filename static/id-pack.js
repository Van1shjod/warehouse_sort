// Hardware barcode scanner workflow. Drafts and unknown save outcomes survive reload.
(() => {
    'use strict';
    const el = id => document.getElementById(id);
    const key = 'warehouse-id-pack-' + userId;
    let state = null, saved = null, busy = false;
    try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) {}
    if (!saved?.sort?.id || !['single','mix'].includes(saved.type)) saved = null;
    const pending = () => state?.pending || saved?.pending;
    const amount = () => state.scans.length + state.manual;
    const code = value => {
        const chars=Array.from(value.replace(/[\r\n]+$/, ''));
        let end=2;
        while(chars[end]==='0')end++;
        end+=4;
        return chars.length < end ? null : chars.slice(0,end).join('');
    };
    const valid = value => Array.from(value).length >= 6 && Array.from(value).length <= 500 && !/[\x00-\x1f]/.test(value) && code(value)!==null;
    const invalidMessage = value => Array.from(value).length >= 6 && code(value)===null ?
        'Недостатньо символів ID Pack після початкових нулів.' : 'Введіть ID Pack (від 6 до 500 символів)';
    function persist() {
        try {
            if (state) sessionStorage.setItem(key, JSON.stringify(state));
            else sessionStorage.removeItem(key);
            saved = state ? JSON.parse(JSON.stringify(state)) : null;
            return true;
        } catch (_) { return false; }
    }
    function message(text, error=false) {
        el('id-pack-message').textContent = text;
        el('id-pack-message').classList.toggle('error', error);
    }
    function focus(id) { el(id).focus(); }
    function render() {
        const active = !!state && el('work-area').style.display !== 'none';
        document.body.classList.toggle('id-pack-working', active);
        el('id-pack-panel').hidden = !active;
        el('id-pack-recovery').hidden = !pending();
        if (!state) return;
        const phase = state.phase;
        for (const [id, show] of [['id-pack-identify-form',phase==='identify'], ['id-pack-expected-form',phase==='expected'],
            ['id-pack-count',phase==='count'], ['id-pack-pallet-form',phase==='pallet']]) el(id).hidden = !show;
        el('id-pack-panel').querySelectorAll('[data-id-pack-prefix]').forEach(node => {node.textContent=state.prefix || '';});
        el('id-pack-amount').textContent = amount();
        el('id-pack-total').textContent = state.type==='single' ? `із ${state.expected || 0}` : 'картонів';
        el('id-pack-collected').textContent = state.collected ? `Уже збережено: ${state.collected}` : '';
        el('id-pack-receipt-summary').textContent = `Додаємо: ${amount()} картонів`;
        el('id-pack-panel').querySelectorAll('input,button').forEach(node => {node.disabled = busy || !!state.pending;});
        el('id-pack-continue').disabled = busy || !!state.pending || amount()===0;
        el('id-pack-retry').hidden = !state.pending;
        el('id-pack-retry').disabled = busy;
        el('id-pack-save').textContent = busy ? 'Збереження…' : 'Готово';
    }
    async function api(path, payload) {
        const response = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        let data;
        try {data=await response.json();} catch (_) {throw Error('Збереження не підтверджене. Повторіть запит.');}
        if (!response.ok) {
            const error=Error(data.error || 'Не вдалося виконати дію');
            error.definitive=[400,403,404,409,413].includes(response.status); throw error;
        }
        return data;
    }
    async function run(fn) {
        if (busy) return;
        busy=true; render();
        try {await fn();} catch(error) {message(error.message,true);}
        finally {busy=false; render();}
    }
    function restoreFields() {
        el('id-pack-expected').value=state.expected || '';
        el('id-pack-pallet').value=state.pallet || '';
        el('id-pack-seed').value=''; el('id-pack-scan').value='';
    }
    window.openIdPack = () => {
        if (window.sortActionBlocked() || !currentSort || !['single','mix'].includes(currentType)) return;
        if (state) return;
        window.chooseCollectionMode('different');
        state = saved && saved.sort.id===currentSort.id && saved.type===currentType ? saved :
            {sort:currentSort,type:currentType,phase:'identify',prefix:'',expected:null,scans:[],manual:0,collected:0};
        message(''); restoreFields(); persist(); render();
        focus(state.phase==='count'?'id-pack-scan':state.phase==='expected'?'id-pack-expected':state.phase==='pallet'?'id-pack-pallet':'id-pack-seed');
    };
    function leave() {
        if (busy || pending()) return;
        persist(); state=null; render();
        el(currentType==='mix'?'mix-input-section':'single-input-section').style.display='block';
        focus(currentType==='mix'?'mix-icc-code-input':'icc-code-input');
    }
    el('id-pack-exit').onclick=leave;
    el('id-pack-identify-form').onsubmit = event => {
        event.preventDefault();
        return run(async () => {
            const value=el('id-pack-seed').value.replace(/[\r\n]+$/, '');
            if (!valid(value)) throw Error(invalidMessage(value));
            const result=await api('/api/id-pack/resolve',{sort_id:state.sort.id,type:state.type,id_pack:value});
            const changed=state.prefix !== result.prefix;
            state.prefix=result.prefix; state.collected=result.group?.collected || 0;
            if (changed) {state.scans=[]; state.manual=0;}
            state.expected=result.group?.expected_qty || (changed?null:state.expected);
            state.phase=state.type==='single'?'expected':'count';
            restoreFields(); message(''); persist(); render();
        }).then(()=>focus(state.phase==='identify'?'id-pack-seed':state.phase==='expected'?'id-pack-expected':'id-pack-scan'));
    };
    el('id-pack-expected-form').onsubmit = event => {
        event.preventDefault(); if (busy || pending()) return;
        const raw=el('id-pack-expected').value;
        if (!/^[1-9]\d{0,8}$/.test(raw)) {message('Очікувана кількість: введіть ціле число більше нуля',true); return;}
        state.expected=Number(raw); state.phase='count'; message(''); persist(); render(); focus('id-pack-scan');
    };
    el('id-pack-scan-form').onsubmit = event => {
        event.preventDefault(); if (busy || pending()) return;
        const input=el('id-pack-scan'), value=input.value.replace(/[\r\n]+$/, ''); input.value='';
        if (!valid(value)) {message(invalidMessage(value),true); focus('id-pack-scan'); return;}
        if (code(value)!==state.prefix) {message('Це інший картон',true); focus('id-pack-scan'); return;}
        if (state.type==='single' && amount()+state.collected>=state.expected) {message('Цей картон зібраний повністю',true); focus('id-pack-scan'); return;}
        state.scans.push(value); message('✓ Картон додано');
        if (!persist()) {state.scans.pop(); message('Не вдалося зберегти чернетку. Спробуйте ще раз.',true);}
        render(); focus('id-pack-scan');
    };
    // Barcode scanners usually append Enter; accept Tab terminators as well.
    for (const id of ['id-pack-seed','id-pack-scan']) el(id).addEventListener('keydown', event => {
        if (event.key==='Tab' && el(id).value) {event.preventDefault();el(id).form.requestSubmit();}
    });
    el('id-pack-manual').onclick=()=>{
        if(busy || pending()) return;
        el('id-pack-quantity').value=amount(); el('id-pack-quantity-error').textContent='';
        el('id-pack-quantity-modal').style.display='flex'; focus('id-pack-quantity');
    };
    function closeQuantity() {el('id-pack-quantity-modal').style.display='none'; focus('id-pack-scan');}
    el('id-pack-quantity-cancel').onclick=closeQuantity;
    el('id-pack-quantity-form').onsubmit=event=>{
        event.preventDefault(); const raw=el('id-pack-quantity').value;
        if (!/^(0|[1-9]\d{0,8})$/.test(raw)) {el('id-pack-quantity-error').textContent='Введіть ціле число від 0';return;}
        const total=Number(raw);
        if (total<state.scans.length) {el('id-pack-quantity-error').textContent='Кількість не може бути меншою за число зісканованих ID.';return;}
        if (state.type==='single' && total+state.collected>state.expected) {el('id-pack-quantity-error').textContent='Кількість перевищує очікувану';return;}
        state.manual=total-state.scans.length; persist(); render(); closeQuantity();
    };
    el('id-pack-continue').onclick=()=>{
        if (busy || pending() || amount()===0) return;
        state.phase='pallet'; message(''); persist(); render(); focus('id-pack-pallet');
    };
    async function submitReceipt() {
        const data=state.pending;
        try {
            const result=await api('/api/id-pack/submit',data);
            state={sort:state.sort,type:state.type,phase:'identify',prefix:'',expected:null,scans:[],manual:0,collected:0};
            persist(); restoreFields();
            message(`✓ ${result.prefix}: додано ${result.quantity} · палета SORT ${result.pallet_number}` + (result.is_completed?'\nЦей картон зібраний повністю':''));
            window.loadStats?.();
        } catch (error) {
            if (error.definitive) {state.pending=null; persist();}
            throw error;
        }
    }
    el('id-pack-pallet-form').onsubmit=event=>{
        event.preventDefault();
        return run(async()=>{
            if (!state.pending) {
                const number=el('id-pack-pallet').value.trim();
                if (!number || number.length>80) throw Error('Введіть номер палети (до 80 символів)');
                state.pallet=number;
                state.pending={sort_id:state.sort.id,type:state.type,id_pack:state.prefix,expected_qty:state.expected,
                    scans:[...state.scans],manual_quantity:state.manual,pallet_number:number,request_id:crypto.randomUUID()};
                if (!persist()) {state.pending=null;throw Error('Не вдалося зберегти чернетку. Спробуйте ще раз.');}
            }
            await submitReceipt();
        }).then(()=>{if(state.phase==='identify') focus('id-pack-seed');});
    };
    el('id-pack-retry').onclick=()=>run(submitReceipt).then(()=>{if(state.phase==='identify')focus('id-pack-seed');});
    el('id-pack-recover').onclick=()=>{
        if (!saved || busy) return;
        state=saved; currentSort=state.sort;currentType=state.type;
        el('sort-menu').style.display='none';el('sort-selection').style.display='none';
        el('work-area').style.display='block';el('current-type').textContent=currentType.toUpperCase();
        window.showCurrentSortInfo?.(currentSort); restoreFields(); message('Збереження не підтверджене. Повторіть запит.');render();
    };
    const oldClose=window.closeWorkArea, oldSelect=window.selectType;
    window.closeWorkArea=()=>{
        if(busy || pending())return;
        if(state){persist();state=null;render();}
        oldClose();
    };
    window.selectType=type=>{
        if(busy || pending())return;
        if(state){persist();state=null;render();}
        oldSelect(type);
    };
    const oldBlocked=window.sortActionBlocked;
    window.sortActionBlocked=()=>{
        if (busy || pending()) {showToast('Спочатку завершіть або повторіть збереження картона.','warning');return true;}
        return oldBlocked();
    };
    window.hasPendingIdPackSave=()=>busy || !!pending();
    window.idPackBackHandler=()=>{
        if (!state || el('work-area').style.display==='none') return false;
        if (busy || pending()) return true;
        if (el('id-pack-quantity-modal').style.display!=='none') {closeQuantity();return true;}
        if (state.phase==='pallet') state.phase='count';
        else if (state.phase==='count') state.phase=state.type==='single'?'expected':'identify';
        else if (state.phase==='expected') state.phase='identify';
        else {leave();return true;}
        restoreFields();persist();render();return true;
    };
    document.addEventListener('keydown',event=>{
        if(event.key==='Escape' && el('id-pack-quantity-modal').style.display!=='none'){event.preventDefault();closeQuantity();}
    });
    render();
})();
