// Strict static test server: no SPA/dev fallback, no access outside the mount.
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
const port=Number(process.env.ANIMATOR_TEST_PORT);
if (!Number.isInteger(port)||port<1024||port>65535) throw Error('Set a valid owned ANIMATOR_TEST_PORT.');
const root=resolve('_site'), mount='/2d-actor-animator/';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.actorproject':'application/json','.png':'image/png'};
const server=createServer((req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if (!url.pathname.startsWith(mount)) {res.writeHead(404).end();return;}
    const path=resolve(root,decodeURIComponent(url.pathname.slice(mount.length)) || '.');
    if (path!==root&&!path.startsWith(root+sep)) {res.writeHead(404).end();return;}
    const file=statSync(path).isDirectory()?resolve(path,'index.html'):path;
    const bytes=readFileSync(file); res.writeHead(200,{'Content-Type':types[extname(file)]??'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(bytes);
  } catch {res.writeHead(404).end();}
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Strict static Pages test mount http://127.0.0.1:${port}${mount}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
