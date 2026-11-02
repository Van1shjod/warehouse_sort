const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function screen(fetcher) {
    const nodes = new Map(), calls = [];
    class Element {
        constructor(id='') {
            this.id=id; this.style={}; this.children=[]; this.dataset={}; this.attributes={};
            this.value=''; this.className=''; this.handlers={}; this._html=''; this._text='';
            this.classList={
                contains:name=>this.className.split(/\s+/).includes(name),
                add:name=>{if (!this.classList.contains(name)) this.className+=' '+name;},
                remove:name=>{this.className=this.className.split(/\s+/).filter(v=>v!==name).join(' ');},
                toggle:(name,on)=>on?this.classList.add(name):this.classList.remove(name)
            };
        }
        set innerHTML(value) {this._html=value;this.children=[];this._text='';}
        get innerHTML() {return this._html;}
        set textContent(value) {this._text=value;this.children=[];this._html='';}
        get textContent() {return this._text;}
        append(...children) {this.children.push(...children);}
        appendChild(child) {this.children.push(child);}
        replaceChildren(...children) {this.children=children;this._html='';this._text='';}
        setAttribute(name,value) {this.attributes[name]=value;}
        getAttribute(name) {return this.attributes[name];}
        addEventListener(type,handler) {this.handlers[type]=handler;}
    }
    const el=id=>{if(!nodes.has(id)) nodes.set(id,new Element(id));return nodes.get(id);};
    function select(selector) {
        return [...nodes.values()].filter(node=>selector.split(',').some(part=>{
            const p=part.trim();return p[0]==='.'?node.classList.contains(p.slice(1)):p[0]==='#'&&node.id===p.slice(1);
        }));
    }
    for (const tab of ['sort','users']) {el('admin-'+tab).className='admin-tab-content';el('admin-'+tab).style.display=tab==='sort'?'block':'none';}
    for (const tab of ['sorting','completed','pallets','create-sort']) {
        el('admin-'+tab).className='sort-subtab-content';el('admin-'+tab).style.display=tab==='sorting'?'block':'none';
    }
    for (const filter of ['all','open','closed','single','mix','vevor']) {
        const button=el('filter-'+filter);button.className='pallet-filter-btn';button.setAttribute('onclick',`filterPallets('${filter}')`);
    }
    el('admin-task-status').value='all';
    const context={document:{getElementById:el,createElement:()=>new Element(),querySelectorAll:select,addEventListener(){},body:new Element()},
        window:{addEventListener(){}},console:{log(){},error(){}},setTimeout:(fn,ms)=>setTimeout(fn,ms).unref(),
        confirm:()=>false,alert(){},fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options);}};
    const instance=vm.createContext(context);
    vm.runInContext(fs.readFileSync('static/admin.js','utf8'),instance);
    const text=node=>node.textContent+' '+node.innerHTML+' '+node.children.map(text).join(' ');
    return {el,context,calls,text};
}
const response=data=>({ok:true,status:200,json:async()=>data});
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};

test('deleting a sort requires Yes; No and back leave it unchanged',async()=>{
    const app=screen(async()=>response([]));await settle();app.calls.length=0;
    const dialog=app.context.deleteSortConfirm(4,'<img src=x>');
    assert.equal(app.el('confirm-modal').style.display,'flex');
    assert.match(app.el('confirm-message').textContent,/Ви точно хочете видалити цей сорт/);
    assert.match(app.el('confirm-message').textContent,/<img src=x>/);
    assert.equal(app.el('confirm-message').innerHTML,'');
    assert.equal(app.calls.filter(call=>call.options?.method==='DELETE').length,0);
    app.context.closeConfirmModal();await dialog;
    assert.equal(app.calls.filter(call=>call.options?.method==='DELETE').length,0);
});

test('double clicking a delete confirmation sends one confirmed DELETE and refreshes tasks',async()=>{
    const app=screen(async(url,options)=>response(options?.method==='DELETE'?{message:'Сорт видалено'}:[]));
    await settle();app.calls.length=0;
    const first=app.context.deleteSortConfirm(4,'Rampa 4');
    const second=app.context.deleteSortConfirm(4,'Rampa 4');
    app.context.confirmAction();app.context.confirmAction();
    await Promise.all([first,second]);
    const deletes=app.calls.filter(call=>call.options?.method==='DELETE');
    assert.equal(deletes.length,1);assert.equal(deletes[0].url,'/api/sorts/4?confirm=true');
    assert.ok(app.calls.some(call=>call.url==='/api/sorts/all'));
});

