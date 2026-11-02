const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function screen(fetch) {
    class Element {
        constructor() { this.value = ''; this.textContent = ''; this.children = []; this.style = {}; }
        replaceChildren() { this.children = []; this.textContent = ''; }
        append(child) { this.children.push(child); }
        addEventListener() {}
    }
    const elements = new Map();
    const el = id => {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
    };
    const context = {window: {}, currentType: 'single', fetch,
        document: {getElementById: el, createElement: () => new Element()}};
    vm.runInNewContext(fs.readFileSync('static/sort-presort.js', 'utf8'), context);
    const text = element => element.textContent + element.children.map(text).join(' ');
    return {el, context, api: context.window, text: () => text(el('presort-source-results'))};
}
const response = (items, has_source = items.length > 0) => ({ok: true, json: async () => ({items,has_source})});

test('source lookup distinguishes location, PACK and type and clears on another sort', async () => {
    const data = [
        {type:'single',code:'4567',location:'JP-A',pack:30,number:1,cartons:5},
        {type:'single',code:'4567',location:'JP-A',pack:40,number:4,cartons:8},
        {type:'single',code:'4567',location:'JP-B',pack:30,number:10,cartons:3},
        {type:'mix',code:'D980989',location:'',pack:0,number:16,cartons:2}
    ];
    const app = screen(async path => response(path.includes('/1/') ? data : []));
    await app.api.loadPresortSource({id:1,mode:'sort'});
    app.el('icc-code-input').value = '4567';
    app.el('location-code-input').value = 'JP-A';
    app.el('cartons-count-input').value = '30';
    app.api.refreshPresortMatches();
    assert.match(app.text(), /Палета №1 — 5/);
    assert.doesNotMatch(app.text(), /Палета №4|Палета №10/);
    app.context.currentType = 'mix';
    app.el('mix-icc-code-input').value = 'D980989';
    app.api.refreshPresortMatches();
    assert.match(app.text(), /Палета №16 — 2/);
    await app.api.loadPresortSource({id:2,mode:'sort'});
    assert.equal(app.el('presort-source-area').hidden, false);
    assert.match(app.text(), /не має джерела Pre-sort/);
});

test('a slow response for the previous sort cannot replace the selected inventory', async () => {
    let finishFirst;
    const app = screen(path => path.includes('/1/')
        ? new Promise(resolve => {finishFirst = resolve;})
        : Promise.resolve(response([])));
    const first = app.api.loadPresortSource({id:1,mode:'sort'});
    await app.api.loadPresortSource({id:2,mode:'sort'});
    finishFirst(response([{type:'single',code:'4567',location:'JP-A',pack:30,number:1,cartons:5}]));
    await first;
    assert.equal(app.el('presort-source-area').hidden, false);
    assert.match(app.text(), /не має джерела Pre-sort/);
});

test('empty linked source is explained instead of disappearing', async () => {
    const app = screen(async () => response([],true));
    await app.api.loadPresortSource({id:1,mode:'sort'});
    assert.equal(app.el('presort-source-area').hidden,false);
    assert.match(app.text(),/немає збережених картонів/);
});

test('source locations remain in both confirmation steps and after input reset', async () => {
    const items=[{type:'vevor',code:'4567',location:'JP-A',pack:30,number:4,cartons:8}];
    const app=screen(async()=>response(items,true));
    await app.api.loadPresortSource({id:1,mode:'sort'});
    const data={iccCode:'4567',locationCode:'JP-A',totalCartons:30};
    const text=node=>node.textContent+node.children.map(text).join(' ');
    app.api.showPresortStepMatches(data,'vevor');
    assert.equal(app.el('presort-confirm-source').hidden,false);
    assert.match(text(app.el('presort-confirm-results')),/Палета №4 — 8/);
    assert.match(text(app.el('presort-location-results')),/Палета №4 — 8/);
    app.api.rememberPresortMatch(data,'vevor');
    app.el('icc-code-input').value=''; app.api.refreshPresortMatches();
    assert.equal(app.el('presort-last-source').hidden,false);
    assert.match(text(app.el('presort-last-results')),/Палета №4 — 8/);
    await app.api.loadPresortSource(null);
    assert.equal(app.el('presort-last-source').hidden,true);
});

test('source load errors remain visible when a user edits a field', async () => {
    const app=screen(async()=>({ok:false,status:500}));
    await app.api.loadPresortSource({id:1,mode:'sort'});
    app.el('icc-code-input').value='4567'; app.api.refreshPresortMatches();
    assert.match(app.text(),/Не вдалося завантажити/);
});
