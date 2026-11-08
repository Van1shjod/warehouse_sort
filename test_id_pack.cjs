const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup({type='single',storage=new Map(),submit=async p=>({prefix:p.id_pack,quantity:p.scans.length+p.manual_quantity,pallet_number:p.pallet_number})}={}) {
 const nodes=new Map(),requests=[];
 const el=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,style:{display:'none'},
   classList:{toggle(){}},focus(){},addEventListener(name,fn){this[name]=fn;},
   querySelectorAll(selector){return selector==='input,button'?[...nodes.values()]:[];}});
  return nodes.get(id);
 };
 const context={window:{},document:{getElementById:el,body:{classList:{toggle(){}}},addEventListener(){}},
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  userId:2,currentSort:{id:1,type:'single,mix',name:'Rampa 1'},currentType:type,
  crypto:require('node:crypto').webcrypto,showToast(){},
  fetch:async(path,options)=>{
   const body=JSON.parse(options.body);requests.push({path,body});
   const value=path.endsWith('resolve')?{prefix:body.id_pack==='C1008455260805160062'?'C1008455':body.id_pack==='C108455260805160062'?'C108455':[...body.id_pack].slice(0,6).join(''),group:null}:await submit(body);
   return {ok:true,json:async()=>value};
  }};
 context.window.sortActionBlocked=()=>false;
 context.window.chooseCollectionMode=()=>{el('work-area').style.display='block';};
 context.window.closeWorkArea=()=>{el('work-area').style.display='none';};
 context.window.selectType=type=>{context.currentType=type;};
 vm.runInNewContext(fs.readFileSync('static/id-pack.js','utf8'),context);
 const event={preventDefault(){}};
 const form=id=>el(id).onsubmit(event);
 async function start(id='C1264466260801050079') {
  context.window.openIdPack();el('id-pack-seed').value=id;await form('id-pack-identify-form');
  if(type==='single'){el('id-pack-expected').value='20';form('id-pack-expected-form');}
 }
 const scan=value=>{el('id-pack-scan').value=value;form('id-pack-scan-form');};
 return {el,context,requests,storage,form,start,scan};
}
test('identifying scan is not counted, next matching scans +1 and preserve full IDs',async()=>{
 const app=setup();await app.start();assert.equal(app.el('id-pack-amount').textContent,0);
 app.scan('C12644aaa');app.scan('WRONG1zzz');assert.equal(app.el('id-pack-amount').textContent,1);
 assert.equal(app.el('id-pack-message').textContent,'Це інший картон');
 app.scan('C12644bbb');assert.equal(app.el('id-pack-amount').textContent,2);
 app.el('id-pack-continue').onclick();app.el('id-pack-pallet').value='12';await app.form('id-pack-pallet-form');
 const payload=app.requests.find(r=>r.path.endsWith('submit')).body;
 assert.deepEqual(payload.scans,['C12644aaa','C12644bbb']);
 assert.equal(app.el('id-pack-seed').value,'');assert.equal(app.el('id-pack-panel').hidden,false);
});
test('Mix accepts arbitrary six Unicode characters without expected quantity',async()=>{
 const app=setup({type:'mix'});await app.start('😀abc12-rest');
 assert.equal(app.el('id-pack-expected-form').hidden,true);app.scan('😀abc12-new');
 assert.equal(app.el('id-pack-amount').textContent,1);assert.equal(app.el('id-pack-total').textContent,'картонів');
});
test('manual total preserves scanned IDs and records only the unscanned difference',async()=>{
 const app=setup();await app.start();app.scan('C12644aaa');app.scan('C12644bbb');
 app.el('id-pack-manual').onclick();app.el('id-pack-quantity').value='1';app.form('id-pack-quantity-form');
 assert.match(app.el('id-pack-quantity-error').textContent,/меншою/);
 app.el('id-pack-quantity').value='5';app.form('id-pack-quantity-form');assert.equal(app.el('id-pack-amount').textContent,5);
 app.el('id-pack-continue').onclick();app.el('id-pack-pallet').value='12';await app.form('id-pack-pallet-form');
 assert.equal(app.requests.find(r=>r.path.endsWith('submit')).body.manual_quantity,3);
});
test('double save submits once and blocks navigation until receipt is confirmed',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r);const app=setup({submit:()=>gate});await app.start();app.scan('C12644aaa');
 app.el('id-pack-continue').onclick();app.el('id-pack-pallet').value='12';
 const saving=app.form('id-pack-pallet-form');await app.form('id-pack-pallet-form');
 assert.equal(app.context.window.hasPendingIdPackSave(),true);app.context.window.closeWorkArea();
 assert.equal(app.el('work-area').style.display,'block');assert.equal(app.requests.filter(r=>r.path.endsWith('submit')).length,1);
 resolve({prefix:'C12644',quantity:1,pallet_number:'12'});await saving;
 assert.equal(app.context.window.hasPendingIdPackSave(),false);
});
test('unknown outcome survives reload and retries the exact immutable request',async()=>{
 const app=setup({submit:async()=>{throw Error('offline');}});await app.start();app.scan('C12644aaa');
 app.el('id-pack-continue').onclick();app.el('id-pack-pallet').value='12';await app.form('id-pack-pallet-form');
 const original=app.requests.find(r=>r.path.endsWith('submit')).body;
 assert.equal(app.context.window.hasPendingIdPackSave(),true);
 const recovered=setup({storage:app.storage});assert.equal(recovered.el('id-pack-recovery').hidden,false);
 recovered.el('id-pack-recover').onclick();await recovered.el('id-pack-retry').onclick();
 assert.deepEqual(recovered.requests[0].body,original);assert.equal(recovered.context.window.hasPendingIdPackSave(),false);
});
test('back moves within ID Pack and changing type releases the standard form',async()=>{
 const app=setup();await app.start();app.scan('C12644aaa');app.el('id-pack-continue').onclick();
 assert.equal(app.context.window.idPackBackHandler(),true);assert.equal(app.el('id-pack-count').hidden,false);
 app.context.window.selectType('mix');assert.equal(app.el('id-pack-panel').hidden,true);
});

test('leading zeros stay in the group and four following characters are compared',async()=>{
 for(const seed of ['C1008455260805160062','C108455260805160062']) {
  const app=setup();await app.start(seed);
  app.scan(seed);assert.equal(app.el('id-pack-amount').textContent,1);
  app.scan(seed==='C1008455260805160062'?'C1008466260805160062':'C108466260805160062');
  assert.equal(app.el('id-pack-amount').textContent,1);
  assert.equal(app.el('id-pack-message').textContent,'Це інший картон');
  app.scan('C100845');assert.equal(app.el('id-pack-amount').textContent,1);
  assert.match(app.el('id-pack-message').textContent,/Недостатньо/);
  app.el('id-pack-continue').onclick();app.el('id-pack-pallet').value='12';await app.form('id-pack-pallet-form');
  const payload=app.requests.find(r=>r.path.endsWith('submit')).body;
  assert.equal(payload.id_pack,seed==='C1008455260805160062'?'C1008455':'C108455');
  assert.deepEqual(payload.scans,[seed]);
 }
});
