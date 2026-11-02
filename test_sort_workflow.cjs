const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');

const answer=(data,status=200)=>({ok:status<400,status,json:async()=>data});
function screen(transport, storage=new Map(), user=1) {
    const nodes=new Map(), ready=[], requests=[], remembered=[];
    let focused=null;
    class Node {
        constructor() {this.value='';this.textContent='';this.style={};this.disabled=false;this.hidden=false;this.children=[];this.handlers={};
            this.classList={add(){},remove(){}};}
        addEventListener(name,fn) {this.handlers[name]=fn;}
        append(...nodes) {this.children.push(...nodes);}
        replaceChildren(...nodes) {this.children=nodes;this.textContent='';}
        focus() {focused=this;}
        querySelector() {return this.heading ||= new Node();}
        play() {return Promise.resolve();}
    }
    const el=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
    const context={console:{log(){},error(){}},userId:user,crypto:{randomUUID},
        document:{getElementById:el,createElement:()=>new Node(),addEventListener:(event,fn)=>{if(event==='DOMContentLoaded')ready.push(fn);},
            querySelectorAll:()=>['icc-code-input','cartons-count-input','location-code-input','mix-icc-code-input','pallet-location-input','current-quantity-input'].map(el)},
        sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
        localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
        setTimeout:(fn,ms)=>setTimeout(fn,ms).unref(),clearTimeout,confirm:()=>true,alert:()=>{},
        navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},
        rememberPresortMatch:(data,type)=>remembered.push({data,type}),
        fetch:async(path,options)=>{
            if(path==='/api/stats')return answer({});
            const payload=options?.body?JSON.parse(options.body):null;requests.push({path,payload});
            return transport(path,payload,options);
        }};
    context.window=context;
    const instance=vm.createContext(context);
    vm.runInContext(fs.readFileSync('static/dashboard.js','utf8'),instance);
    const setCurrent=(overrides={})=>{
        vm.runInContext(`currentSort={id:1,name:'Rampa 1',mode:'sort',status:'active',type:'single,mix,vevor'};currentType='single';scannedData=${JSON.stringify({iccCode:'4567',totalCartons:30,locationCode:'JP-A',currentQuantity:2,isExisting:false,...overrides})}`,instance);
        el('pallet-location-input').value='P1';
    };
    return {context,instance,el,requests,storage,remembered,setCurrent,ready,focused:()=>focused};
}

test('fast keyboard transitions focus the current step before accepting Enter',async()=>{
    const app=screen(async()=>answer({current_cartons:1,total_cartons:30}));app.setCurrent();
    app.context.showConfirmationModal();
    assert.equal(app.focused(),app.el('current-quantity-input'));
    app.el('current-quantity-input').value='1';app.context.proceedToLocation();
    assert.equal(app.focused(),app.el('pallet-location-input'));
    app.el('pallet-location-input').value='FAST-1';
    await app.context.confirmAndSubmit();
    assert.equal(app.requests.length,1);
    assert.equal(app.requests[0].payload.cartons_count,1);
    assert.equal(app.requests[0].payload.pallet_number,'FAST-1');
});

test('OCR suppresses automatic field focus through async transitions and restores manual focus',async()=>{
    for (const type of ['single','mix','collection']) {
        const app=screen(async()=>answer({cell:'4567',qtyPack:30,prefix:'JP',zone:'A'}));
        app.setCurrent();
        if(type==='mix') vm.runInContext("currentType='mix'",app.instance);
        let blurred=false, continued=false;
        app.context.document.activeElement={blur(){blurred=true;}};
        app.context.FormData=class {append(){}};
        app.context.fetch=async()=>answer({cell:'4567',qtyPack:30,prefix:'JP',zone:'A'});
        app.el('camera-canvas').getContext=()=>({drawImage(){}});
        app.el('camera-canvas').toBlob=callback=>callback({});
        const transition=async()=>{
            await Promise.resolve();
            app.context.showConfirmationModal();
            app.context.focusWorkInput(app.el('icc-code-input'));
            continued=true;
        };
        if(type==='collection') app.context.confirmCollectionScan=async()=>{await transition();return true;};
        else if(type==='mix') app.context.submitMixData=transition;
        else app.context.submitSingleData=transition;
        await app.context.capturePhoto();
        assert.equal(continued,true,type);
        assert.equal(blurred,true,type);
        assert.equal(app.focused(),null,type);
        app.context.showConfirmationModal();
        assert.equal(app.focused(),app.el('current-quantity-input'),type);
    }
});

test('Vevor shows the shared form and camera and only permitted type buttons', async()=>{
    const app=screen(async()=>answer({status:'new'}));app.setCurrent();
    vm.runInContext("currentSort.type='vevor'",app.instance);
    app.context.showSortMenu();
    assert.equal(app.el('sort-type-single-btn').hidden,true);assert.equal(app.el('sort-type-vevor-btn').hidden,false);
    app.context.selectType('vevor');assert.equal(app.el('single-input-section').style.display,'block');
    app.el('icc-code-input').value='4567';app.el('cartons-count-input').value='30';app.el('location-code-input').value='JP-A';
    await app.context.submitSingleData();
    assert.deepEqual(app.requests[0].payload,{sort_id:1,icc_code:'4567',type:'vevor',total_cartons:30,location_code:'JP-A'});
    await app.context.openCameraScanner();assert.equal(app.el('camera-modal').style.display,'flex');
    await app.context.closeCameraScanner();
});

