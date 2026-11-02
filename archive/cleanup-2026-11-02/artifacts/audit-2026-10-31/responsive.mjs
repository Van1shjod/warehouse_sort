import {chromium} from 'file:///C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const tag=process.argv[2] || 'current',base='http://127.0.0.1:5086';
const server=spawn('python',[fileURLToPath(new URL('../collection-review/server.py',import.meta.url))],{env:{...process.env,COLLECTION_TEST_PORT:'5086'},windowsHide:true,stdio:['ignore','ignore','pipe']});
let logs='';server.stderr.on('data',v=>{logs+=v;});
for(let i=0;i<100;i++){
    try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}
    if(i===99){server.kill();throw Error(logs);}
}
const browser=await chromium.launch({channel:'msedge',headless:true});
const issues=[],checked=[],errors=[];
try{
 for(const [w,h] of [[320,568],[360,640],[390,844],[430,932],[768,1024],[1024,768],[1366,768],[1920,1080],[844,390],[568,320]]){
    const size=w+'x'+h,context=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:w<600?2:1,hasTouch:w<900,isMobile:w<600||h<500});
    const page=await context.newPage();page.setDefaultTimeout(5000);
    page.on('pageerror',e=>errors.push({size,error:e.message}));
    page.on('response',r=>{if(r.status()>=500&&r.url().includes('/api/'))errors.push({size,url:r.url(),status:r.status()});});
    async function snap(name,scrolled=false){
        await page.evaluate(()=>document.getAnimations().forEach(a=>{try{a.finish();}catch{}}));
        if(scrolled)await page.evaluate(()=>scrollTo(0,400));
        const state=await page.evaluate(()=>{
            const shown=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&r.width>0&&r.height>0;};
            const modal=[...document.querySelectorAll('.modal')].filter(shown).at(-1);
            const tooWide=[...document.querySelectorAll('body *')].filter(shown).filter(e=>{
                const r=e.getBoundingClientRect();if(r.right<=innerWidth+1&&r.left>=-1)return false;
                for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){if(/auto|scroll|hidden/.test(getComputedStyle(p).overflowX))return false;}
                return !e.matches('video,canvas,.modal,.camera-overlay,.camera-guide');
            }).slice(0,8).map(e=>({tag:e.tagName,id:e.id,class:e.className,width:Math.round(e.getBoundingClientRect().width)}));
            const covered=[];
            for(const e of (modal||document).querySelectorAll('button,a,input,select,textarea,summary')){
                if(!shown(e)||e.disabled)continue;
                const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
                if(x<0||x>=innerWidth||y<0||y>=innerHeight)continue;
                // Content underneath the opaque fixed navigation strip is not
                // visible; only controls in the actual content area count.
                if(y<64&&getComputedStyle(document.body,'::before').position==='fixed'&&!e.closest('.site-back-button'))continue;
                const top=document.elementFromPoint(x,y);
                // Opaque sticky navigation intentionally clips scrolled page
                // content. It must never cover a modal's controls.
                if(!modal&&top?.closest('.navbar')&&!e.closest('.navbar'))continue;
                if(top&&!e.contains(top)&&top!==e&&top.closest('.site-back-button,.navbar'))covered.push({id:e.id,text:(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,65),by:top.closest('.site-back-button')?'back':'navbar'});
            }
            let modalOutside=null;
            if(modal){const c=modal.querySelector('.modal-content'),r=c?.getBoundingClientRect();if(r&&(r.top<0||r.bottom>innerHeight+1||r.left<0||r.right>innerWidth+1))modalOutside={top:r.top,bottom:r.bottom};}
            const clipped=[];
            for(const e of document.querySelectorAll('#camera-capture,#camera-close,#flash-toggle-btn')){
                if(!shown(e))continue;
                const r=e.getBoundingClientRect();
                for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){
                    const s=getComputedStyle(p),a=p.getBoundingClientRect();
                    if(s.overflowY==='hidden'&&(r.bottom>a.bottom+1||r.top<a.top-1)){clipped.push(e.id);break;}
                }
            }
            const localOverflow=[...document.querySelectorAll('.inventory-admin-pallets,.login-box,.work-card,.presort-card,.admin-tab-content')].filter(shown).filter(e=>getComputedStyle(e).overflowX==='visible'&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.className);
            const heading=document.querySelector('.navbar h2'),back=document.querySelector('.site-back-button');
            let headingCovered=false;
            if(!modal&&heading&&back&&shown(heading)&&shown(back)){const a=heading.getBoundingClientRect(),b=back.getBoundingClientRect();headingCovered=a.top<b.bottom&&a.bottom>b.top&&a.left<b.right&&a.right>b.left&&!(a.bottom<=64&&getComputedStyle(document.body,'::before').position==='fixed');}
            return {overflow:document.documentElement.scrollWidth>innerWidth+1,tooWide,covered,modalOutside,clipped,localOverflow,headingCovered};
        });
        checked.push({size,name});
        if(state.overflow||state.covered.length||state.modalOutside||state.clipped.length||state.localOverflow.length||state.headingCovered){issues.push({size,name,...state});await page.screenshot({path:`artifacts/audit-2026-10-31/${tag}-${name}-${size}.png`,animations:'disabled'});}
    }
    await page.goto(base);await snap('login');
    await page.getByRole('button',{name:'Реєстрація',exact:true}).click();await snap('register');
    await page.goto(base+'/_test/enter');await snap('home');
    await page.evaluate(()=>selectSort(1));await snap('type');
    await page.locator('#sort-type-single-btn').click();await snap('mode');
    await page.getByRole('button',{name:'Один товар',exact:true}).click();await snap('single-form');
    await page.locator('#icc-code-input').fill('4567');await page.locator('#cartons-count-input').fill('3');await page.locator('#location-code-input').fill('JP-A');await page.locator('#location-code-input').press('Enter');
    await page.locator('#collection-location').waitFor({state:'visible'});await snap('source');
    await page.locator('#collection-source-number').fill('1');await page.locator('#collection-source-number').press('Enter');await snap('carton');
    await page.evaluate(()=>closeWorkArea());page.on('dialog',d=>d.accept());
    await page.evaluate(()=>selectType('mix'));await page.getByRole('button',{name:'Різні товари',exact:true}).click();
    await page.locator('#mix-icc-code-input').fill('D980989');await page.locator('#mix-icc-code-input').press('Enter');
    await page.locator('#confirmation-modal').waitFor({state:'visible'});await snap('quantity');
    await page.locator('#current-quantity-input').fill('1');await page.locator('#current-quantity-input').press('Enter');await snap('destination');
    await page.goto(base+'/admin');
    for(const tab of ['users','activity','ocr','create']){await page.evaluate(t=>showAdminTab(t),tab);await snap('admin-'+tab);}
    await page.evaluate(()=>{showAdminTab('sort');showSortSubtab('create-sort');});await page.locator('.admin-task-card').first().waitFor();await snap('admin-tasks');await snap('admin-scroll',true);
    await page.locator('.admin-task-card').first().getByRole('button',{name:'Видалити завдання'}).click();await snap('delete-confirm');await page.getByRole('button',{name:'Ні',exact:true}).click();
    await page.getByRole('button',{name:'Рухи та залишки',exact:true}).click();await page.locator('#inventory-admin-job').selectOption('1');await page.locator('#inventory-admin-workspace').waitFor({state:'visible'});await snap('inventory');
    await page.locator('#inventory-admin-settings').click();await snap('inventory-dialog');await page.locator('#inventory-admin-editor-cancel').click();
    await page.getByRole('button',{name:'Pre-sort: картони',exact:true}).click();await page.locator('#admin-presort-job').selectOption('1');await snap('presort-archive');
    const job=await (await page.request.post(base+'/api/sorts',{data:{mode:'presort',name:'Rampa 2',type:'single,mix',unload_date:'2026-10-31',description:'Тест адаптивності'}})).json();
    await page.goto(base+'/presort?sort_id='+job.sort_id);await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#open').click();await page.locator('#close').waitFor({state:'visible'});await snap('presort');await snap('presort-scroll',true);
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=320;c.height=240;const s=c.captureStream();c.getContext('2d').fillRect(0,0,320,240);return s;};});
    await page.locator('#camera-scan-btn').click();await page.waitForFunction(()=>document.getElementById('camera-video').videoWidth>0);await snap('camera');
    await page.locator('#camera-capture').click({trial:true});
    if(w===568||w===320||w===844)await page.screenshot({path:`artifacts/audit-2026-10-31/${tag}-camera-${size}.png`,animations:'disabled'});
    await page.locator('#camera-close').click();
    await page.goto(base+'/lider');await page.locator('#sorts-table-body .spinner').waitFor({state:'hidden'});await snap('lider');
    for(const tab of ['pallets','icc','users','containers']){await page.evaluate(t=>showLiderTab(t),tab);await snap('lider-'+tab);}
    await context.close();console.log(size+' checked; cumulative issues: '+issues.length);
 }
}catch(error){errors.push({fatal:error.stack});}
finally{
 await writeFile(`artifacts/audit-2026-10-31/${tag}.json`,JSON.stringify({checked:checked.length,resolutions:[...new Set(checked.map(v=>v.size))],issues,errors},null,2));
 await browser.close();server.kill();
}
console.log(JSON.stringify({checked:checked.length,issues:issues.length,errors}));
if(errors.length)process.exitCode=1;
