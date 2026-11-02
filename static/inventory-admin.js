(() => {
    'use strict';
    const el = name => document.getElementById('inventory-admin-' + name);
    const states = {open:'Відкрита',closed:'Закрита',written_off:'Списана'};
    let jobs = [], detail = null, generation = 0, listGeneration = 0, busy = false;
    let editor = null, pending = null, storageKey = null;
    const text = (name, value, error = false) => { el(name).textContent = value; el(name).className = error ? 'error' : ''; };
    const packTitle = pack => `${pack.name ? pack.name + ' · ' : ''}${pack.code || '#' + pack.id}${pack.location ? ' / ' + pack.location : ''}${pack.label_pack ? ' / ' + pack.label_pack + ' PACK' : ''}`;
    const dateText = value => {
        if (!value) return '—';
        const source = String(value).replace(' ', 'T');
        const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(source) ? source : source + 'Z');
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString('uk-UA');
    };
    function node(tag, value, className) {
        const item = document.createElement(tag); if (value !== undefined) item.textContent = String(value);
        if (className) item.className = className; return item;
    }
    function action(label, handler, disabled = false, style = 'secondary') {
        const item = node('button', label, 'btn btn-small btn-' + style);
        item.type = 'button'; item.disabled = disabled; item.addEventListener('click', handler); return item;
    }
    function tableRow(target, values, labels) {
        const row = node('tr');
        values.forEach((value, index) => {
            const cell = node('td'); cell.dataset.label = labels[index];
            if (['Товар','Палета','Працівник','Причина / операція'].includes(labels[index])) cell.dataset.noTranslate='';
            if (typeof value === 'string' || typeof value === 'number') cell.textContent = String(value);
            else cell.append(value);
            row.append(cell);
        });
        target.append(row);
    }
    function sync() {
        const locked = busy || !!pending;
        el('job').disabled = locked; el('refresh').disabled = locked;
        el('settings').disabled = locked || !detail;
        el('close-job').disabled = locked || !detail || jobs.find(job => String(job.id) === el('job').value)?.status === 'closed';
        el('editor-close').disabled = locked; el('editor-cancel').disabled = locked;
        el('editor-save').disabled = busy;
        el('editor-save').textContent = pending ? 'Повторити збереження' : 'Зберегти';
        editor?.controls.forEach(control => { control.disabled = locked; });
    }
    async function request(url, options) {
        const response = await fetch(url, options);
        let result = {};
        try { result = await response.json(); } catch (_) {}
        if (!response.ok) {
            const failure = new Error(result.error || (response.status === 401 ? 'Сесія завершилась. Увійдіть знову.' : response.status === 403 ? 'Потрібні права адміністратора.' : 'Не вдалося виконати операцію.'));
            failure.status = response.status; throw failure;
        }
        return result;
    }
    function persist() {
        if (!storageKey) return;
        try { pending ? sessionStorage.setItem(storageKey, JSON.stringify(pending)) : sessionStorage.removeItem(storageKey); } catch (_) {}
    }
    function closeEditor() {
        if (busy || pending) { text('editor-message', 'Збереження ще не підтверджене. Повторіть цю саму операцію.', true); return false; }
        el('modal').style.display = 'none'; editor = null; return true;
    }
    window.inventoryAdminBackHandler = () => {
        if (el('modal').style.display === 'none') return false;
        closeEditor(); return true;
    };
    window.hasPendingInventoryAdminSave = () => !!pending || busy;
    function openEditor(spec) {
        if (busy || pending) return;
        editor = {...spec, controls:[]};
        text('editor-title', spec.title); text('editor-help', spec.help || ''); text('editor-message', '');
        el('editor-fields').replaceChildren(); el('modal').style.display = 'flex';
        spec.fields?.forEach(field => {
            const label = node('label', field.label);
            const input = node(field.options ? 'select' : field.multiline ? 'textarea' : 'input');
            input.id = 'inventory-admin-edit-' + field.name;
            label.htmlFor = input.id;
            if (field.options) field.options.forEach(option => input.add(new Option(option.label, option.value)));
            else { input.type = field.type || 'text'; if (field.step) input.step = String(field.step); }
            if (field.min !== undefined) input.min = String(field.min);
            if (field.maxLength) input.maxLength = field.maxLength;
            input.value = field.value ?? ''; input.required = !!field.required;
            input.dataset.field = field.name; editor.controls.push(input);
            el('editor-fields').append(label,input);
        });
        sync(); editor.controls[0]?.focus();
    }
    function number(value, positive = false) {
        if (!/^-?\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) === 0 || (positive && Number(value) < 1)) throw new Error('Кількість має бути цілим числом ' + (positive ? 'більше нуля.' : 'і не дорівнювати нулю.'));
        return Number(value);
    }
    function editExpected(pack) {
        openEditor({kind:'expected',path:`/api/admin/inventory/packs/${pack.id}`,method:'PUT',title:'Очікувана кількість',
            help:packTitle(pack),fields:[{name:'expected_qty',label:'Скільки очікується всього' + (pack.type === 'mix' ? ' (можна лишити порожнім)' : ''),type:'number',min:1,step:1,value:pack.expected_qty ?? '',required:pack.type !== 'mix'}],
            payload:values => ({expected_qty:values.expected_qty === '' && pack.type === 'mix' ? null : number(values.expected_qty,true)})});
    }
    function editPallet(pallet) {
        if (pallet.stage === 'carried') {
            openEditor({kind:'pallet',path:`/api/admin/inventory/pallets/${pallet.id}`,method:'PUT',title:`Зібрано у ${pallet.custodian_username || pallet.pallet_number}`,
                fields:[{name:'state',label:'Стан',value:pallet.state,options:[{value:'open',label:'Відкрита'},{value:'closed',label:'Закрита'}]}],
                payload:values=>({state:values.state})});
            return;
        }
        openEditor({kind:'pallet',path:`/api/admin/inventory/pallets/${pallet.id}`,method:'PUT',title:`Палета ${pallet.pallet_number}`,
            help:'Перейменування не змінює історію рухів. Закрита палета недоступна для звичайного додавання та відбору.',fields:[
                {name:'pallet_number',label:'Номер палети',value:pallet.pallet_number,maxLength:80,required:true},
                {name:'state',label:'Стан',value:pallet.state,options:[{value:'open',label:'Відкрита'},{value:'closed',label:'Закрита'}]}
            ],payload:values => {const name=values.pallet_number.trim(); if (!name) throw new Error('Введіть номер палети.'); return {pallet_number:name,state:values.state};}});
    }
    function adjust(pallet) {
        openEditor({kind:'adjust',path:'/api/admin/inventory/adjustments',method:'POST',title:`Коригування палети ${pallet.pallet_number}`,
            help:'Додатне число додає залишок, від’ємне — списує. Причина збережеться в історії.',fields:[
                {name:'pack_id',label:'Товар',options:(detail.packs || []).map(pack=>({value:String(pack.id),label:packTitle(pack)})),required:true,value:detail.packs?.[0]?.id ?? ''},
                {name:'delta',label:'Рух: +N або −N',type:'number',step:1,required:true},
                {name:'reason',label:'Причина',multiline:true,required:true,maxLength:500}
            ],payload:values => ({sort_id:Number(el('job').value),pack_id:number(values.pack_id,true),pallet_id:pallet.id,delta:number(values.delta),reason:reason(values.reason)})});
    }
    function correct(movement) {
        openEditor({kind:'correct',path:`/api/admin/inventory/movements/${movement.id}/correct`,method:'POST',title:`Виправити рух #${movement.id}`,
            help:`Початковий рух ${movement.delta > 0 ? '+' : ''}${movement.delta} залишиться в історії. Будуть створені компенсація та новий рух.`,fields:[
                {name:'delta',label:'Правильна кількість зі знаком',type:'number',step:1,value:movement.delta,required:true},
                {name:'reason',label:'Причина виправлення',multiline:true,required:true,maxLength:500}
            ],payload:values => ({delta:number(values.delta),reason:reason(values.reason)})});
    }
    function reason(value) { const result = value.trim(); if (!result) throw new Error('Вкажіть причину зміни.'); return result; }
    function writeoff(pallet) {
        openEditor({kind:'writeoff',path:`/api/admin/inventory/pallets/${pallet.id}/writeoff`,method:'POST',title:`Списати залишок палети ${pallet.pallet_number}`,
            help:'Увесь залишок буде списано компенсуючими рухами. Початкова історія збережеться.',fields:[
                {name:'reason',label:'Причина списання',multiline:true,required:true,maxLength:500}
            ],payload:values => ({reason:reason(values.reason)})});
    }
    function render() {
        for (const name of ['packs','pallets','workers','movements']) el(name).replaceChildren();
        if (!detail) return;
        const query = el('search').value.trim().toUpperCase();
        const match = value => !query || String(value).toUpperCase().includes(query);
        const packs = detail.packs || [], pallets = detail.pallets || [], movements = detail.movements || [];
        const count = pallets.reduce((sum,pallet)=>sum+(pallet.balances || []).reduce((n,row)=>n+Number(row.balance || 0),0),0);
        text('summary', `Товарів: ${packs.length} · Палет: ${pallets.length} · На палетах: ${count} картонів`);
        text('icc-note', `Перевірка ICC: ${detail.icc_validation_enabled ? 'увімкнена' : 'вимкнена'}`);
        for (const pack of packs.filter(pack=>match(packTitle(pack)))) {
            tableRow(el('packs'),[packTitle(pack),String(pack.type).toUpperCase(),pack.expected_qty ?? 'Без плану',pack.collected ?? 0,
                action('Змінити очікування',()=>editExpected(pack),busy || !!pending)],['Товар','Тип','Очікується','Зібрано','Дії']);
        }
        if (!el('packs').children.length) el('packs').append(node('tr','Товарів за цим пошуком немає.'));
        for (const pallet of pallets) {
            const balances = pallet.balances || [];
            if (!match([pallet.pallet_number,pallet.custodian_username || '',...balances.map(row=>`${row.code} ${row.location || ''}`)].join(' '))) continue;
            const card = node('article',undefined,'inventory-admin-pallet ' + pallet.state);
            const carried=pallet.stage === 'carried';
            card.append(node('h4',`${carried ? 'Зібрано у ' + (pallet.custodian_username || pallet.pallet_number) : 'Палета ' + pallet.pallet_number} · ${states[pallet.state] || pallet.state}`));
            if(!carried) card.append(node('p',pallet.stage === 'source' ? 'Джерельна палета Pre-sort' : 'Палета зібраного товару SORT'));
            for (const balance of balances) {
                const pack = packs.find(pack=>String(pack.id)===String(balance.pack_id)) || balance;
                card.append(node('p',`${packTitle(pack)} — ${balance.balance} шт.`));
            }
            if (!balances.length) card.append(node('p','Залишок порожній.'));
            card.append(action(carried ? 'Стан' : 'Номер / стан',()=>editPallet(pallet),busy || !!pending || pallet.state === 'written_off'),
                action('Коригувати залишок',()=>adjust(pallet),busy || !!pending || pallet.state !== 'open' || !packs.length),
                action('Списати залишок',()=>writeoff(pallet),busy || !!pending || pallet.state === 'written_off' || !balances.some(row=>Number(row.balance)>0),'warning'));
            el('pallets').append(card);
        }
        if (!el('pallets').children.length) el('pallets').append(node('p','Палет за цим пошуком немає.'));
        for (const worker of detail.workers || []) {
            if (!match(worker.username)) continue;
            const line=node('p');
            const name=node('span',worker.username || '#' + worker.id);name.dataset.noTranslate='';
            line.append(name,node('span',` · Почав: ${dateText(worker.started_at)} · Остання активність: ${dateText(worker.last_seen_at)}`));
            el('workers').append(line);
        }
        if (!el('workers').children.length) el('workers').append(node('p','Активних працівників немає.'));
        for (const movement of movements) {
            const pack = packs.find(pack=>String(pack.id)===String(movement.pack_id)) || movement;
            if (!match(`${packTitle(pack)} ${movement.pallet_number} ${movement.username || ''} ${movement.reason || ''}`)) continue;
            const delta = node('span',`${movement.delta > 0 ? '+' : ''}${movement.delta}`,movement.delta > 0 ? 'inventory-admin-positive' : 'inventory-admin-negative');
            tableRow(el('movements'),[dateText(movement.timestamp),packTitle(pack),movement.pallet_number,delta,
                movement.username || `Користувач #${movement.user_id}`,movement.reason || movement.kind || '—',
                action('Виправити',()=>correct(movement),busy || !!pending || !!movement.corrected_by || movement.can_correct === false)],
                ['Час','Товар','Палета','Рух','Працівник','Причина / операція','Дії']);
        }
        if (!el('movements').children.length) el('movements').append(node('tr','Рухів за цим пошуком немає.'));
    }
    async function loadDetail() {
        const version = ++generation, id=el('job').value;
        detail=null; el('workspace').hidden=true; render();
        if (!id) { text('message','Оберіть завдання.'); sync(); return; }
        text('message','Завантаження залишків…');
        try {
            const result=await request(`/api/admin/inventory/jobs/${encodeURIComponent(id)}`);
            if (version !== generation) return;
            detail=result; el('workspace').hidden=false; render(); sync(); text('message','Дані оновлено.');
        } catch (failure) { if (version===generation) { text('message',failure.message,true); sync(); } }
    }
    function recover() {
        if (!storageKey || pending) return;
        try {
            const saved=JSON.parse(sessionStorage.getItem(storageKey) || 'null');
            if (saved && /^\/api\/(admin\/inventory\/|sorts\/\d+\/status$)/.test(saved.path) && saved.payload) pending=saved;
        } catch (_) {}
        if (!pending) return;
        editor={controls:[],...pending};
        el('editor-fields').replaceChildren(); text('editor-title',pending.title || 'Повторити непідтверджене збереження');
        text('editor-help','Попереднє збереження не підтверджене. Повторюється той самий запит, без створення нової операції.');
        text('editor-message',''); el('modal').style.display='flex'; sync();
    }
    window.loadInventoryAdmin = async () => {
        const version=++listGeneration; ++generation;
        const selected=el('job').value;
        text('message','Завантаження завдань…');
        try {
            const result=await request('/api/admin/inventory/jobs');
            if (version!==listGeneration) return;
            jobs=result.jobs || []; storageKey='warehouse-inventory-admin-pending-' + (result.user_id ?? 'admin'); recover();
            el('job').replaceChildren(new Option('Оберіть завдання',''));
            for (const job of jobs) {
                const option=new Option(`#${job.id} · ${job.name} · ${job.mode === 'presort' ? 'Pre-sort' : 'SORT'} · ${{active:'Активний',closed:'Закритий',paused:'Призупинений'}[job.status] || job.status}`,job.id);
                option.dataset.i18nProtected=JSON.stringify([job.name]);el('job').add(option);
            }
            const wanted=pending?.jobId || selected;
            el('job').value=jobs.some(job=>String(job.id)===String(wanted)) ? String(wanted) : String(jobs[0]?.id || '');
            await loadDetail();
            if (!jobs.length) text('message','Завдань ще немає.');
        } catch (failure) { if(version===listGeneration) { text('message',failure.message,true); detail=null; el('workspace').hidden=true; sync(); } }
    };
    window.openInventoryJob = async sortId => {
        if(busy || pending) return;
        await window.loadInventoryAdmin();
        if(busy || pending) return;
        if(!jobs.some(job=>String(job.id)===String(sortId))){text('message','Сорт недоступний.',true);return;}
        el('job').value=String(sortId);
        await loadDetail();
    };
    async function save(event) {
        event?.preventDefault(); if(busy || (!editor && !pending)) return;
        try {
            if (!pending) {
                const values=Object.fromEntries(editor.controls.map(control=>[control.dataset.field,control.value]));
                const payload=editor.payload(values);
                if(editor.method==='POST') payload.request_id=crypto.randomUUID();
                pending={path:editor.path,method:editor.method,payload,title:editor.title,kind:editor.kind,jobId:el('job').value}; persist();
            }
            busy=true; sync(); render(); text('editor-message','Збереження…');
            await request(pending.path,{method:pending.method,headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.payload)});
            pending=null; persist(); busy=false; closeEditor(); sync(); await window.loadInventoryAdmin();
            text('message','Зміни збережено. Історія рухів збережена.');
        } catch (failure) {
            if ([400,403,404,409,422].includes(failure.status)) { pending=null; persist(); }
            text('editor-message',failure.message + (pending ? ' Повторіть це збереження; нову операцію починати не потрібно.' : ''),true);
        } finally { busy=false; sync(); render(); }
    }
    el('editor-form').addEventListener('submit',save);
    el('editor-close').addEventListener('click',closeEditor); el('editor-cancel').addEventListener('click',closeEditor);
    el('job').addEventListener('change',()=>{if(!pending && !busy)loadDetail();});
    el('refresh').addEventListener('click',()=>{if(!pending && !busy)window.loadInventoryAdmin();});
    el('search').addEventListener('input',render);
    el('users').addEventListener('click',()=>{if(!pending && !busy)showAdminTab('create');});
    el('settings').addEventListener('click',()=>openEditor({kind:'settings',path:`/api/admin/inventory/jobs/${el('job').value}/settings`,method:'PUT',title:'Перевірка формату ICC',
        help:'Вимкнення стосується лише формату коду. Облік залишків, цілі кількості й права залишаються обов’язковими.',
        fields:[{name:'enabled',label:'Перевірка ICC',value:detail?.icc_validation_enabled ? 'true':'false',options:[{value:'true',label:'Увімкнена'},{value:'false',label:'Вимкнена'}]}],
        payload:values=>({icc_validation_enabled:values.enabled==='true'})}));
    el('close-job').addEventListener('click',()=>openEditor({kind:'close',path:`/api/sorts/${el('job').value}/status`,method:'PUT',title:'Закрити сорт',
        help:'Закриються завдання та його відкриті палети. Рухи й поточні залишки залишаться в історії.',fields:[],payload:()=>({status:'closed'})}));
    sync();
})();
