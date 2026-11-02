const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(saved='uk',denied=false){
    const storage=new Map([['warehouse-language',saved]]),events={};
    const app={document:{documentElement:{},body:null,title:'',addEventListener(){}},
        localStorage:{getItem:k=>{if(denied)throw Error('denied');return storage.get(k);},setItem:(k,v)=>{if(denied)throw Error('denied');storage.set(k,v);}},
        alert:v=>v,confirm:v=>v,prompt:v=>v,dispatchEvent(){},addEventListener:(k,v)=>events[k]=v,
        CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
    app.window=app;
    vm.createContext(app);
    for(const f of ['i18n-catalog.js','i18n.js'])vm.runInContext(fs.readFileSync('static/'+f,'utf8'),app);
    return {app,storage,events,i18n:app.warehouseI18n};
}
test('every catalog row has four nonempty languages and identical placeholders',()=>{
    const {app}=setup();
    for(const row of app.warehouseTranslations){
        assert.equal(row.length,4,row[0]);
        for(const value of row){
            assert(value.trim(),row[0]);
            assert.deepEqual(Array.from(value.matchAll(/\{\d+\}/g),m=>m[0]).sort(),Array.from(row[0].matchAll(/\{\d+\}/g),m=>m[0]).sort(),row[0]);
        }
    }
});
test('saved language, native confirmations and safe fallback work in all languages',()=>{
    for(const [lang,add] of [['uk','Додати'],['en','Add'],['pl','Dodaj'],['ru','Добавить']]){
        const {i18n,app}=setup(lang);
        assert.equal(i18n.t('Додати'),add);
        assert.equal(app.document.documentElement.lang,lang);
        assert.equal(app.confirm('Додати'),add);
        assert.equal(i18n.t('4567 JP-A 30 PACK'),'4567 JP-A 30 PACK');
        assert.equal(i18n.t('Unknown server message'),'Unknown server message');
    }
});
test('dynamic messages preserve data and translate complete UI phrases',()=>{
    const {i18n}=setup('en');
    assert.equal(i18n.t('  📷 Сканувати  '),'  📷 Scan  ');
    assert.equal(i18n.t('Товарів: 2 · Палет: 3 · На палетах: 4 картонів'),'Products: 2 · Pallets: 3 · On pallets: 4 cartons');
    assert.equal(i18n.t('Підтвердити ✓'),'Confirm ✓');
    assert.equal(i18n.t('Товари із описом'),'Товари із описом');
    assert.equal(i18n.t('Зібрано у <img onerror=x>'),'Held by <img onerror=x>');
    assert.equal(i18n.t('✓ Усі потрібні картони\nз палети № 4 забрано'),'✓ All required cartons\ncollected from pallet No. 4');
});
test('language can change without storage and follows other tabs or reset',()=>{
    const denied=setup('en',true);
    assert.equal(denied.i18n.language,'uk');
    denied.i18n.setLanguage('pl',true);
    assert.equal(denied.i18n.t('Назад'),'Wstecz');
    const {i18n,storage,events}=setup('en');
    i18n.setLanguage('ru',true);
    assert.equal(storage.get('warehouse-language'),'ru');
    events.storage({key:'warehouse-language',newValue:'pl'});
    assert.equal(i18n.language,'pl');
    events.storage({key:null,newValue:null});
    assert.equal(i18n.language,'uk');
    i18n.setLanguage('__proto__');
    assert.equal(i18n.language,'uk');
});