test('all sorting subtabs load their data and returning from another tab keeps the selected subtab',async()=>{
    const app=screen(async()=>response([]));await settle();app.calls.length=0;
    app.context.showSortSubtab('completed');await settle();
    assert.equal(app.el('admin-completed').style.display,'block');
    assert.ok(app.calls.some(call=>call.url==='/api/admin/icc_codes'));
    app.context.showSortSubtab('pallets');await settle();
    assert.ok(app.calls.some(call=>call.url==='/api/lider/pallets'));
    app.context.showSortSubtab('create-sort');await settle();
    assert.ok(app.calls.some(call=>call.url==='/api/sorts/all'));
    app.context.showAdminTab('users');await settle();app.calls.length=0;
    app.context.showAdminTab('sort');await settle();
    assert.equal(app.el('admin-create-sort').style.display,'block');
    assert.ok(app.calls.some(call=>call.url==='/api/sorts/all'));
});

test('SORT pallet filters show correct counts, identity and deleted workers',async()=>{
    const data=[
        {pallet:{pallet_number:'1',type:'single',is_closed:0,cartons_count:3,created_at:'2026-10-25 10:00:00'},icc:{last_4_digits:'3245',location_code:'GZ-A',total_cartons:40},user:{username:'worker'}},
        {pallet:{pallet_number:'2',type:'mix',is_closed:'1',cartons_count:2,created_at:'2026-10-25 10:00:00'},icc:{last_4_digits:'D980989',total_cartons:0},user:null}
    ];
    const app=screen(async path=>response(path==='/api/lider/pallets'?data:[]));await settle();
    await app.context.loadPallets();
    assert.match(app.el('pallets-summary').textContent,/Палет SORT: 2 · Відкрито: 1 · Закрито: 1 · Картонів: 5/);
    app.context.filterPallets('open');
    assert.equal(app.el('pallets-table-body').children.length,1);
    assert.match(app.text(app.el('pallets-table-body')),/3245 · GZ-A · 40 PACK/);
    app.context.filterPallets('closed');
    assert.match(app.text(app.el('pallets-table-body')),/Користувач видалений/);
    app.context.filterPallets('vevor');
    assert.match(app.text(app.el('pallets-table-body')),/Немає палет за вибраним фільтром/);
});

test('loading errors replace spinners with an actionable message',async()=>{
    const app=screen(async()=>({ok:false,status:403}));await settle();
    await app.context.loadCompletedData();await app.context.loadPallets();
    assert.match(app.text(app.el('completed-table-body')),/права адміністратора/);
    assert.match(app.text(app.el('pallets-table-body')),/права адміністратора/);
});

test('task list includes closed SORTs and renders task names as text',async()=>{
    const tasks=[{id:1,name:'<img onerror=alert(1)>',mode:'presort',status:'active'},
        {id:2,name:'Завершений',mode:'sort',status:'closed',has_presort_source:true}];
    const app=screen(async path=>response(path==='/api/sorts/all'?tasks:[]));await settle();
    let opened=null;app.context.openAdminPresortJob=id=>{opened=id;};
    await app.context.loadActiveSorts();
    const list=app.el('active-sorts-list');assert.equal(list.children.length,2);
    assert.equal(list.children[0].children[0].textContent,'#1 · PRE-SORT · <img onerror=alert(1)>');
    assert.equal(list.children[0].children[0].innerHTML,'');
    app.el('admin-task-status').value='closed';await app.context.loadActiveSorts();
    assert.equal(list.children.length,1);
    const actions=list.children[0].children.at(-1).children;
    actions.find(node=>node.textContent==='Картони Pre-sort').onclick();assert.equal(opened,2);
});

test('a slow task request cannot replace a newer filter result',async()=>{
    let finish,taskRequests=0;
    const app=screen(path=>{
        if(path!=='/api/sorts/all')return Promise.resolve(response([]));
        taskRequests++;
        return taskRequests===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve(response([{id:2,name:'Новий',mode:'sort',status:'closed'}]));
    });await settle();
    const first=app.context.loadActiveSorts();await app.context.loadActiveSorts();
    finish(response([{id:1,name:'Старий',mode:'sort',status:'active'}]));await first;
    assert.match(app.text(app.el('active-sorts-list')),/Новий/);assert.doesNotMatch(app.text(app.el('active-sorts-list')),/Старий/);
});

test('double clicking create produces only one POST',async()=>{
    let finish,posts=0;
    const app=screen((path,options)=>{
        if(path==='/api/sorts'&&options?.method==='POST'){posts++;return new Promise(resolve=>{finish=resolve;});}
        return Promise.resolve(response([]));
    });await settle();
    app.el('sort-mode').value='sort';app.el('sort-location').value='Rampa 1';app.el('type-single').checked=true;
    const first=app.context.createNewSort();await app.context.createNewSort();assert.equal(posts,1);
    assert.equal(app.el('create-sort-submit').disabled,true);
    finish(response({sort_id:3}));await first;assert.equal(app.el('create-sort-submit').disabled,false);
});
