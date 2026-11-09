const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const response = ready => ({ok: true, json: async () => ({ready})});
const deferred = () => { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve}; };
function setup(fetch) {
    const nodes = {'ocr-preparation': {hidden: true}, 'camera-capture': {disabled: false}};
    const context = {window: {}, document: {getElementById: id => nodes[id]}, fetch};
    vm.runInNewContext(fs.readFileSync('static/ocr-ready.js', 'utf8'), context);
    return {api: context.window.ocrReadiness, nodes};
}
test('cold model shows preparation without blocking capture', async () => {
    const gate = deferred(), paths = [];
    const {api, nodes} = setup(async path => {paths.push(path); return path.endsWith('status') ? response(false) : gate.promise;});
    const pending = api.prepare();
    assert.equal(nodes['ocr-preparation'].hidden, false);
    assert.equal(nodes['camera-capture'].disabled, false);
    assert.equal(api.ready, false);
    gate.resolve(response(true));
    assert.equal(await pending, true);
    assert.equal(api.ready, true);
    assert.equal(nodes['ocr-preparation'].hidden, true);
    assert.equal(nodes['camera-capture'].disabled, false);
    assert.deepEqual(paths, ['/api/ocr/status', '/api/ocr/prepare']);
});
test('warm model requires no prepare request', async () => {
    let count = 0;
    const {api} = setup(async () => {count++; return response(true);});
    await api.prepare();
    assert.equal(count, 1);
});
test('closed session cannot mark reopened camera ready', async () => {
    const old = deferred(), current = deferred(); let count = 0;
    const {api, nodes} = setup(() => (++count === 1 ? old.promise : current.promise));
    const previous = api.prepare(); api.cancel();
    const next = api.prepare(); old.resolve(response(true));
    assert.equal(await previous, false);
    assert.equal(api.ready, false);
    assert.equal(nodes['ocr-preparation'].hidden, false);
    current.resolve(response(true)); await next;
    assert.equal(api.ready, true);
});
test('failure preserves camera usability and reopening retries', async () => {
    let failed = true;
    const {api, nodes} = setup(async () => {if (failed) throw Error('offline'); return response(true);});
    await assert.rejects(api.prepare(), /Не вдалося підготувати/);
    assert.equal(api.ready, false);
    assert.equal(nodes['camera-capture'].disabled, false);
    assert.equal(nodes['ocr-preparation'].hidden, true);
    failed = false; await api.prepare(); assert.equal(api.ready, true);
});
