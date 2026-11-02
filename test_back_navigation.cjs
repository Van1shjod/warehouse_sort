const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Test state transitions and camera cleanup without writing to a warehouse database.
function screen(path = '/dashboard', previous = []) {
    const nodes = [], storage = new Map([['warehouse-page-back', JSON.stringify(previous)]]), visited = [];
    class Element {
        constructor(tag) {
            this.tagName = tag; this.style = {}; this.hidden = false; this.disabled = false;
            this.value = ''; this.className = ''; this.children = []; this.handlers = {}; this.attributes = {};
            this.classList = {
                contains: name => this.className.split(/\s+/).includes(name),
                add: name => { if (!this.classList.contains(name)) this.className += ' ' + name; },
                remove: name => { this.className = this.className.split(/\s+/).filter(c => c !== name).join(' '); },
                toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name)
            };
            nodes.push(this);
        }
        setAttribute(name, value) { this.attributes[name] = value; }
        addEventListener(name, fn) { this.handlers[name] = fn; }
        dispatchEvent(event) { return this.handlers[event.type]?.(event); }
        click() { if (!this.disabled) return this.onclick ? this.onclick() : this.handlers.click?.(); }
        append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
        focus() {}
    }
    const body = new Element('body');
    const document = {
        body, createElement: tag => new Element(tag), addEventListener() {},
        getElementById: id => nodes.find(node => node.id === id) || null,
        querySelectorAll: selector => nodes.filter(node => selector.split(',').some(part => {
            const value = part.trim();
            return value.startsWith('#') ? node.id === value.slice(1) : value.startsWith('.') && node.classList.contains(value.slice(1));
        }))
    };
    const url = new URL(path, 'https://warehouse.test');
    const context = {document, URL, Event, location: {
        href:url.href, origin:url.origin, pathname:url.pathname, search:url.search, assign: target => visited.push(target)
    }, sessionStorage: {getItem:key => storage.get(key) || null, setItem:(key,value) => storage.set(key,value)},
    getComputedStyle: node => ({display:node.style.display || (node.classList.contains('modal') ? 'none' : 'block'),zIndex:node.style.zIndex || '0'}),
    MutationObserver: class {observe() {}}, console: {log() {},error() {}},
    setTimeout:(fn,ms) => setTimeout(fn,ms).unref(), clearTimeout};
    context.window = context;
    const instance = vm.createContext(context);
    function element(id, classes = '', display = 'none') {
        const node = new Element('div'); node.id = id; node.className = classes; node.style.display = display; body.append(node); return node;
    }
    const run = () => vm.runInContext(fs.readFileSync('static/back-navigation.js','utf8'), instance);
    const arrow = () => nodes.find(node => node.classList.contains('site-back-button'));
    return {context, instance, element, run, visited, arrow, back:() => arrow().handlers.click(), document};
}

test('SORT goes from pallet to quantity, input, type, sort selection and home', async () => {
    const app = screen();
    const work = app.element('work-area','','block');
    const location = app.element('location-modal','modal','flex');
    const quantity = app.element('confirmation-modal','modal');
    const types = app.element('sort-menu','modal');
    const sorts = app.element('sort-selection');
    const input = app.element('icc-code-input'); input.value = '4567';
    Object.assign(app.context, {
        backToQuantity() {location.style.display='none'; quantity.style.display='flex';},
        showSortMenu() {types.style.display='flex';}, closeSortMenu() {types.style.display='none';},
        showSortSelection() {sorts.style.display='block';}, cancelSortSelection() {sorts.style.display='none';}
    });
    app.run(); await app.back();
    assert.equal(quantity.style.display,'flex');
    await app.back(); assert.equal(quantity.style.display,'none'); assert.equal(input.value,'4567');
    await app.back(); assert.equal(work.style.display,'none'); assert.equal(types.style.display,'flex');
    await app.back(); assert.equal(sorts.style.display,'block');
    await app.back(); assert.equal(sorts.style.display,'none'); assert.equal(app.arrow().disabled,true);
    assert.equal(app.visited.length,0);
});

test('Pre-sort camera uses its close control and cannot leave during a save', async () => {
    const app = screen('/presort');
    const modal = app.element('camera-modal','modal','flex');
    const close = app.element('camera-close'); close.disabled=true;
    const select = app.element('container'); select.value='3';
    let stopped=0, changed=0;
    close.onclick = () => {stopped++; modal.style.display='none';};
    select.addEventListener('change', () => changed++);
    app.run(); await app.back(); assert.equal(stopped,0); assert.equal(app.visited.length,0);
    close.disabled=false; await app.back(); assert.equal(stopped,1); assert.equal(select.value,'3');
    select.disabled=true; await app.back(); assert.equal(select.value,'3');
    select.disabled=false; await app.back(); assert.equal(select.value,''); assert.equal(changed,1);
    await app.back(); assert.equal(app.visited[0],'/dashboard');
});

