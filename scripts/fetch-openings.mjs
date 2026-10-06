// Downloads the five opening TSV files from a PINNED upstream commit and prints their SHA-256.
// Usage: node scripts/fetch-openings.mjs <commit-sha> <out-dir>      (then: npx tsx scripts/buildOpenings.ts <out-dir> <commit-sha> <YYYY-MM-DD>)
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [sha, out] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !out) { console.error('usage: fetch-openings.mjs <40-hex commit sha> <out-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
for (const f of ['a', 'b', 'c', 'd', 'e', 'README']) {
  const name = f === 'README' ? 'README.md' : `${f}.tsv`;
  const r = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/${sha}/${name}`);
  if (!r.ok) { console.error(`failed ${name}: ${r.status}`); process.exit(1); }
  const buf = Buffer.from(await r.arrayBuffer()); writeFileSync(join(out, name), buf);
  console.log(createHash('sha256').update(buf).digest('hex'), name);
}
