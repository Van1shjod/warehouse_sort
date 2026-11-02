const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function screen(fetch) {
    class Element {
        constructor() { this.value = ''; this.children = []; this.options = []; this.textContent = ''; this.dataset = {}; }
        replaceChildren(...items) { this.children = items; this.options = items; this.textContent = ''; }
        append(child) { this.children.push(child); }
        add(option) { this.options.push(option); }
    }
    const nodes = new Map();
    const el = key => {
        if (!nodes.has(key)) nodes.set(key, new Element());
        return nodes.get(key);
    };
    el('type').value = 'all'; el('status').value = 'valid'; el('view').value = 'scans';
    const context = {window: {}, fetch, URLSearchParams, clearTimeout, setTimeout,
        Option: class {constructor(text, value) {this.dataset = {}; this.text = text; this.value = String(value);}},
        document: {getElementById: id => el(id.replace('admin-presort-', '')), createElement: () => new Element()}};
    vm.runInNewContext(fs.readFileSync('static/admin-presort.js', 'utf8'), context);
    return {el, api: context.window};
}
const response = data => ({ok: true, status: 200, json: async () => data});
const jobs = [
    {id:1,name:'Rampa 1',mode:'presort',status:'active',unload_date:'2026-10-24',pallets_count:1,cartons_count:1,undone_count:0},
    {id:2,name:'Zona Mix A',mode:'sort',status:'closed',unload_date:'2026-10-23',pallets_count:1,cartons_count:0,undone_count:1}
];
const scan = {type:'single',code:'4567',location:'JP-A',pack:30,pallet_number:4,
    user_id:2,username:'worker',created_at:'2026-10-24 12:00:00',undone:0};

test('admin can select a converted SORT and see cancelled original scans', async () => {
    const paths = [];
    const app = screen(async path => {
        paths.push(path);
        if (path.endsWith('/jobs')) return response({jobs});
        return response({page:1,pages:1,total:1,scans:[path.includes('/2/') ? {...scan,undone:1} : scan]});
    });
    await app.api.loadAdminPresort();
    assert.equal(app.el('scans').children.length, 1);
    assert.match(app.el('job').options[2].text, /Переведено в SORT/);
    app.el('job').value = '2'; app.el('status').value = 'all';
    await app.el('job').onchange();
    const row = app.el('scans').children[0];
    assert.equal(row.className, 'cancelled');
    assert.equal(row.children[7].textContent, 'Скасовано');
    assert.match(app.el('summary').textContent, /Переведено в SORT/);
    assert.match(paths.at(-1), /\/jobs\/2\/scans\?.*scan_status=all/);
});

test('late scan response cannot overwrite the newly selected task', async () => {
    let finish;
    const app = screen(path => {
        if (path.endsWith('/jobs')) return Promise.resolve(response({jobs}));
        if (path.includes('/1/')) return new Promise(resolve => {finish = resolve;});
        return Promise.resolve(response({page:1,pages:1,total:0,scans:[]}));
    });
    const first = app.api.loadAdminPresort();
    for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
    app.el('job').value = '2';
    await app.el('job').onchange();
    finish(response({page:1,pages:1,total:1,scans:[scan]})); await first;
    assert.equal(app.el('scans').children.length, 0);
    assert.match(app.el('summary').textContent, /Zona Mix A/);
    assert.match(app.el('message').textContent, /записів немає/);
});

test('empty archive and denied access show clear messages', async () => {
    const empty = screen(async () => response({jobs:[]}));
    await empty.api.loadAdminPresort();
    assert.match(empty.el('message').textContent, /ще немає/);
    assert.equal(empty.el('next').disabled, true);
    const denied = screen(async () => ({ok:false,status:403}));
    await denied.api.loadAdminPresort();
    assert.match(denied.el('message').textContent, /лише адміністратору/);
});

test('product view shows progress and pallet breakdown while preserving history access', async () => {
    const paths = [];
    const app = screen(async path => {
        paths.push(path);
        if (path.endsWith('/jobs')) return response({jobs});
        if (path.includes('/products')) return response({page:1,pages:1,total:1,products:[{
            type:'single',code:'3245',location:'GZ-A',pack:40,planned:40,cartons:12,remaining:28,
            percent:30,excess:0,pallets_count:3,closed_pallets:1,last_added_at:'2026-10-24 12:00:00',
            pallets:[{number:1,cartons:5,closed:true},{number:4,cartons:4,closed:false},{number:10,cartons:3,closed:false}]
        }]});
        return response({page:1,pages:1,total:1,scans:[scan]});
    });
    app.el('view').value = 'products';
    await app.api.loadAdminPresort();
    const cells = app.el('scans').children[0].children;
    assert.equal(cells[0].textContent,'3245 GZ-A 40 PACK');
    assert.equal(cells[2].textContent,'12 із 40');
    assert.equal(cells[3].textContent,'28');
    assert.match(cells[5].textContent,/3 \(закрито: 1\)/);
    assert.match(cells[6].textContent,/№10 — 3 шт./);
    assert.equal(app.el('status-field').hidden,true);
    app.el('view').value = 'scans'; await app.el('view').onchange();
    assert.equal(app.el('status-field').hidden,false);
    assert.equal(app.el('scans').children[0].children[2].textContent,'4567');
    assert.ok(paths.some(path=>path.includes('/products?')));
});
