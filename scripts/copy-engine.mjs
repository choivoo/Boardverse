// Copies ONLY the Stockfish 19 "lite single-thread" build (+ license) from node_modules into public/engine (git-ignored, generated).
// Runs before dev/build. The engine is GPL-3.0 -> see THIRD_PARTY_NOTICES.md.
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const src = join('node_modules', 'stockfish'), dst = join('public', 'engine');
if (process.env.VITE_ENGINE === '0') { // engine-free build: ship only the notices
  rmSync(dst, { recursive: true, force: true }); mkdirSync(dst, { recursive: true }); copyFileSync('THIRD_PARTY_NOTICES.md', join(dst, 'NOTICES.md'));
  console.log('engine DISABLED (VITE_ENGINE=0): no Stockfish files are shipped'); process.exit(0);
}
if (!existsSync(join(src, 'bin', 'stockfish-19-lite-single.wasm'))) { console.error('stockfish package missing: run npm install'); process.exit(1); }
const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
if (pkg.version !== '19.0.0' || pkg.license !== 'GPL-3.0') { console.error(`unexpected stockfish package ${pkg.version} / ${pkg.license}; review licensing before shipping`); process.exit(1); }
mkdirSync(dst, { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) copyFileSync(join(src, 'bin', f), join(dst, f));
copyFileSync(join(src, 'Copying.txt'), join(dst, 'COPYING.txt'));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages['node_modules/stockfish'] ?? {};
copyFileSync('THIRD_PARTY_NOTICES.md', join(dst, 'NOTICES.md')); // served at /engine/NOTICES.md and linked from the Help screen
writeFileSync(join(dst, 'SOURCE.txt'), [
  'Stockfish.js (GPL-3.0) as shipped with Boardverse', '',
  `npm package : stockfish@${pkg.version}  (${lock.resolved ?? 'registry.npmjs.org'})`, `integrity   : ${lock.integrity ?? 'n/a'}`,
  'files       : stockfish-19-lite-single.js, stockfish-19-lite-single.wasm (copied unmodified from the package bin/ folder)',
  ...['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'].map((f) => `sha256      : ${sha(join(dst, f))}  ${f}`), `sha256      : ${sha(join(dst, 'COPYING.txt'))}  COPYING.txt`, '',
  'Corresponding source & build instructions:',
  '  https://github.com/nmrugg/stockfish.js  (tag v19.0.0, see its README section "How do I compile the engine?")',
  '  https://github.com/official-stockfish/Stockfish  (the Stockfish engine itself)', '',
  'Licence text: COPYING.txt (GNU GPL v3).  Boardverse notices: NOTICES.md', ''].join('\n'));
console.log('engine copied: Stockfish.js', pkg.version, pkg.license);
