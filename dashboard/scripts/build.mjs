import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const manifestURL=new URL('.openai/hosting.json',root);
let manifest;
try{manifest=JSON.parse(await readFile(manifestURL,'utf8'));}catch{throw new Error('Sites registration is required: save the returned project_id in dashboard/.openai/hosting.json first.');}
if(typeof manifest.project_id!=='string' || !manifest.project_id)throw new Error('A server-returned Sites project_id is required.');
if(manifest.static)throw new Error('This dashboard needs a server Worker. Remove a stale static declaration before building.');
const source=await readFile(new URL('worker/index.js',root),'utf8');
const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
if(typeof module.default?.fetch!=='function')throw new Error('Missing Worker fetch export.');
const dist=new URL('dist/',root);
await rm(dist,{recursive:true,force:true});
await mkdir(new URL('server/',dist),{recursive:true});
await mkdir(new URL('.openai/',dist),{recursive:true});
await writeFile(new URL('server/index.js',dist),source);
await copyFile(manifestURL,new URL('.openai/hosting.json',dist));
console.log('Worker ESM build verified: '+fileURLToPath(dist));
