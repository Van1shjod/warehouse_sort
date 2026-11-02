// UI-only localization: never change form values, API payloads or stored records.
(() => {
    'use strict';
    const languages = {uk:'Українська',en:'English',pl:'Polski',ru:'Русский'};
    const key = 'warehouse-language';
    const catalog = window.warehouseTranslations || [];
    const exact = new Map(), patterns = [];
    for (const row of catalog) {
        if (row[0].includes('{')) {
            const names=[];
            const escaped=row[0].split(/(\{\d+\})/).map(part => {
                if (/^\{\d+\}$/.test(part)) {
                    names.push(part);
                    const numeric=['{0} із {1}','{0} картонів','{0} палет','{0} шт.','{0} (закрито: {1})'].includes(row[0]);
                    return numeric ? '([0-9]+)' : '([^\\n·•|]*?)';
                }
                return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
            }).join('');
            patterns.push({regex:new RegExp('^'+escaped+'$'),names,row});
        } else exact.set(row[0],row);
    }
    let language='uk', select;
    const originals=new WeakMap();
    const attrs=['placeholder','title','aria-label','alt','data-label'];
    const skip='script,style,code,pre,textarea,[contenteditable], [data-no-translate],.username,#work-sort-name,#current-sort-name,#job-details';
    function translate(value, depth=0) {
        const raw=String(value ?? '');
        if (language==='uk' || !raw.trim()) return raw;
        const text=raw.trim(), index={en:1,pl:2,ru:3}[language];
        let result;
        if (exact.has(text)) result=exact.get(text)[index];
        else {
            const decorated=/^([^\p{L}\p{N}]+)([\s\S]+)$/u.exec(text);
            if(depth<3 && decorated) {
                const core=translate(decorated[2],depth+1);
                if(core!==decorated[2]) result=decorated[1]+core;
            }
            for (const {regex,names,row} of patterns) {
                if(result!==undefined) break;
                const match=regex.exec(text);
                if (!match) continue;
                result=row[index].replace(/\{\d+\}/g,name=>{
                    const value=match[names.indexOf(name)+1] ?? name;
                    return row[0]==='Не розпізнано: {0}' ? value.split(', ').map(part=>translate(part,depth+1)).join(', ') : value;
                });
                if(['{0} картонів','На палеті: {0} картонів','На палетах: {0} картонів'].includes(row[0]) && /^\d+$/.test(match[1])) {
                    const plural=new Intl.PluralRules(language).select(Number(match[1]));
                    const units={en:{one:'carton',other:'cartons'},pl:{one:'karton',few:'kartony',many:'kartonów',other:'kartonu'},ru:{one:'картон',few:'картона',many:'картонов',other:'картона'}};
                    result=result.replace(/cartons|kartonów|картонов/g,units[language][plural] || units[language].other);
                }
                break;
            }
        }
        if (result===undefined && depth<3) {
            // Preserve dynamic identifiers; translate only complete UI phrases/labels.
            const parts=text.split(/(\n| · | • | \| )/);
            if(parts.length>1) result=parts.map(part=>translate(part,depth+1)).join('');
            else {
                const decorated=/^([^\p{L}\p{N}]*)([\s\S]+)$/u.exec(text);
                if(decorated?.[1]) result=decorated[1]+translate(decorated[2],depth+1);
                else {
                    const suffix=/^([\s\S]*?)(\s*[:*!✓➜]+)$/.exec(text);
                    if(suffix?.[1]) result=translate(suffix[1],depth+1)+suffix[2];
                }
            }
        }
        return raw.slice(0,raw.indexOf(text))+(result ?? text)+raw.slice(raw.indexOf(text)+text.length);
    }
    function localize(node, attribute) {
        const current=attribute ? node.getAttribute(attribute) : node.nodeValue;
        if(current===null) return;
        let records=originals.get(node);
        if(!records) {records=new Map();originals.set(node,records);}
        const k=attribute || 'text';
        let record=records.get(k);
        if(!record || current!==record.rendered) record={source:current,rendered:current};
        let source=record.source;
        const protectedBy=(node.nodeType===1 ? node : node.parentElement)?.closest('[data-i18n-protected]');
        let protectedValues=[];
        try {protectedValues=JSON.parse(protectedBy?.dataset.i18nProtected || '[]').filter(value=>typeof value==='string' && value);} catch (_) {}
        const tokens=protectedValues.map((value,index)=>({value,token:'\uE000WAREHOUSE'+index+'\uE001'}));
        for(const {value,token} of tokens) source=source.split(value).join(token);
        let rendered=translate(source);
        for(const {value,token} of tokens) rendered=rendered.split(token).join(value);
        records.set(k,{source:record.source,rendered});
        if(current!==rendered) {
            if(attribute) node.setAttribute(attribute,rendered);
            else node.nodeValue=rendered;
        }
    }
    function walk(root) {
        if(root.nodeType===3) {
            if(!root.parentElement?.closest(skip)) localize(root);
            return;
        }
        if(root.nodeType!==1) return;
        if(root.matches(skip)) {
            if(root.hasAttribute('data-label')) localize(root,'data-label');
            if(root.matches('textarea')) for(const attribute of attrs) if(root.hasAttribute(attribute)) localize(root,attribute);
            return;
        }
        for(const attribute of attrs) if(root.hasAttribute(attribute)) localize(root,attribute);
        for(const child of root.childNodes) walk(child);
    }
    function setLanguage(value,save=false) {
        language=Object.hasOwn(languages,value) ? value : 'uk';
        document.documentElement.lang=language;
        if(select) select.value=language;
        if(document.body) walk(document.body);
        if(document.title) {
            const title=document.querySelector('title');
            if(title?.firstChild) localize(title.firstChild);
        }
        if(save) try {localStorage.setItem(key,language);} catch (_) {}
        window.dispatchEvent(new CustomEvent('warehouse-language-change',{detail:language}));
    }
    try {const saved=localStorage.getItem(key);if(Object.hasOwn(languages,saved))language=saved;} catch (_) {}
    document.documentElement.lang=language;
    window.warehouseI18n={t:translate,setLanguage,get language(){return language;}};
    for(const name of ['alert','confirm','prompt']) {
        const original=window[name];
        window[name]=function(message,...args){return original.call(window,translate(message),...args);};
    }
    document.addEventListener('DOMContentLoaded',()=>{
        if(document.body.classList.contains('login-page')) {
            select=document.createElement('select');
            select.className='language-select';
            select.setAttribute('aria-label','Мова інтерфейсу');
            for(const [value,label] of Object.entries(languages)) select.add(new Option(label,value));
            select.addEventListener('change',()=>setLanguage(select.value,true));
            const holder=document.createElement('div');holder.className='language-control';holder.append(select);
            document.body.classList.add('has-language-control');document.body.append(holder);
        }
        setLanguage(language);
        const observer=new MutationObserver(records=>{
            for(const record of records) {
                if(record.type==='childList') for(const child of record.addedNodes) walk(child);
                else if(record.type==='characterData') walk(record.target);
                else if(!record.target.closest(skip)) localize(record.target,record.attributeName);
            }
        });
        observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attrs});
    });
    window.addEventListener('storage',event=>{
        if(event.key===key || event.key===null) setLanguage(event.newValue);
    });
})();