test('admin back restores previous tabs and preserves form values', async () => {
    const app = screen('/admin',['/dashboard']);
    const sort=app.element('admin-sort','admin-tab-content','block');
    const users=app.element('admin-users','admin-tab-content');
    const list=app.element('admin-sorting','sort-subtab-content','block');
    const create=app.element('admin-create-sort','sort-subtab-content');
    const notes=app.element('sort-notes'); notes.value='Залишити примітку';
    app.context.showAdminTab = tab => {sort.style.display=tab==='sort'?'block':'none'; users.style.display=tab==='users'?'block':'none';};
    app.context.showSortSubtab = tab => {list.style.display=tab==='sorting'?'block':'none'; create.style.display=tab==='create-sort'?'block':'none';};
    app.run(); app.context.showAdminTab('users'); app.context.showAdminTab('sort'); app.context.showSortSubtab('create-sort');
    await app.back(); assert.equal(list.style.display,'block'); assert.equal(create.style.display,'none');
    await app.back(); assert.equal(users.style.display,'block');
    await app.back(); assert.equal(sort.style.display,'block'); assert.equal(notes.value,'Залишити примітку');
    await app.back(); assert.equal(app.visited[0],'/dashboard');
});

test('route back ignores external pages and logout; registration returns to login', async () => {
    const app=screen('/admin',['https://evil.example','/logout','/dashboard']); app.run();
    await app.back(); assert.deepEqual(app.visited,['/dashboard']);
    const login=screen('/'); const form=login.element('login-form','','block'), register=login.element('register-form');
    login.context.showTab = tab => {form.style.display=tab==='login'?'block':'none'; register.style.display=tab==='register'?'block':'none';};
    login.run(); assert.equal(login.arrow().disabled,true);
    login.context.showTab('register'); await login.back(); assert.equal(form.style.display,'block');
    assert.equal(login.visited.length,0);
});

test('nested tab selection produces one back step without a phantom screen', async () => {
    const app=screen('/admin',['/dashboard']);
    const sort=app.element('admin-sort','admin-tab-content','none');
    const users=app.element('admin-users','admin-tab-content','block');
    const sorting=app.element('admin-sorting','sort-subtab-content','none');
    app.context.showSortSubtab=()=>{sorting.style.display='block';};
    app.context.showAdminTab=()=>{sort.style.display='block';users.style.display='none';app.context.showSortSubtab();};
    app.run(); app.context.showAdminTab();
    await app.back();
    assert.equal(users.style.display,'block'); assert.equal(sort.style.display,'none');
    await app.back(); assert.equal(app.visited[0],'/dashboard');
});

test('saving a carton prevents navigating away or a duplicate submit', async () => {
    const app=screen(); const modal=app.element('location-modal','modal','flex');
    let finish, saves=0;
    app.context.confirmAndSubmit=() => {saves++; return new Promise(resolve=>{finish=resolve;});};
    app.context.backToQuantity=() => {modal.style.display='none';};
    app.run(); const save=app.context.confirmAndSubmit();
    assert.equal(app.arrow().disabled,true); await app.back(); assert.equal(modal.style.display,'flex');
    await app.context.confirmAndSubmit(); assert.equal(saves,1);
    finish(); await save; assert.equal(app.arrow().disabled,false);
    await app.back(); assert.equal(modal.style.display,'none');
});

test('SORT closes and releases a camera even if permission arrives after back', async () => {
    for (const type of ['single','mix']) {
        const app=screen(); const modal=app.element('camera-modal','modal');
        ['camera-video','scan-status','scan-result','flash-toggle-btn'].forEach(id=>app.element(id));
        app.document.getElementById('camera-video').play=async()=>{};
        let grant, stopped=0;
        app.context.navigator={mediaDevices:{getUserMedia:()=>new Promise(resolve=>{grant=resolve;})}};
        app.context.fetch=async()=>({json:async()=>({})});
        vm.runInContext(fs.readFileSync('static/dashboard.js','utf8'),app.instance);
        vm.runInContext(`currentType='${type}'`,app.instance);
        app.run();
        const opening=type==='single'?app.context.openCameraScanner():app.context.openCameraScannerMix();
        await app.back();
        grant({getTracks:()=>[{stop(){stopped++;}}]}); await opening;
        assert.equal(stopped,1); assert.equal(modal.style.display,'none');
    }
});
