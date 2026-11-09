const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(fetch) {
 class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.textContent='';this.handlers={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  setAttribute(){}
  get options(){return this.children;}
  get value(){return this._value ?? this.children[0]?.value ?? '';}
  set value(v){this._value=String(v);}
  set innerHTML(_){throw Error('Unsafe HTML insertion');}
 }
 const nodes=new Map();const el=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 el('id-pack-admin-type').value='single';
 const context={window:{},document:{getElementById:el,createElement:tag=>new Element(tag)},fetch,encodeURIComponent};
 vm.runInNewContext(fs.readFileSync('static/admin-id-pack.js','utf8'),context);
 return {el,load:context.window.loadAdminIdPack};
}
const ok=data=>({ok:true,json:async()=>data});
const text=node=>node.textContent+node.children.map(text).join('');
test('admin groups render full IDs safely and label manual quantities',async()=>{
 const app=setup(async path=>{
  if(path==='/api/sorts/all')return ok([{id:1,name:'Rampa 1',mode:'sort',status:'closed'}]);
  if(path.includes('?'))return ok([{id:7,prefix:'<x>12!',quantity:5,expected_qty:20}]);
  return ok({scans:['<x>12!<script>alert(1)</script>','<x>12!full-other'],manual_quantity:3});
 });
 await app.load();const details=app.el('id-pack-admin-groups').children[0];details.open=true;await details.handlers.toggle();
 assert.match(text(details),/<script>alert\(1\)<\/script>/);
 assert.match(text(details),/Додано вручну без ID: 3/);
 assert.match(text(details),/Очікується: 20/);
 assert.equal(app.el('id-pack-admin-sort').children.length,1);
});
test('late details from a previous type cannot populate the next group',async()=>{
 let finish;
 const app=setup(async path=>{
  if(path==='/api/sorts/all')return ok([{id:1,name:'Rampa',mode:'sort',status:'active'}]);
  if(path.includes('?'))return ok([{id:path.includes('type=mix')?2:1,prefix:path.includes('type=mix')?'MIX123':'SINGLE',quantity:1,expected_qty:null}]);
  return new Promise(resolve=>{finish=resolve;});
 });
 await app.load();const previous=app.el('id-pack-admin-groups').children[0];previous.open=true;const loading=previous.handlers.toggle();
 app.el('id-pack-admin-type').value='mix';await app.el('id-pack-admin-type').onchange();
 finish(ok({scans:['SINGLE-OLD-ID'],manual_quantity:0}));await loading;
 const current=app.el('id-pack-admin-groups').children[0];assert.match(text(current),/MIX123/);assert.doesNotMatch(text(current),/SINGLE/);
 assert.doesNotMatch(text(previous),/SINGLE-OLD-ID/);
});
test('failed group detail can be retried without stale error or duplicate IDs',async()=>{
 let attempts=0;
 const app=setup(async path=>{
  if(path==='/api/sorts/all')return ok([{id:1,mode:'sort',status:'active'}]);
  if(path.includes('?'))return ok([{id:1,prefix:'ABC123',quantity:1,expected_qty:null}]);
  attempts++;return attempts===1?{ok:false,json:async()=>({error:'try again'})}:ok({scans:['ABC123full'],manual_quantity:0});
 });
 await app.load();const details=app.el('id-pack-admin-groups').children[0];details.open=true;await details.handlers.toggle();assert.match(text(details),/try again/);
 await details.handlers.toggle();assert.doesNotMatch(text(details),/try again/);assert.match(text(details),/ABC123full/);
 await details.handlers.toggle();assert.equal(attempts,2);
});
