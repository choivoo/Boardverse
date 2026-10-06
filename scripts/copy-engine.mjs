// Copies ONLY the Stockfish 19 "lite single-thread" build (+ license) from node_modules into public/engine (git-ignored, generated).
// Runs before dev/build. The engine is GPL-3.0 -> see THIRD_PARTY_NOTICES.md.
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = join('node_modules', 'stockfish'), dst = join('public', 'engine');
if (!existsSync(join(src, 'bin', 'stockfish-19-lite-single.wasm'))) { console.error('stockfish package missing: run npm install'); process.exit(1); }
const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
if (pkg.version !== '19.0.0' || pkg.license !== 'GPL-3.0') { console.error(`unexpected stockfish package ${pkg.version} / ${pkg.license}; review licensing before shipping`); process.exit(1); }
mkdirSync(dst, { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) copyFileSync(join(src, 'bin', f), join(dst, f));
copyFileSync(join(src, 'Copying.txt'), join(dst, 'COPYING.txt'));
console.log('engine copied: Stockfish.js', pkg.version, pkg.license);
