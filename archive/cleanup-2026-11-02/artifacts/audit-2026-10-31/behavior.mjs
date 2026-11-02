import {chromium} from 'file:///C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5087';
const server=spawn('python',[fileURLToPath(new URL('../collection-review/server.py',import.meta.url))],{env:{...process.env,COLLECTION_TEST_PORT:'5087'},windowsHide:true,stdio:['ignore','ignore','pipe']});
let logs='';server.stderr.on('data',v=>{logs+=v;});
for(let i=0;i<100;i++){
 try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}
 if(i===99){server.kill();throw Error(logs);}
}
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const probe='<img src=x onerror=window.auditInjected=1>';
 const registered=await page.request.post(base+'/register',{data:{username:probe,password:'temporary-test-only'}});
 assert.equal(registered.status(),200);
 await page.goto(base+'/_test/enter');await page.goto(base+'/admin');
 await page.evaluate(()=>showAdminTab('users'));
 await page.locator('#users-table-body').getByText(probe,{exact:true}).waitFor();
 assert.equal(await page.locator('#users-table-body img').count(),0);
 await page.evaluate(()=>showAdminTab('activity'));
 await page.locator('#users-list').getByText(probe,{exact:true}).waitFor();
 assert.equal(await page.locator('#users-list img').count(),0);
 assert.equal(await page.locator('#activity-table-body img').count(),0);
 await page.route('**/api/admin/ocr_scans*',route=>route.fulfill({json:[{timestamp:'20261031_120000',carton_type:'single',success:false,extracted_data:{cell:probe},raw_ocr_results:{original:probe},image_exists:false,user_id:2}]}));
 await page.evaluate(()=>showAdminTab('ocr'));
 await page.locator('.ocr-card').first().waitFor();await page.locator('.ocr-card').first().click();
 await page.locator('#ocr-detail-modal').waitFor({state:'visible'});
 assert.equal(await page.locator('#ocr-detail-body img').count(),0);
 assert.ok((await page.locator('#ocr-detail-body').innerText()).includes(probe));
 assert.equal(await page.evaluate(()=>window.auditInjected),undefined);
 await page.goto(base+'/lider');await page.evaluate(()=>showLiderTab('users'));
 await page.getByText(probe,{exact:true}).waitFor();
 assert.equal(await page.locator('#users-table-body img').count(),0);
 await page.evaluate(()=>showLiderTab('sorts'));await page.evaluate(()=>showCreateSortModal());
 await page.locator('#new-sort-name').fill('QA Single / Mix');
 await page.locator('#new-sort-type').selectOption('single,mix');
 const created=page.waitForResponse(r=>r.url().endsWith('/api/sorts')&&r.request().method()==='POST');
 page.on('dialog',dialog=>dialog.accept());await page.evaluate(()=>createSort());
 assert.equal((await created).status(),200);
 const saved=await page.request.post(base+'/api/sort/submit',{data:{sort_id:1,type:'single',icc_code:'7890',total_cartons:10,location_code:'AA-A',cartons_count:1,pallet_number:'QA-1',request_id:crypto.randomUUID()}});
 assert.equal(saved.status(),201);const savedData=await saved.json();
 await page.goto(base+'/admin');await page.evaluate(id=>openEditICCModal(id),savedData.icc_id);
 await page.locator('#inventory-admin-workspace').waitFor({state:'visible'});
 assert.equal(await page.locator('#inventory-admin-job').inputValue(),'1');
 assert.equal(await page.locator('#edit-icc-modal').isVisible(),false);
 await page.goto(base+'/dashboard');
 await page.evaluate(()=>sessionStorage.setItem('warehouse-collection-1',JSON.stringify({sort:{id:1},type:'single',phase:'identify',order:'asc'})));
 await page.reload();await page.locator('#collection-resume').waitFor({state:'visible'});
 await page.evaluate(()=>selectSort(1));await page.locator('#sort-type-single-btn').click();
 await page.getByRole('button',{name:'Різні товари',exact:true}).click();
 assert.equal(await page.locator('#collection-resume').isVisible(),false);
 await page.evaluate(()=>selectType('single'));
 await page.getByRole('button',{name:'Один товар',exact:true}).click();
 await page.locator('#icc-code-input').fill('4567');await page.locator('#cartons-count-input').fill('3');await page.locator('#location-code-input').fill('JP-A');await page.locator('#location-code-input').press('Enter');
 await page.locator('#collection-location').waitFor({state:'visible'});
 await page.locator('#collection-source-number').fill('1');await page.locator('#collection-source-number').press('Enter');
 let pickRequests=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/collection/pick'))pickRequests++;});
 await page.evaluate(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
        if(key==='warehouse-collection-1'&&JSON.parse(value).pending)throw new DOMException('blocked','SecurityError');
        return original.call(this,key,value);
    };
 });
 await page.locator('#icc-code-input').fill('4567');await page.locator('#cartons-count-input').fill('3');await page.locator('#location-code-input').fill('JP-A');await page.locator('#location-code-input').press('Enter');
 await page.waitForFunction(()=>document.getElementById('collection-message').textContent.includes('не дозволив зберегти запит'));
 assert.equal(pickRequests,0,'Blocked browser storage must not start an unrecoverable stock operation');
 assert.equal(await page.evaluate(()=>window.auditInjected),undefined);
 assert.deepEqual(errors,[]);
 console.log('PASS: inert usernames/OCR text, Lider tabs/create, managed stock routing, stale draft removal and storage failure; isolated DB only');
}finally{await browser.close();server.kill();}