test('SORT saves a new item with one complete atomic request',async()=>{
    const app=screen(async()=>answer({current_cartons:2,total_cartons:30,is_completed:false,icc_id:8,pallet_id:10}));app.setCurrent();
    await app.context.confirmAndSubmit();
    assert.equal(app.requests.length,1);assert.equal(app.requests[0].path,'/api/sort/submit');
    assert.equal(app.requests[0].payload.sort_id,1);assert.equal(app.requests[0].payload.cartons_count,2);
    assert.match(app.requests[0].payload.request_id,/^[a-f0-9-]{36}$/);
    assert.equal(app.context.hasPendingSortSave(),false);assert.equal(app.el('icc-code-input').disabled,false);
    assert.equal(app.remembered[0].data.iccCode,'4567');
});

test('network failure survives reload and retries the exact payload without a new token',async()=>{
    const sent=[];
    const first=screen(async(path,payload)=>{sent.push(payload);throw new Error('network');});first.setCurrent();
    await first.context.confirmAndSubmit();assert.equal(first.context.hasPendingSortSave(),true);
    assert.equal(first.el('icc-code-input').disabled,true);
    first.el('pallet-location-input').value='CHANGED';
    await first.context.selectSort(999);assert.equal(first.requests.length,1);
    const other=screen(async()=>answer({}),first.storage,2);assert.equal(other.context.hasPendingSortSave(),false);
    const resumed=screen(async(path,payload)=>{sent.push(payload);return answer({current_cartons:2,total_cartons:30});},first.storage,1);
    assert.equal(resumed.context.hasPendingSortSave(),true);
    await resumed.context.retryPendingSortSave();
    assert.deepEqual(sent[0],sent[1]);assert.equal(sent[1].pallet_number,'P1');assert.equal(resumed.context.hasPendingSortSave(),false);
});

test('validation conflicts unlock fields, while expired authentication keeps the pending operation',async()=>{
    const invalid=screen(async()=>answer({error:'Залишилось 1'},409));invalid.setCurrent();
    await invalid.context.confirmAndSubmit();assert.equal(invalid.context.hasPendingSortSave(),false);assert.equal(invalid.el('icc-code-input').disabled,false);
    const expired=screen(async()=>answer({error:'login'},401));expired.setCurrent();
    await expired.context.confirmAndSubmit();assert.equal(expired.context.hasPendingSortSave(),true);
    assert.match(expired.el('toast-message').textContent,/той самий акаунт/);
});

test('closing a full pallet sends exact task, item and pallet IDs',async()=>{
    const app=screen(async()=>answer({message:'closed'}));
    app.setCurrent({isExisting:true,existingData:{id:8},existingPallet:'P1',existingPalletId:10});
    await app.context.closePalletAndNew();
    assert.equal(app.requests[0].path,'/api/sort/pallet/close');
    assert.deepEqual(app.requests[0].payload,{sort_id:1,icc_id:8,pallet_id:10});
});

test('fractional quantities are rejected before advancing or saving',async()=>{
    const app=screen(async()=>answer({}));app.setCurrent();
    app.el('current-quantity-input').value='1.5';app.context.proceedToLocation();
    assert.match(app.el('toast-message').textContent,/кількість/);assert.equal(app.requests.length,0);
});

test('a late check cannot reopen a confirmation after the user goes back',async()=>{
    let finish;
    const app=screen(async()=>new Promise(resolve=>{finish=resolve;}));app.setCurrent();
    app.el('icc-code-input').value='4567';app.el('cartons-count-input').value='30';app.el('location-code-input').value='JP-A';
    app.el('confirmation-modal').style.display='none';
    const checking=app.context.submitSingleData();
    app.context.showSortMenu();
    finish(answer({status:'exists',icc_data:{id:8},open_pallet:{id:10,pallet_number:'P1'}}));
    await checking;
    assert.equal(app.el('confirmation-modal').style.display,'none');
    assert.equal(app.el('sort-menu').style.display,'flex');
});

test('a completed item exposes its previous pallet and a new batch uses a fresh destination',async()=>{
    const app=screen(async(path)=>path==='/api/sort/check'
        ? answer({status:'completed',icc_data:{id:8},open_pallet:{id:10,pallet_number:'P1'}})
        : answer({message:'closed'}));
    app.setCurrent();app.el('icc-code-input').value='4567';app.el('cartons-count-input').value='30';app.el('location-code-input').value='JP-A';
    await app.context.submitSingleData();
    assert.equal(app.el('completed-pallet-row').hidden,false);
    assert.equal(app.el('completed-pallet-number').textContent,'P1');
    await app.context.closeCompletedPallet();
    assert.deepEqual(app.requests[1].payload,{sort_id:1,icc_id:8,pallet_id:10});
    assert.equal(app.el('completed-pallet-row').hidden,true);
    app.context.confirmNewItem();
    assert.equal(vm.runInContext('scannedData.isNewItem',app.instance),true);
    assert.equal(vm.runInContext('scannedData.existingPallet',app.instance),null);
});
