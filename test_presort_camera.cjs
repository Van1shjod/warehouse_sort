const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');

// Exercise camera/request lifecycle without requiring a physical webcam.
async function setup(recognize, prepare) {
    const nodes = new Map(), requests = [];
    class Element {
        constructor() { this.style = {}; this.value = ''; this.options = []; this.children = []; }
        addEventListener(name, fn) { this['on' + name] = fn; }
        replaceChildren(...children) { this.children = children; this.options = children; }
        append(child) { this.children.push(child); }
        add(option) { this.options.push(option); }
        focus() {}
        async play() {}
        getContext() { return {drawImage() {}}; }
        toBlob(callback) { callback(new Blob(['frame'])); }
    }
    const el = id => {
        if (!nodes.has(id)) nodes.set(id, new Element());
        return nodes.get(id);
    };
    el('camera-modal').style.display = 'none';
    el('type').options = ['single','mix','vevor'].map(value => ({value}));
    el('type').value = 'single';
    el('camera-video').videoWidth = 1920;
    el('camera-video').videoHeight = 1440;
    let stopped = 0;
    const stream = {
        getTracks: () => [{stop() { stopped++; }}],
        getVideoTracks: () => [{getCapabilities: () => ({torch: true}), applyConstraints: async () => {}}]
    };
    const navigator = {mediaDevices: {getUserMedia: async () => stream}};
    const response = data => ({ok: true, status: 200, json: async () => data});
    const context = {
        document: {getElementById: el, createElement: () => new Element(), addEventListener() {}},
        window: {location: {search: '?sort_id=7'}, addEventListener() {}}, navigator,
        sessionStorage: {getItem: () => null, setItem() {}, removeItem() {}},
        Option: class {constructor(text, value) {this.dataset = {}; this.text = text; this.value = value;}},
        crypto: {randomUUID}, URLSearchParams, AbortController, FormData, Blob,
        setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
        confirm: () => true,
        fetch: async (path, options) => {
            requests.push(path);
            if (path === '/api/presort/containers') return response([{id: 3, sort_id: 7, container_number: 'Rampa 1', unload_date: '2026-10-22', status: 'active'}]);
            if (path.startsWith('/api/presort/inventory')) return response({
                container: {status: 'active', type: 'single,mix', container_number: 'Rampa 1'},
                pallets: [{id: 8, number: 1, user_id: 1, cartons: 0}], items: [], user_id: 1
            });
            if (path === '/api/ocr/status') return response({ready: !prepare});
            if (path === '/api/ocr/prepare') return prepare();
            if (path === '/api/ocr/recognize') return recognize ? recognize(options) : response({cell: '4567', qtyPack: 30, prefix: 'JP', zone: 'A'});
            if (path === '/api/presort/scans') return response({id: 1});
            throw new Error('Unexpected request: ' + path);
        }
    };
    vm.runInNewContext(fs.readFileSync('static/ocr-ready.js', 'utf8'), context);
    vm.runInNewContext(fs.readFileSync('static/presort.js', 'utf8'), context);
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    return {el, requests, navigator, stream, stopped: () => stopped};
}

test('late camera permission does not leave the camera running after close', async () => {
    const app = await setup();
    let grant;
    app.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {grant = resolve;});
    const opening = app.el('camera-scan-btn').onclick();
    app.el('camera-close').onclick();
    grant(app.stream); await opening;
    assert.equal(app.stopped(), 1);
    assert.equal(app.el('camera-modal').style.display, 'none');
});

test('closing during recognition aborts it without adding a carton', async () => {
    let started;
    const ready = new Promise(resolve => {started = resolve;});
    const app = await setup(options => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Closed', 'AbortError')));
        started();
    }));
    await app.el('camera-scan-btn').onclick();
    const capture = app.el('camera-capture').onclick(); await ready;
    app.el('camera-close').onclick(); await capture;
    assert.equal(app.requests.filter(path => path === '/api/presort/scans').length, 0);
    assert.equal(app.stopped(), 1);
    assert.equal(app.el('scan-fields').disabled, false);
});

test('double capture adds once and the open camera can scan the next carton', async () => {
    const app = await setup();
    await app.el('camera-scan-btn').onclick();
    await Promise.all([app.el('camera-capture').onclick(), app.el('camera-capture').onclick()]);
    assert.equal(app.requests.filter(path => path === '/api/ocr/recognize').length, 1);
    assert.equal(app.requests.filter(path => path === '/api/presort/scans').length, 1);
    assert.equal(app.stopped(), 0);
    assert.equal(app.el('camera-modal').style.display, 'flex');
    assert.equal(app.el('camera-capture').disabled, false);
    await app.el('camera-capture').onclick();
    assert.equal(app.requests.filter(path => path === '/api/presort/scans').length, 2);
    assert.equal(app.stopped(), 0);
    app.el('camera-close').onclick();
    assert.equal(app.stopped(), 1);
    assert.equal(app.el('camera-modal').style.display, 'none');
});

test('camera can recognize while the model is preparing', async () => {
    let finish, recognize;
    const app = await setup(() => new Promise(resolve => {recognize = resolve;}),
        () => new Promise(resolve => {finish = resolve;}));
    await app.el('camera-scan-btn').onclick();
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.el('camera-capture').disabled, false);
    assert.equal(app.el('ocr-preparation').hidden, false);
    const capture = app.el('camera-capture').onclick();
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.requests.includes('/api/ocr/recognize'), true);
    assert.equal(app.el('camera-capture').disabled, true);
    finish({ok: true, json: async () => ({ready: true})});
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.el('camera-capture').disabled, true); // Still recognizing, no second capture.
    recognize({ok: true, json: async () => ({cell: '4567', qtyPack: 30, prefix: 'JP', zone: 'A'})});
    await capture;
    assert.equal(app.requests.filter(path => path === '/api/presort/scans').length, 1);
    assert.equal(app.el('camera-capture').disabled, false);
    assert.equal(app.el('ocr-preparation').hidden, true);
});
