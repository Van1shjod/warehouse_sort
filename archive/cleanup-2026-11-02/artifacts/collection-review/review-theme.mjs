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
    for(const [size,viewport] of [['mobile',{width:390,height:844}],['desktop',{width:1280,height:900}]]){
        const context=await browser.newContext({viewport});
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        async function shot(name){
            await page.screenshot({path:`artifacts/collection-review/theme-${name}-${size}.png`,animations:'disabled'});
            const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
            assert.equal(overflow,false,`${name} overflows ${size}`);
            assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(243, 245, 249)',name+' page background');
        }
        await page.goto(base);await shot('login');
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
    assert.deepEqual(errors,[]);console.log('PASS: 18 mobile/desktop views, shared style, no page overflow or JavaScript errors; isolated DB only');
}finally{await browser.close();server.kill();}
