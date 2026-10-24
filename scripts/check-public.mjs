// First-party release guard: review exact reachable history as well as the tree.
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { sourcePath, inspectText } from './release-files.mjs';
const git = (...args) => execFileSync('git', args, {encoding:'utf8',maxBuffer:16*1024*1024});
const ref = process.argv[2] ?? 'HEAD';
const problems = [], objects = new Map();
const commits = git('rev-list',ref).trim().split('\n');
for (const commit of commits) {
  problems.push(...inspectText(git('show','-s','--format=fuller',commit),`commit ${commit}`));
  for (const row of git('ls-tree','-rz','--full-tree',commit).split('\0').filter(Boolean)) {
    const [meta,path] = row.split('\t'), [mode,type,oid] = meta.split(' ');
    if (!sourcePath(path)) problems.push(`${commit}: forbidden historical path ${path}`);
    if (type !== 'blob' || !['100644','100755'].includes(mode)) problems.push(`${commit}: unsupported historical file type ${path}`);
    objects.set(oid,path);
  }
}
for (const [oid,path] of objects) problems.push(...inspectText(git('cat-file','blob',oid),path));
// Include intended, not-yet-committed edits in local preparation. Ignored data
// never enters this list. Final source archive always comes from an exact ref.
const paths = git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean);
for (const path of paths) {
  if (!sourcePath(path)) { problems.push(`forbidden source path ${path}`); continue; }
  if (!lstatSync(path).isFile()) { problems.push(`unsupported source type ${path}`); continue; }
  problems.push(...inspectText(readFileSync(path,'utf8'),path));
}
for (const path of ['package.json','packages/runtime/package.json']) if (JSON.parse(readFileSync(path,'utf8')).private !== true) problems.push(`${path}: must remain private`);
if (problems.length) { console.error([...new Set(problems)].join('\n')); process.exit(1); }
console.log(`PASS: ${paths.length} source paths, ${commits.length} reachable commits and ${objects.size} unique historical blobs inspected; no forbidden paths, links, host paths or credential signatures. Author identity and content still require human publication review.`);
