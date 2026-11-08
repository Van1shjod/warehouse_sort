(() => {
    'use strict';
    const el=id=>document.getElementById(id);
    let generation=0, detailGeneration=0;
    async function read(path) {
        const response=await fetch(path,{cache:'no-store'});
        const result=await response.json();
        if(!response.ok)throw Error(result.error || 'Не вдалося завантажити дані');
        return result;
    }
    const paragraph=text=>{const node=document.createElement('p');node.textContent=text;return node;};
    async function loadGroups() {
        const version=++generation; detailGeneration++;
        const target=el('id-pack-admin-groups');target.replaceChildren();
        if(!el('id-pack-admin-sort').value)return;
        el('id-pack-admin-status').textContent='Завантаження…';
        try {
            const groups=await read(`/api/admin/id-pack/groups?sort_id=${encodeURIComponent(el('id-pack-admin-sort').value)}&type=${el('id-pack-admin-type').value}`);
            if(version!==generation)return;
            el('id-pack-admin-status').textContent=groups.length ? `Груп: ${groups.length} · картонів: ${groups.reduce((sum,g)=>sum+g.quantity,0)}` : 'Збережених груп ID Pack ще немає';
            for(const group of groups) {
                const details=document.createElement('details');details.className='id-pack-group';
                const summary=document.createElement('summary');const prefix=document.createElement('code');prefix.textContent=group.prefix;
                const quantity=document.createElement('span');quantity.textContent=` · ${group.quantity} картонів`;
                summary.append(prefix,quantity);
                const contents=document.createElement('div');
                if(group.expected_qty!==null)contents.append(paragraph(`Очікується: ${group.expected_qty}`));
                const status=paragraph('');contents.append(status);
                details.append(summary,contents);target.append(details);
                let loaded=false,loading=false;
                details.addEventListener('toggle',async()=>{
                    if(!details.open || loaded || loading)return;
                    loading=true;const detailVersion=detailGeneration;
                    status.textContent='Завантаження…';
                    try {
                        const result=await read('/api/admin/id-pack/groups/'+group.id);
                        if(version!==generation || detailVersion!==detailGeneration)return;
                        status.textContent='';
                        const list=document.createElement('ol');list.className='id-pack-full-ids';
                        for(const code of result.scans){const li=document.createElement('li');li.textContent=code;li.setAttribute('data-no-translate','');list.append(li);}
                        if(result.scans.length)contents.append(list);
                        if(result.manual_quantity)contents.append(paragraph(`Додано вручну без ID: ${result.manual_quantity}`));
                        loaded=true;
                    } catch(error){status.textContent=error.message;}
                    finally{loading=false;}
                });
            }
        }catch(error){if(version===generation)el('id-pack-admin-status').textContent=error.message;}
    }
    window.loadAdminIdPack=async()=>{
        const version=++generation;
        detailGeneration++;
        el('id-pack-admin-groups').replaceChildren();
        el('id-pack-admin-status').textContent='Завантаження…';
        try {
            const rows=await read('/api/sorts/all');
            if(version!==generation)return;
            const select=el('id-pack-admin-sort'),previous=select.value;
            select.replaceChildren();
            for(const row of rows.filter(s=>s.mode==='sort' && s.status!=='deleted')) {
                const option=document.createElement('option');option.value=row.id;option.textContent=`${row.name} · ${row.unload_date || ''}`;select.append(option);
            }
            if([...select.options].some(o=>o.value===previous))select.value=previous;
            if(!select.options.length){el('id-pack-admin-groups').replaceChildren();el('id-pack-admin-status').textContent='Сортів ще немає';return;}
            await loadGroups();
        } catch(error){if(version===generation)el('id-pack-admin-status').textContent=error.message;}
    };
    el('id-pack-admin-sort').onchange=loadGroups;
    el('id-pack-admin-type').onchange=loadGroups;
    el('id-pack-admin-refresh').onclick=window.loadAdminIdPack;
})();
