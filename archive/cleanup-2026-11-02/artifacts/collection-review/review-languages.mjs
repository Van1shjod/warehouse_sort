import {chromium} from 'file:///C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5084';
const server=spawn('python',[fileURLToPath(new URL('./server.py',import.meta.url))],{env:{...process.env,COLLECTION_TEST_PORT:'5084'},windowsHide:true,stdio:['ignore','ignore','pipe']});
let logs='';server.stderr.on('data',v=>{logs+=v;});
for(let i=0;i<100;i++){
    try{await fetch(base);break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}
    if(i===99){server.kill();throw new Error(logs);}
}
const browser=await chromium.launch({channel:'msedge',headless:true});
let checked=0;const errors=[], untranslated=new Set();
try{
    for(const language of ['en','pl','ru','uk']) for(const [size,viewport] of [['mobile',{width:320,height:568}],['desktop',{width:1280,height:900}]]){
        const context=await browser.newContext({viewport});
        await context.addInitScript(lang=>{if(!localStorage.getItem('warehouse-language'))localStorage.setItem('warehouse-language',lang);},language);
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        async function shot(name){
            checked++;
            await page.locator('.language-select').click({trial:true});
            await page.locator('.theme-toggle').click({trial:true});
            if(viewport.width===320) {
                const themeBox=await page.locator('.theme-toggle').boundingBox();assert(themeBox.height<=45);
            }
            await page.waitForTimeout(70);
            assert.equal(await page.evaluate(()=>document.documentElement.lang),language);
            if(language==='en') {
                const remaining=await page.evaluate(()=>{
                    const results=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
                    while(walker.nextNode()) {
                        const n=walker.currentNode;
                        if(!n.parentElement.closest('script,style,.language-control,[data-no-translate]') && /[А-Яа-яІіЇїЄє]/.test(n.nodeValue)) results.push(n.nodeValue.trim());
                    }
                    for(const n of document.querySelectorAll('[placeholder],[title],[aria-label]')) for(const a of ['placeholder','title','aria-label']) if(/[А-Яа-яІіЇїЄє]/.test(n.getAttribute(a)||'')) results.push(n.getAttribute(a));
                    return results;
                });
                for(const text of remaining)untranslated.add(text);
            }
            await page.screenshot({path:`artifacts/collection-review/language-${language}-${name}-${size}.png`,animations:'disabled'});
            const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
            assert.equal(overflow,false,`${name} overflows ${size}`);
            assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(243, 245, 249)',name+' page background');
        }
        await page.goto(base);await shot('login');
        await page.locator('#login-username').fill('4567 JP-A');
        await page.evaluate(()=>{
            const protectedText=document.createElement('p');protectedText.id='translation-data-probe';
            protectedText.dataset.i18nProtected=JSON.stringify(['Додати']);
            protectedText.textContent='#42 · Додати · Активний';document.body.append(protectedText);
        });
        for(const lang of ['en','pl','ru','uk',language]) {
            await page.locator('.language-select').selectOption(lang);
            assert.equal(await page.locator('#login-username').inputValue(),'4567 JP-A');
            assert.match(await page.locator('#translation-data-probe').innerText(),/Додати/);
        }
        await page.evaluate(()=>document.getElementById('translation-data-probe').remove());
        await page.reload();assert.equal(await page.locator('.language-select').inputValue(),language);

        assert.equal(await page.locator('.site-back-button').count(),0);
        await page.locator('.tab-btn').nth(1).click();await shot('register');
        await page.goto(base+'/_test/enter');await shot('home');
        const created=await page.request.post(base+'/api/sorts',{data:{mode:'presort',name:'Rampa 2',type:'single,mix',unload_date:'2026-10-31',description:''}});
        assert.equal(created.status(),200);const job=await created.json();
        await page.goto(base+'/presort?sort_id='+job.sort_id);
        await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#open').click();
        await page.locator('#close').waitFor({state:'visible'});await shot('presort');
        await page.goto(base+'/admin');
        await page.evaluate(()=>{showAdminTab('sort');showSortSubtab('create-sort');});
        await page.locator('.admin-task-card').first().waitFor();await shot('admin-tasks');
        await page.locator('.admin-task-card').first().locator('button').last().click();
        await page.locator('#confirm-modal').waitFor({state:'visible'});await shot('confirm');
        await page.locator('#confirm-no-btn').click();
        await page.evaluate(()=>showAdminTab('inventory'));
        await page.locator('#inventory-admin-job').selectOption('1');
        await page.locator('#inventory-admin-workspace').waitFor({state:'visible'});await shot('inventory');
        await page.locator('#inventory-admin-settings').click();await shot('icc-settings');
        await page.locator('#inventory-admin-editor-cancel').click();
        await page.locator('#inventory-admin-packs button').first().click();await shot('expected-editor');
        await page.locator('#inventory-admin-editor-cancel').click();
        await page.locator('#inventory-admin-pallets button').first().click();await shot('pallet-editor');
        await page.locator('#inventory-admin-editor-cancel').click();
        await page.evaluate(()=>showAdminTab('presort'));
        await page.locator('#admin-presort-job option').nth(1).waitFor({state:'attached'});
        await page.waitForTimeout(100);await shot('archive-products');
        await page.locator('#admin-presort-view').selectOption('scans');await page.waitForTimeout(100);await shot('archive-scans');
        for(const tab of ['users','activity','ocr','create']) {
            await page.evaluate(value=>showAdminTab(value),tab);await page.waitForTimeout(120);await shot('admin-'+tab);
        }
        await page.evaluate(()=>{showAdminTab('ocr');showOcrDetail(0);});await shot('ocr-detail');

        await page.goto(base+'/lider');await page.locator('#sorts-table-body .spinner').waitFor({state:'hidden'});await shot('lider');
        for(const tab of ['containers','pallets','icc','users']) {
            await page.evaluate(value=>showLiderTab(value),tab);await page.waitForTimeout(100);await shot('lider-'+tab);
        }
        await page.goto(base+'/test_ocr_images');await page.locator('#loading').waitFor({state:'hidden'});await shot('ocr');
        await context.close();
    }
    await import('node:fs/promises').then(fs=>fs.writeFile('artifacts/i18n/untranslated.json',JSON.stringify([...untranslated].sort(),null,2)));
    assert.deepEqual(errors,[]);console.log('PASS: 4 languages, 320/1280 px, '+checked+' page states, controls clickable, retained form/data, reload persistence, no overflow or JS errors; isolated DB');
}finally{await browser.close();server.kill();}
