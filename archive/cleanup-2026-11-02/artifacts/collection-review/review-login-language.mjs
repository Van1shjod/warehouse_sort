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
try {
    for(const width of [320,1280]) for(const language of ['uk','en','pl','ru']) {
        const context=await browser.newContext({viewport:{width,height:800}});
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base);
        await page.locator('.language-select').selectOption(language);
        assert.equal(await page.evaluate(()=>document.documentElement.lang),language);
        await page.locator('.tab-btn').nth(1).click();
        assert.equal(await page.locator('.language-select').count(),1);
        await page.reload();
        assert.equal(await page.locator('.language-select').inputValue(),language);
        await page.goto(base+'/_test/enter');
        for(const path of ['/dashboard','/admin','/presort','/lider','/test_ocr_images']) {
            await page.goto(base+path);
            await page.waitForTimeout(50);
            assert.equal(await page.locator('.language-select').count(),0,path);
            assert.equal(await page.evaluate(()=>document.body.classList.contains('has-language-control')),false,path);
            assert.equal(await page.evaluate(()=>document.documentElement.lang),language,path);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,path);
            await page.locator('.theme-toggle').click();
            assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
            await page.locator('.theme-toggle').click();
        }
        await page.goto(base+'/logout');
        assert.equal(await page.locator('.language-select').inputValue(),language);
        await context.close();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: language selector only on login/register, persists across login/logout; 4 languages, 2 widths, 5 protected pages; theme works, no overflow or JS errors');
} finally {await browser.close();server.kill();}
