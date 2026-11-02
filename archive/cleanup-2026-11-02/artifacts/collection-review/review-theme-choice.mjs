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
const errors=[];
try{
    for(const theme of ['light','dark']) for(const [size,viewport] of [['small',{width:320,height:568}],['mobile',{width:390,height:844}],['desktop',{width:1280,height:900}]]){
        const context=await browser.newContext({viewport});
        await context.addInitScript(value=>{if(!localStorage.getItem('warehouse-theme'))localStorage.setItem('warehouse-theme',value);},theme);
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        async function shot(name){
            await page.waitForTimeout(80);
            await page.locator(".theme-toggle").waitFor({state:"visible"});
            await page.screenshot({path:`artifacts/collection-review/theme-choice-${theme}-${name}-${size}.png`,animations:'disabled'});
            const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
            assert.equal(overflow,false,`${name} overflows ${size}`);
            assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),theme==='dark'?'rgb(16, 24, 36)':'rgb(243, 245, 249)',name+' page background');
        }
        await page.goto(base);await shot('login');
        const toggle=page.locator('.theme-toggle');
        await toggle.click();
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme==='dark'?'light':'dark');
        await page.reload();
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme==='dark'?'light':'dark');
        await toggle.click();
        assert.equal(await page.evaluate(()=>localStorage.getItem('warehouse-theme')),theme);
        const b=await toggle.boundingBox();assert(b.x>=0 && b.x+b.width<=viewport.width);
        assert.equal(await page.locator('.site-back-button').count(),0);
        await page.getByRole('button',{name:'Реєстрація',exact:true}).click();await shot('register');
        await page.goto(base+'/_test/enter');await shot('home');
        const created=await page.request.post(base+'/api/sorts',{data:{mode:'presort',name:'Rampa 2',type:'single,mix',unload_date:'2026-10-31',description:''}});
        assert.equal(created.status(),200);const job=await created.json();
        await page.goto(base+'/presort?sort_id='+job.sort_id);
        await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#open').click();
        await page.locator('#close').waitFor({state:'visible'});await shot('presort');
        await page.goto(base+'/admin');
        await page.evaluate(()=>{showAdminTab('sort');showSortSubtab('create-sort');});
        await page.locator('.admin-task-card').first().waitFor();await shot('admin-tasks');
        await page.locator('.admin-task-card').first().getByRole('button',{name:'Видалити завдання'}).click();
        await page.locator('#confirm-modal').waitFor({state:'visible'});await shot('confirm');
        await page.getByRole('button',{name:'Ні',exact:true}).click();
        await page.getByRole('button',{name:'Рухи та залишки',exact:true}).click();
        await page.locator('#inventory-admin-job').selectOption('1');
        await page.locator('#inventory-admin-workspace').waitFor({state:'visible'});await shot('inventory');
        await page.goto(base+'/lider');await page.locator('#sorts-table-body .spinner').waitFor({state:'hidden'});await shot('lider');
        await page.goto(base+'/test_ocr_images');await page.locator('#loading').waitFor({state:'hidden'});await shot('ocr');
        await context.close();
    }
    assert.deepEqual(errors,[]);console.log('PASS: light/dark, 320/390/1280 px, 54 views, toggling/storage, no overflow or JS errors; isolated DB');
}finally{await browser.close();server.kill();}
