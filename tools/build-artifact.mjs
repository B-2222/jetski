// Builds dist/rooster-tail.html: one self-contained page with the game and three.js
// (plus its post-processing add-ons) bundled and inlined. Run `npm install` first, then:
//   node tools/build-artifact.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist'), { recursive: true });
const esbuild = process.env.ESBUILD || join(root, 'node_modules/.bin/esbuild');
const args = ['src/main.js', '--bundle', '--format=esm', '--minify', '--target=es2020', '--outfile=dist/bundle.js'];
execFileSync(esbuild, args, { cwd: root, stdio: 'inherit' });

let html = readFileSync(join(root, 'index.html'), 'utf8');
const bundle = readFileSync(join(root, 'dist/bundle.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
// the artifact host supplies doctype, html/head/body, charset and viewport
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace('<script type="module" src="./src/main.js"></script>', () => `<script type="module">\n${bundle}\n</script>`);
writeFileSync(join(root, 'dist/rooster-tail.html'), html);
console.log('wrote dist/rooster-tail.html', (html.length / 1024).toFixed(0), 'KB');
