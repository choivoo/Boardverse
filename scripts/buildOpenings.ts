// Builds src/openingsData.json from the lichess-org/chess-openings TSV files (CC0 / public domain, see README of that repo).
// Usage: npx tsx scripts/buildOpenings.ts <dir-with-a..e.tsv> <source-commit-sha>
// The result is a *name dictionary of known lines* + the continuations that exist between them. It contains NO win/draw/loss
// statistics: we have no game database, and we do not invent numbers.
import { Chess } from 'chess.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const epd = (g: Chess) => g.fen().split(' ').slice(0, 4).join(' ');
const dir = process.argv[2] ?? '/tmp/openings', sha = process.argv[3] ?? 'unknown';
const names: [string, string][] = []; const pos: Record<string, { n?: number; c: string[]; d: number }> = {};
let total = 0, skipped = 0;
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  for (const line of readFileSync(join(dir, `${f}.tsv`), 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue; const [eco, name, pgn] = line.split('\t'); total++;
    const g = new Chess();
    try { g.loadPgn(pgn); } catch { skipped++; continue; }
    const sans = g.history(); const replay = new Chess(); const path: string[] = [epd(replay)];
    const steps: [string, string][] = [];
    for (const san of sans) { const before = epd(replay); replay.move(san); steps.push([before, san]); path.push(epd(replay)); }
    for (const e of path) (pos[e] ??= { c: [], d: 0 }).d++;
    for (const [before, san] of steps) if (!pos[before].c.includes(san)) pos[before].c.push(san);
    const last = pos[path[path.length - 1]]; const idx = names.push([eco, name]) - 1;
    if (last.n === undefined) last.n = idx; // keep the first (shortest-listed) name for a position
  }
}
for (const p of Object.values(pos)) p.c.sort();
const out = { v: 1, source: { repo: 'https://github.com/lichess-org/chess-openings', commit: sha, files: ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'], license: 'CC0 1.0 / public domain (per the repository README, section "Copyright")', fetched: new Date().toISOString().slice(0, 10), entries: total - skipped }, names, pos };
writeFileSync('src/openingsData.json', JSON.stringify(out));
console.log(`entries ${total - skipped}/${total}, positions ${Object.keys(pos).length}, names ${names.length}`);
