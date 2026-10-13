import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const modules=['app','core','planner','storage','config'];
for(const name of modules){const r=spawnSync(process.execPath,['--check',`dist/${name}.mjs`],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);}
const html=await readFile('dist/index.html','utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)throw new Error('Duplicate HTML IDs');
const script=await readFile('dist/app.mjs','utf8');
for(const m of script.matchAll(/\$\('([^']+)'\)/g)){if(!ids.includes(m[1])&&!['save-selected','export-selected','share-selected'].includes(m[1]))throw new Error(`Missing app element: ${m[1]}`);}
for(const m of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))await access(`dist/${m[1]}`);
const manifest=JSON.parse(await readFile('dist/manifest.webmanifest','utf8'));if(manifest.start_url!=='./')throw new Error('Manifest must work on repository subpaths');
for(const name of ['leaflet.js','leaflet.css','LICENSE-Leaflet'])await access(`dist/vendor/${name}`);
console.log('Static assets, module syntax, app element bindings, and repository-relative paths checked.');
