import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FileBlob,PresentationFile} from 'file:///C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const b=path.dirname(fileURLToPath(import.meta.url));
const p=await PresentationFile.importPptx(await FileBlob.load(path.resolve(b,'../output/Warehouse_System_Industrial_Style.pptx')));
await fs.mkdir(path.join(b,'final-renders'),{recursive:true});
for(let i=0;i<p.slides.items.length;i++){const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(b,'final-renders',String(i+1).padStart(2,'0')+'.png'),new Uint8Array(await blob.arrayBuffer()));console.log('final',i+1)}
