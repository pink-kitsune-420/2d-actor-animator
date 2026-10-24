import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { files, sitePath, inspectText, manifest } from './release-files.mjs';
const out = resolve('_site');
const assets = [...new Set(['index.html','actor-tools.html'].flatMap(path =>
  [...readFileSync(resolve('dist',path),'utf8').matchAll(/(?:href|src)=["']\.\/(assets\/[^"']+)["']/g)].map(m=>m[1])))].sort();
assert.deepEqual(files('dist/assets').map(p=>'assets/'+p).sort(),assets,'Unused or unexpected build assets');
const selected = [
  'index.html','actor-tools.html',
  ...assets,
  ...files('dist/runtime').map(p=>'runtime/'+p),
  ...files('dist/runtime-example').map(p=>'runtime-example/'+p),
  ...files('dist/spacelab-example').map(p=>'spacelab-example/'+p),
  ...files('dist/rendering-example').map(p=>'rendering-example/'+p),
  ...files('dist/sheet-example').map(p=>'sheet-example/'+p),
];
// Reject additions before clearing/creating output. Never copy dist wholesale.
for (const path of selected) assert.ok(sitePath(path), `Unreviewed Pages input: ${path}`);
rmSync(out,{recursive:true,force:true}); mkdirSync(out,{recursive:true});
function copy(src,path) {
  assert.ok(sitePath(path),`Unexpected site path: ${path}`);
  const content=readFileSync(src); assert.deepEqual(inspectText(content.toString(),path),[]);
  assert.ok(!/sourceMappingURL|private-docs|KICKOFF\.txt|AGENTS\.md/.test(content.toString()),`Private context or source map in ${path}`);
  mkdirSync(dirname(resolve(out,path)),{recursive:true}); copyFileSync(src,resolve(out,path));
}
for (const path of selected) copy(resolve('dist',path),path);
for (const name of ['LICENSE','CREDITS.md','UPSTREAM.json']) copy(name,name);
copy('dist/2D Actor Animator.html','downloads/2D Actor Animator.html');
copy('examples/spacelab/beacon.actorproject','examples/beacon.actorproject');
// Served index gets a compact delivery footer; offline copy retains its own notices.
const index=resolve(out,'index.html');
writeFileSync(index,readFileSync(index,'utf8').replace('</body>',`<footer style="padding:12px 20px;color:#baddf3"><p><a style="color:inherit" href="./downloads/2D%20Actor%20Animator.html" download>Download offline HTML</a> · <a style="color:inherit" href="./examples/beacon.actorproject" download>Editable beacon example</a> · <a style="color:inherit" href="./runtime-example/">Runtime demo</a> · <a style="color:inherit" href="./rendering-example/">Rendering demo</a> · <a style="color:inherit" href="./sheet-example/">Sheet consumer</a> · <a style="color:inherit" href="./LICENSE">MIT license</a> · <a style="color:inherit" href="./CREDITS.md">Credits</a></p></footer></body>`));
writeFileSync(resolve(out,'.nojekyll'),'');
// Prove every local HTML/CSS/JS reference resolves within the staged site.
for (const path of files(out)) {
  assert.ok(sitePath(path),path);
  if (path === 'downloads/2D Actor Animator.html' || !/\.(?:html|css|mjs|js)$/.test(path)) continue;
  const text=readFileSync(resolve(out,path),'utf8');
  const references = path.endsWith('.html')
    ? [...text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map(m=>m[1])
    : [...text.matchAll(/(?:^|[;\n])\s*(?:import|export)\s*[^;]*?\bfrom\s*["']([^"']+)["']/g)].map(m=>m[1]);
  for (const reference of references) {
    let link=reference;
    if (link.startsWith('@')) {
      const html=readFileSync(resolve(out,dirname(path),'index.html'),'utf8');
      const mapping=html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
      assert.ok(mapping,`Missing import map for ${path}`);
      link=JSON.parse(mapping[1]).imports[link];
      assert.ok(typeof link==='string'&&link.startsWith('./package/'),`Unreviewed import map for ${path}`);
    } if (/^(?:https?:|data:|blob:|#)/.test(link)) continue;
    assert.ok(!link.startsWith('/'),`Root-relative site link: ${path}`);
    const target=new URL(link,'https://site.invalid/2d-actor-animator/'+path);
    assert.ok(target.pathname.startsWith('/2d-actor-animator/'),`Escaping site link: ${path}`);
    const rel=decodeURIComponent(target.pathname.slice('/2d-actor-animator/'.length));
    assert.ok(files(out).includes(!rel||rel.endsWith('/')?rel+'index.html':rel),`Missing site link ${path} -> ${link}`);
  }
}
mkdirSync('release-artifacts',{recursive:true});
writeFileSync('release-artifacts/pages-manifest.json',JSON.stringify(manifest(out),null,2)+'\n');
console.log(`PASS: staged ${files(out).length} allowlisted Pages files; relative links checked. No upload performed.`);
