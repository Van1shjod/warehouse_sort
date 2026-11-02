const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('static/data-version.js','utf8');
function storage(entries){
    const data=new Map(entries);
    return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
}
test('reset clears old work in each tab, preserving preferences and future drafts',()=>{
    const local=storage([['currentSortId','7'],['warehouse-language','pl'],['warehouse-theme','dark']]);
    for(let tab=0;tab<2;tab++){
        const session=storage([['warehouse-sort-pending-1','old'],['warehouse-collection-1','old'],['presortPending','old'],['warehouse-inventory-admin-pending-1','old'],['warehouse-page-back','old'],['unrelated','keep']]);
        const context={localStorage:local,sessionStorage:session};
        vm.runInNewContext(source,context);
        for(const key of ['warehouse-sort-pending-1','warehouse-collection-1','presortPending','warehouse-inventory-admin-pending-1','warehouse-page-back']) assert.equal(session.getItem(key),null,key);
        assert.equal(local.getItem('currentSortId'),null);
        assert.equal(local.getItem('warehouse-language'),'pl');assert.equal(local.getItem('warehouse-theme'),'dark');
        assert.equal(session.getItem('unrelated'),'keep');
        session.setItem('warehouse-sort-pending-1','new');
        vm.runInNewContext(source,context);
        assert.equal(session.getItem('warehouse-sort-pending-1'),'new');
    }
});
test('disabled browser storage does not break page startup',()=>{
    const denied={getItem(){throw Error('denied');}};
    assert.doesNotThrow(()=>vm.runInNewContext(source,{localStorage:denied,sessionStorage:denied}));
});
