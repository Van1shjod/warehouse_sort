import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Presentation,PresentationFile} from 'file:///C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
import {finalizePresentation} from 'file:///C:/Users/Lenovo/.codex/plugins/cache/openai-primary-runtime/presentations/26.1020.11127/skills/presentations/container_tools/artifact_tool_utils.mjs';
const require=createRequire('file:///C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const sharp=require('sharp');
const BUILD=path.dirname(fileURLToPath(import.meta.url)),PARENT=path.dirname(BUILD),ROOT=path.resolve(PARENT,'../..');
const SKILL='C:/Users/Lenovo/.codex/plugins/cache/openai-primary-runtime/presentations/26.1020.11127/skills/presentations';
const RUNTIME='C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies';
const F={head:'Bahnschrift',body:'Arial',mono:'Consolas'};
const C={black:'#111716',white:'#F2F3EF',muted:'#596360',blue:'#008FAE',orange:'#D7641C',darkmuted:'#A9B7B4'};
const p=Presentation.create({slideSize:{width:1600,height:900}});
const cache=new Map();
async function asset(s,file,x,y,w,h,fit='contain'){
 if(!cache.has(file)){const b=await fs.readFile(file),m=await sharp(b).metadata();cache.set(file,{b,m})}
 const {b,m}=cache.get(file);let iw=w,ih=h;if(fit==='contain'){const z=Math.min(w/m.width,h/m.height);iw=m.width*z;ih=m.height*z}
 return s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:'image/png',alt:path.basename(file),fit,position:{left:x+(w-iw)/2,top:y+(h-ih)/2,width:iw,height:ih}});
}
const shot=(s,n,x,y,w,h)=>asset(s,path.join(PARENT,'.build/shots',n+'.png'),x,y,w,h);
const bg=(s,n)=>asset(s,path.join(PARENT,'portal-assets',n+'.png'),0,0,1600,900,'cover');
function t(s,text,x,y,w,h,size=28,color=C.black,bold=false,font=F.body){const a=s.shapes.add({geometry:'textbox',name:text.slice(0,55),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});a.text=text;a.text.style={typeface:font,fontSize:size,bold,color,insets:0,autoFit:'none',wrap:'square',verticalAlignment:'top'};return a}
function meta(s,number,dark=false,caption){const c=dark?C.darkmuted:C.muted;t(s,'WAREHOUSE SYSTEM',70,44,1000,28,19,c,false,F.mono);t(s,String(number).padStart(2,'0')+' / 31',1360,44,170,28,19,c,false,F.mono);t(s,caption||'СКРИНШОТИ САЙТУ / ДЕМОНСТРАЦІЙНІ ДАНІ',70,853,1310,27,16,c,false,F.mono)}
async function header(title,number,mod,accent=C.blue){const s=p.slides.add();await bg(s,'warehouse-light');meta(s,number);t(s,String(number).padStart(2,'0'),65,100,170,140,108,accent,false,F.head);t(s,mod.toUpperCase(),245,104,1220,25,18,C.muted,false,F.mono);t(s,title,242,143,1280,90,title.length>42?47:56,C.black,true,F.head);return s}
function textCol(s,body,x,y,w,{size=27,step=158,accent=C.blue}={}){body.forEach((v,i)=>{t(s,String(i+1).padStart(2,'0'),x,y+i*step,44,32,18,accent,false,F.mono);t(s,v,x+55,y+i*step-4,w-55,step-20,size,C.black)})}
const original=JSON.parse(await fs.readFile(path.join(PARENT,'.build/slide-content.json'),'utf8'));
const titles=['Допуск до системи','Два робочі режими','Зона. Завдання. Тип товару.','Ідентифікація Single','Кількість і координати палети','Повний код Mix','Розвантаження по палетах','Один скан. Один картон.','Зчитування наклейки','Підтвердження збереження','Палети розвантаження','Завершення етапу Pre-sort','Координати товару','Налаштування завдання','Статуси й керування','Контроль сортування','Завершені позиції','Реєстр палет /lider','Коригування ICC','Облікові записи','Новий користувач','Журнал дій','Журнал OCR','Фото та результат OCR','Контейнери й працівники','Мобільне робоче місце','Журнал технічного стану'];
original[16].body[1]='Перегляд показує завершені товари. Автозавантаження цієї вкладки потребує доробки.';
original[7].body=['Повне розпізнавання одразу зберігає один картон. Неповні дані можна виправити.','30 PACK описує товар, а сканування у Pre-sort додає одну одиницю.','Дозволені типи Single, Mix і Vevor задає адміністратор.'];
const chapters=new Map([
 [6,{n:'02',title:'Облік\nрозвантаження',sub:'PRE-SORT',desc:'Кожен картон отримує місце\nв обліку палети.',items:'СКАНУВАННЯ / ПАЛЕТИ / ПІДТВЕРДЖЕННЯ'}],
 [13,{n:'03',title:'Контроль\nскладських\nоперацій',sub:'АДМІНІСТРАТОР',desc:'Завдання, товари й відповідальність\nу спільному робочому просторі.',items:'ЗАВДАННЯ / КОРИСТУВАЧІ / ІСТОРІЯ'}],
 [22,{n:'04',title:'Наклейка\nстає даними',sub:'OCR',desc:'Оригінальна фотографія\nпоруч із результатом розпізнавання.',items:'ФОТО / РЕЗУЛЬТАТ / ПЕРЕВІРКА'}]
]);
let number=1;
const cover=p.slides.add();await bg(cover,'warehouse-cover');
t(cover,'WS / WAREHOUSE SYSTEM',70,60,950,35,24,C.muted,false,F.mono);
t(cover,'ПРОТОКОЛ\nСКЛАДСЬКИХ\nОПЕРАЦІЙ',66,190,820,340,77,C.black,true,F.head);
t(cover,'Розвантаження.\nСортування. Контроль.',72,572,650,126,36,C.muted,false,F.head);
t(cover,'ОГЛЯД ФУНКЦІОНАЛУ',72,775,650,30,20,C.blue,false,F.mono);
t(cover,'РЕДАКЦІЯ 02 / 22.10.2026',72,827,650,25,17,C.muted,false,F.mono);
cover.speakerNotes.text='Оригінальний дизайн Warehouse System у стриманій науково-технічній естетиці. Ілюстрація створена генератором зображень та відокремлена від справжніх скриншотів. Референс користувача стосувався лише загального настрою лабораторних презентацій Portal, без копіювання назв, ігрової символіки чи сцен. Функції: поточний код app.py, database.py, presort.py та шаблони застосунку.';
for(let i=0;i<original.length;i++){
 if(chapters.has(i)){
  const d=chapters.get(i);number++;const s=p.slides.add();await bg(s,'warehouse-dark');meta(s,number,true,'WS / ОПЕРАЦІЙНИЙ ПРОТОКОЛ');
  t(s,d.n,65,108,240,130,112,C.orange,false,F.head);t(s,d.sub,75,290,1000,28,22,'#20B2D3',false,F.mono);t(s,d.title,70,349,1010,310,76,C.white,true,F.head);t(s,d.desc,75,680,920,94,30,C.darkmuted);s.speakerNotes.text='Розділювач теми. Авторська ілюстрація коробок і логістичних маршрутів. '+d.items;
 }
 const d=original[i];number++;const accent=i>=6&&i<13?C.orange:C.blue;
 const mod=i<6?'01 / РОБОЧИЙ ПРОСТІР':i<13?'02 / ОБЛІК РОЗВАНТАЖЕННЯ':i<22?'03 / КОНТРОЛЬ СКЛАДУ':'04 / ДАНІ ТА ІНТЕРФЕЙС';
 const s=await header(titles[i],number,mod,accent);
 if(i===0){textCol(s,d.body,70,300,490,{size:27,step:150});await shot(s,'login',610,245,420,535);await shot(s,'register',1080,245,420,535)}
 else if(i===2){textCol(s,d.body,70,290,500,{size:27,step:155});await shot(s,'sort-selection',620,255,680,495);await shot(s,'types',1340,255,190,495)}
 else if(i===4){textCol(s,d.body,70,290,490,{size:27,step:155});await shot(s,'quantity',620,260,420,530);await shot(s,'location',1090,240,420,550)}
 else if(i===7){t(s,'1',65,235,260,260,235,accent,false,F.head);t(s,'СКАНУВАННЯ',75,500,420,34,24,C.muted,false,F.mono);t(s,'ОДИН КАРТОН',75,552,490,63,43,C.black,true,F.head);t(s,'30 PACK',75,665,490,50,35,C.black,true,F.head);t(s,'Характеристика наклейки,\nа не кількість за сканування.',75,722,490,94,26,C.muted);await shot(s,d.image,620,245,900,570)}
 else if(i===10||i===12||i===16||i===17){t(s,d.body[0],75,255,1430,85,31,C.black,false,F.head);await shot(s,d.image,75,355,1450,315);t(s,d.body[1],75,710,680,112,25,C.muted);t(s,d.body[2],830,710,680,112,25,C.muted)}
 else if(i===8||i===13||i===18||i===23){textCol(s,d.body,75,300,650,{size:29,step:165,accent});await shot(s,d.image,820,235,660,585)}
 else if(i===25){textCol(s,d.body,75,300,570,{size:28,step:160});await shot(s,d.images[0],760,235,330,555);await shot(s,d.images[1],1170,235,330,555)}
 else if(i===26){textCol(s,d.body,75,270,820,{size:27,step:137,accent:C.orange});await shot(s,d.image,950,425,570,150)}
 else {const nearFull=['sorting','users','ocr','pallets'].includes(d.image);textCol(s,d.body,75,285,nearFull?440:500,{size:nearFull?26:28,step:162,accent});await shot(s,d.image,nearFull?550:625,245,nearFull?970:895,540)}
 if(d.caption)t(s,d.caption,70,824,1360,24,15,C.muted);
 if(i===16){t(s,'НАВІГАЦІЯ ВКЛАДКИ ПОТРЕБУЄ ДОРОБКИ',75,805,1430,25,16,C.orange,false,F.mono)}
 s.speakerNotes.text='Джерело функціоналу: '+d.source+'. Скриншоти: '+(d.image||d.images.join(', '))+'. Використано справжній інтерфейс сайту на окремій демонстраційній базі. Облікові значення є прикладами. '+(d.caption||'')+(i===16?' Для знімка явно викликано наявну loadCompletedData. Автозавантаження вкладки потребує виправлення.':'');
}
await fs.mkdir(path.join(BUILD,'renders'),{recursive:true});
await (await PresentationFile.exportPptx(p)).save(path.join(BUILD,'draft.pptx'));
for(let i=0;i<p.slides.items.length;i++){const b=await p.export({slide:p.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(BUILD,'renders',String(i+1).padStart(2,'0')+'.png'),new Uint8Array(await b.arrayBuffer()));console.log('render',i+1)}
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:path.join(BUILD,'draft.pptx'),finalPath:path.join(PARENT,'output/Warehouse_System_Industrial_Style.pptx'),pythonExecutable:path.join(RUNTIME,'python/python.exe'),integrityValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-bullet-geometry','--validate-heading-fit'],fontPolicy:{basis:'design',families:[F.head,F.body,F.mono]},verifyArtifactToolImport:true,receiptPath:path.join(BUILD,'validation.json')});console.log(JSON.stringify({file:result.finalPath,slides:p.slides.items.length,integrity:result.packageIntegrity.status,layout:result.presentationLayout.findingCount}));
