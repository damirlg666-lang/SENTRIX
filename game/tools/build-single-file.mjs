// Bundles the whole game (code, three.js, Rapier, styles and the model worker) into one
// self-contained HTML file that opens straight from disk or can be pasted into a site
// builder's "embed code" box.
//
//   npm install --no-save esbuild
//   node tools/build-single-file.mjs            -> ragdoll-sandbox.html
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'ragdoll-sandbox.html');

// the same mapping as the import map in index.html
const vendor = {
  name: 'vendor',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: path.join(root, 'vendor/three/three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: path.join(root, 'vendor/three/addons', a.path.slice('three/addons/'.length)) }));
    b.onResolve({ filter: /^rapier$/ }, () => ({ path: path.join(root, 'vendor/rapier/rapier.mjs') }));
  },
};

const bundle = async (entry, format) => {
  const r = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format,
    minify: true,
    target: 'es2022',
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
    plugins: [vendor],
  });
  // nothing inside an inline <script> may close the tag early
  return r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
};

const [main, worker, css, html] = await Promise.all([
  bundle('js/main.js', 'esm'),
  bundle('js/characters/modelWorker.js', 'iife'),
  fs.readFile(path.join(root, 'css/style.css'), 'utf8'),
  fs.readFile(path.join(root, 'index.html'), 'utf8'),
]);

const notice = '<!-- Ragdoll Sandbox, single-file build. Includes three.js (MIT License, Copyright 2010-2025 three.js authors) and Rapier (Apache License 2.0, Copyright 2020 Dimforge EURL). -->';
const head = [
  `<style>\n${css}</style>`,
  `<script id="model-worker" type="text/plain">${worker}</script>`,
  '<script>try{globalThis.MODEL_WORKER_URL=URL.createObjectURL(new Blob([document.getElementById("model-worker").textContent],{type:"text/javascript"}))}catch(e){}</script>',
].join('\n');

// The game code is gzipped and base64-encoded (less than half the size, which matters when
// pasting into an embed box); a tiny loader unpacks it and runs it as a module script.
const packed = gzipSync(Buffer.from(main), { level: 9 }).toString('base64');
const loader = `<script id="game-code" type="text/plain">${packed}</script>
<script>(async()=>{const b=Uint8Array.from(atob(document.getElementById("game-code").textContent),c=>c.charCodeAt(0));const code=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();const s=document.createElement("script");s.type="module";s.textContent=code;document.body.appendChild(s)})().catch(e=>{const f=document.getElementById("fatal");f.classList.remove("hidden");f.textContent="Failed to start: "+e.message})</script>`;

const assemble = (headPart, loaderPart) =>
  html
    .replace(/<link rel="stylesheet" href="css\/style\.css">/, () => headPart)
    .replace(/<script type="importmap">[\s\S]*?<\/script>/, '')
    .replace(/<script type="module" src="js\/main\.js"><\/script>/, () => loaderPart)
    .replace('<!doctype html>', `<!doctype html>\n${notice}`);

// The page can rebuild its own source to open itself in a new tab (an embed that may not go
// full screen does that instead). The two big scripts are left as placeholders in that copy and
// filled in from the running page, so the file does not carry everything twice.
const shell = assemble(head.replace(worker, '%%WORKER%%'), loader.replace(packed, '%%GAME%%'));
const selfSource = `<script id="page-shell" type="application/json">${JSON.stringify(shell).replace(/<\//g, '<\\/')}</script>
<script>window.PAGE_SOURCE=()=>JSON.parse(document.getElementById("page-shell").textContent).replace("%%WORKER%%",()=>document.getElementById("model-worker").textContent).replace("%%GAME%%",()=>document.getElementById("game-code").textContent)</script>`;
const page = assemble(head + '\n' + selfSource, loader);
if (page.includes('src="js/main.js"') || page.includes('importmap')) throw new Error('index.html changed shape; update the build script');
await fs.writeFile(out, page);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(page.length / 1048576).toFixed(2)} MB)`);
