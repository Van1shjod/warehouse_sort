import {chromium} from 'file:///C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const server=spawn('python',[fileURLToPath(new URL('./server.py',import.meta.url))],{env:{...process.env,COLLECTION_TEST_PORT:'5083'},windowsHide:true,stdio:['ignore','ignore','pipe']});
let serverErrors='';server.stderr.on('data',chunk=>{serverErrors+=chunk.toString();});
for(let i=0;i<100;i++){
    try {await fetch('http://127.0.0.1:5083/');break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}
    if(i===99){server.kill();throw new Error(serverErrors || 'Test server did not start');}
}
const browser=await chromium.launch({channel:'msedge',headless:true});
const viewport={width:Number(process.env.REVIEW_WIDTH || 390),height:Number(process.env.REVIEW_HEIGHT || 844)};
const page=await browser.newPage({viewport});
await page.addInitScript(()=>{if(!localStorage.getItem('warehouse-language'))localStorage.setItem('warehouse-language','en');});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let pickRequests=0;
let sortChecks=0,sortWrites=0;
page.on('request',request=>{
    if(request.method()!=='POST')return;
    if(request.url().endsWith('/api/collection/pick'))pickRequests++;
    if(request.url().endsWith('/api/sort/check'))sortChecks++;
    if(request.url().endsWith('/api/sort/submit'))sortWrites++;
});
page.on('dialog',dialog=>dialog.accept());
try {
    await page.goto('http://127.0.0.1:5083/_test/enter');
    await page.evaluate(()=>selectSort(1));
    await page.locator('#sort-type-vevor-btn').click();
    await page.locator('#vevor-development-title').waitFor({state:'visible'});
    await page.locator('#vevor-development button').click();
    await page.locator('#sort-type-single-btn').click();
    await page.screenshot({path:'artifacts/collection-review/i18n-mode-mobile.png',animations:'disabled'});
    await page.getByRole('button',{name:'One product',exact:true}).click();
    async function single(code='4567') {
        await page.locator('#icc-code-input').fill(code);
        await page.locator('#cartons-count-input').fill('3');
        await page.locator('#location-code-input').fill('JP-A');
        await page.locator('#location-code-input').press('Enter');
    }
    async function scan(data,doubleCapture=false) {
        await page.unroute('**/api/ocr/recognize');
        await page.route('**/api/ocr/recognize',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)}));
        await page.evaluate(async()=>{
            navigator.mediaDevices.getUserMedia=async()=>{
                const frame=document.createElement('canvas');frame.width=320;frame.height=240;
                const stream=frame.captureStream(10);
                frame.getContext('2d').fillRect(0,0,320,240);
                return stream;
            };
            await (currentType==='mix' ? openCameraScannerMix() : openCameraScanner());
        });
        await page.waitForFunction(()=>document.getElementById('camera-video').videoWidth>0);
        await page.evaluate(double=>double ? Promise.all([capturePhoto(),capturePhoto()]) : capturePhoto(),doubleCapture);
    }
    await scan({cell:'4567',qtyPack:3,prefix:'JP',zone:'A'},true);
    await page.locator('#collection-location').waitFor({state:'visible'});
    assert.equal(pickRequests,0,'Initial scan must automatically find pallets without collecting stock');
    assert.equal(await page.locator('#collection-destination').count(),0);
    await page.locator('#collection-order').selectOption('desc');
    await page.waitForFunction(()=>document.getElementById('collection-source-title').textContent==='4');
    await page.locator('#collection-order').selectOption('asc');
    await page.waitForFunction(()=>document.getElementById('collection-source-title').textContent==='1');
    await page.screenshot({path:'artifacts/collection-review/i18n-location-mobile.png',animations:'disabled'});
    await page.locator('#collection-source-number').fill('4');
    await page.locator('#collection-source-number').press('Enter');
    assert.match(await page.locator('#collection-message').innerText(),/does not match/);
    await page.locator('#collection-source-number').fill('1');
    await page.locator('#collection-source-number').press('Enter');
    assert.equal(await page.locator('#icc-code-input').inputValue(),'');
    assert.match(await page.locator('#collection-hint').innerText(),/4567/);
    const beforeScans=pickRequests;
    await scan({cell:'4567'});
    assert.match(await page.locator('#scan-status').innerText(),/Not recognized/);
    assert.equal(pickRequests,beforeScans);
    await page.evaluate(()=>closeCameraScanner());
    await scan({cell:'9999',qtyPack:3,prefix:'JP',zone:'A'});
    assert.equal(pickRequests,beforeScans);
    assert.match(await page.locator('#collection-message').innerText(),/different carton/);
    // Switching language must preserve the unfinished label and source confirmation.
    await page.locator('.language-select').selectOption('pl');
    assert.equal(await page.locator('#icc-code-input').inputValue(),'9999');
    await page.locator('.language-select').selectOption('ru');
    assert.equal(await page.locator('#icc-code-input').inputValue(),'9999');
    await page.locator('.language-select').selectOption('uk');
    assert.equal(await page.locator('#icc-code-input').inputValue(),'9999');
    await page.locator('.language-select').selectOption('en');
    await single('9999');
    await page.waitForFunction(()=>document.getElementById('collection-message').textContent.includes('different carton'));
    // The server commits, but the response is lost: reload and replay must not
    // count the same physical carton twice.
    await page.route('**/api/collection/pick',async route=>{await route.fetch();await route.abort();});
    await scan({cell:'4567',qtyPack:3,prefix:'JP',zone:'A'},true);
    assert.equal(pickRequests,beforeScans+1,'Double capture must send exactly one collection operation');
    await page.locator('#collection-retry').waitFor({state:'visible'});
    await page.unroute('**/api/collection/pick');
    await page.reload();
    await page.locator('#collection-resume-button').click();
    await page.waitForFunction(()=>document.getElementById('collection-hint').textContent.includes('pallet: 1'));
    await page.locator('#collection-order').selectOption('desc');
    assert.match(await page.locator('#collection-confirm-title').innerText(),/№ 1/);
    await page.screenshot({path:'artifacts/collection-review/i18n-single-mobile.png',animations:'disabled'});
    await single();
    await page.locator('#collection-location').waitFor({state:'visible'});
    assert.equal(await page.locator('#collection-source-title').innerText(),'4');
    await page.screenshot({path:'artifacts/collection-review/i18n-pallet-complete-mobile.png',animations:'disabled'});
    await page.locator('#collection-source-number').fill('4');await page.locator('#collection-source-number').press('Enter');
    await single();
    await page.waitForFunction(()=>document.getElementById('collection-message').textContent.includes('all available'));
    assert.equal(await page.locator('#icc-code-input').inputValue(),'');
    await page.locator('#collection-tools summary').click();
    await page.locator('#collection-undo').click();
    await page.locator('#collection-location').waitFor({state:'visible'});
    assert.equal(await page.locator('#collection-source-title').innerText(),'4');
    await page.reload();
    await page.locator('#collection-resume-button').click();
    await page.locator('#collection-location').waitFor({state:'visible'});
    await page.locator('#collection-tools summary').click();
    await page.locator('#collection-exit').click();
    await page.locator('#collection-mode button').filter({hasText:'Back to type selection'}).click();
    await page.locator('#sort-type-mix-btn').click();
    await page.getByRole('button',{name:'One product',exact:true}).click();
    await scan({cell:'D980989'},true);
    await page.locator('#collection-location').waitFor({state:'visible'});
    await page.locator('#collection-source-number').fill('10');await page.locator('#collection-source-number').press('Enter');
    await page.screenshot({path:'artifacts/collection-review/i18n-mix-mobile.png',animations:'disabled'});
    const beforeMix=pickRequests;
    await scan({cell:'D980989'},true);
    assert.equal(pickRequests,beforeMix+1,'Mix scan must confirm once without Enter');
    await page.waitForFunction(()=>document.getElementById('collection-message').textContent.includes('all available'));
    // Random SORT: OCR submits the label immediately, then waits for the
    // quantity and destination that cannot be read from the label.
    for(const kind of ['single','mix']){
        await page.evaluate(()=>closeWorkArea());
        await page.evaluate(type=>selectType(type),kind);
        await page.getByRole('button',{name:'Different products',exact:true}).click();
        const checksBefore=sortChecks,writesBefore=sortWrites;
        const data=kind==='single' ? {cell:'4567',qtyPack:3,prefix:'JP',zone:'A'} : {cell:'D980989'};
        await scan(data,true);
        await page.locator('#confirmation-modal').waitFor({state:'visible'});
        assert.equal(sortChecks,checksBefore+1,kind+' must auto-check the label exactly once');
        assert.equal(sortWrites,writesBefore,kind+' must wait for quantity and destination');
        await page.locator('#current-quantity-input').fill('1');
        await page.locator('#current-quantity-input').press('Enter');
        await page.locator('#pallet-location-input').fill('RANDOM-'+kind.toUpperCase());
        const savedResponse=page.waitForResponse(response=>response.url().endsWith('/api/sort/submit'),{timeout:10000});
        await page.locator('#pallet-location-input').press('Enter');
        let saved;
        try{saved=await savedResponse;}catch(error){console.log(kind,await page.locator('#toast-message').textContent(),errors);throw error;}
        assert.equal(saved.status(),201,JSON.stringify(await saved.json()));
        await page.locator('#location-modal').waitFor({state:'hidden'});
        assert.equal(sortWrites,writesBefore+1);
    }
    await page.goto('http://127.0.0.1:5083/admin');
    await page.getByRole('button',{name:'Movements and balances',exact:true}).click();
    await page.locator('#inventory-admin-job').selectOption('1');
    await page.locator('#inventory-admin-workspace').waitFor({state:'visible'});
    assert.match(await page.locator('#inventory-admin-packs').innerText(),/4567/);
    assert.match(await page.locator('#inventory-admin-pallets').innerText(),/Held by admin/);
    await page.evaluate(()=>{showAdminTab('sort');showSortSubtab('create-sort');});
    const task=page.locator('.admin-task-card').filter({has:page.locator('h4').filter({hasText:'#1 · SORT · Rampa 1'})});
    await task.getByRole('button',{name:'Delete job',exact:true}).click();
    await page.locator('#confirm-modal').waitFor({state:'visible'});
    assert.match(await page.locator('#confirm-message').innerText(),/Are you sure you want to delete this job/);
    await page.screenshot({path:'artifacts/collection-review/i18n-delete-confirm-mobile.png',animations:'disabled'});
    await page.getByRole('button',{name:'No',exact:true}).click();
    assert.equal((await page.request.get('http://127.0.0.1:5083/api/sorts/1')).status(),200);
    await task.getByRole('button',{name:'Delete job',exact:true}).click();
    await page.getByRole('button',{name:'Yes',exact:true}).click();
    await task.waitFor({state:'detached'});
    assert.equal((await page.request.get('http://127.0.0.1:5083/api/sorts/1')).status(),404);
    assert.equal((await page.request.get('http://127.0.0.1:5083/api/sorts/2')).status(),200);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${viewport.width}x${viewport.height}: all OCR workflows, Undo/retry, admin delete No/Yes with unfinished stock, Vevor; no browser errors`);
} finally {await browser.close();server.kill();}
