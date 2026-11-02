import { chromium } from 'file:///C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const dir=new URL('./shots/',import.meta.url); await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const context=await browser.newContext({viewport:{width:1280,height:850},deviceScaleFactor:1,permissions:['camera']});
const page=await context.newPage();
page.on('dialog', d=>d.accept());
const go=async p=>{await page.goto('http://127.0.0.1:5066'+p);await page.waitForTimeout(500)};
const shot=async(name,selector)=>{await page.waitForTimeout(450);await (selector?page.locator(selector):page).screenshot({path:fileURLToPath(new URL(name+'.png',dir)),animations:'disabled'});console.log(name)};
await go('/'); await shot('login','.login-container');await page.getByRole('button',{name:'Реєстрація',exact:true}).click();await shot('register','.login-container');
await go('/_presentation/enter/2'); await shot('home');
await page.getByRole('button',{name:'SORT',exact:true}).click();await shot('sort-selection','#sort-selection');
await page.evaluate(()=>selectSort(1)); await shot('types','#sort-menu .modal-content');
await page.evaluate(()=>selectType('single')); await page.locator('#icc-code-input').fill('4567');await page.locator('#cartons-count-input').fill('30');await page.locator('#location-code-input').fill('JP-A'); await shot('single','#work-area');
await page.getByRole('button',{name:'Продовжити'}).click();await shot('quantity','#confirmation-modal .modal-content');
await page.locator('#current-quantity-input').fill('6');await page.getByRole('button',{name:'Далі'}).click();await shot('location','#location-modal .modal-content');
await go('/dashboard');await page.evaluate(()=>selectType('mix'));await page.locator('#mix-icc-code-input').fill('D980989');await shot('mix','#work-area');
await go('/dashboard');await page.evaluate(()=>selectType('vevor'));await shot('vevor','#work-area');
await go('/presort');await page.locator('#container').selectOption('2'); await shot('presort');
await page.locator('#code').fill('4567');await page.locator('#location').fill('JP-A');await page.locator('#pack').fill('30');await page.locator('#scan-form button[type=submit]').click();await shot('added');
await page.locator('#camera-scan-btn').click();await shot('camera','#camera-modal .modal-content');await page.locator('#camera-close').click();
await go('/dashboard');await page.evaluate(()=>selectSort(4));await page.evaluate(()=>selectType('single'));await page.locator('#icc-code-input').fill('4567');await page.locator('#cartons-count-input').fill('30');await page.locator('#location-code-input').fill('JP-A');await shot('source','#work-area');
await go('/_presentation/enter/1');await go('/admin');await shot('sorting');
await page.getByRole('button',{name:'Завершені',exact:true}).click();await shot('completed');
await page.getByRole('button',{name:'Палети',exact:true}).click();await shot('pallets');
await page.getByRole('button',{name:'Створити сорт',exact:true}).click();await shot('jobs');
await page.locator('#sort-mode').selectOption('presort');await page.locator('#sort-location-type').selectOption('rampa');await page.locator('#sort-location').selectOption({label:'Rampa 3'});await page.locator('#type-single').check();await page.locator('#type-mix').check();await page.locator('#sort-notes').fill('Розвантаження наступного контейнера');await shot('create-sort','#admin-create-sort > div:nth-of-type(2)');
await page.getByRole('button',{name:'Користувачі',exact:true}).click();await shot('users');
await page.getByRole('button',{name:'Активність',exact:true}).click();await shot('activity');
await page.getByRole('button',{name:'OCR Логи',exact:true}).click();await shot('ocr');
await page.getByRole('button',{name:'Створити акаунт',exact:true}).click();await shot('create-account','#admin-create');
await go('/presort');await page.locator('#container').selectOption('3');await shot('conversion');
await go('/dashboard');await page.setViewportSize({width:390,height:844});await shot('mobile-home');await page.evaluate(()=>selectType('single'));await shot('mobile-single');
await browser.close();



