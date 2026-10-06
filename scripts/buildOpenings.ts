// Builds src/openingsData.json from the lichess-org/chess-openings TSV files (CC0 / public domain, see README of that repo).
// Usage: node scripts/fetch-openings.mjs <sha> <dir> && npx tsx scripts/buildOpenings.ts <dir> <sha> <YYYY-MM-DD fetched>
// Deterministic: the same inputs always give a byte-identical src/openingsData.json (no clock, input file hashes are embedded).
// The result is a *name dictionary of known lines* + the continuations that exist between them. It contains NO win/draw/loss
// statistics: we have no game database, and we do not invent numbers.
import { Chess } from 'chess.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const epd = (g: Chess) => g.fen().split(' ').slice(0, 4).join(' ');
const dir = process.argv[2], sha = process.argv[3], fetched = process.argv[4];
if (!dir || !/^[0-9a-f]{40}$/.test(sha ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(fetched ?? '')) { console.error('usage: buildOpenings.ts <dir> <40-hex commit sha> <YYYY-MM-DD>'); process.exit(2); }
const fileHashes: Record<string, string> = {};
const names: [string, string][] = []; const pos: Record<string, { n?: number; c: string[]; d: number }> = {};
let total = 0, skipped = 0;
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const text = readFileSync(join(dir, `${f}.tsv`), 'utf8'); fileHashes[`${f}.tsv`] = createHash('sha256').update(text).digest('hex');
  for (const line of text.split('\n').slice(1)) {
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
const out = { v: 1, source: { repo: 'https://github.com/lichess-org/chess-openings', commit: sha, files: fileHashes, license: 'CC0 1.0 / public domain (per the repository README, section "Copyright")', fetched, entries: total - skipped }, names, pos };
writeFileSync('src/openingsData.json', JSON.stringify(out));
console.log(`entries ${total - skipped}/${total}, positions ${Object.keys(pos).length}, names ${names.length}`);
