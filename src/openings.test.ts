import { describe, it, expect, beforeAll } from 'vitest';
import { Chess } from 'chess.js';
import { loadOpenings, lookup, continuations, epd, type OpeningData } from './openings';

let d: OpeningData; beforeAll(async () => { d = await loadOpenings(); });

describe('opening dictionary (lichess-org/chess-openings, CC0)', () => {
  it('records its source and license and holds no invented statistics', () => {
    expect(d.source.repo).toBe('https://github.com/lichess-org/chess-openings'); expect(d.source.license).toMatch(/CC0/); expect(d.source.entries).toBeGreaterThan(3000);
    expect((d.source as any).commit).toMatch(/^[0-9a-f]{40}$/); expect(Object.keys((d.source as any).files)).toEqual(['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv']); expect(Object.values((d.source as any).files).every((h) => /^[0-9a-f]{64}$/.test(h as string))).toBe(true);
    const sample = Object.values(d.pos)[0]; expect(Object.keys(sample).sort()).toEqual(['c', 'd', 'n'].filter((k) => k in sample).sort()); // only line counts; no wins/draws/losses
    expect(JSON.stringify(d).includes('"win')).toBe(false);
  });
  it('names well-known lines and falls back to the last named position', () => {
    expect(lookup(d, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])?.name).toMatch(/Ruy Lopez/);
    expect(lookup(d, ['e4', 'c5'])?.name).toMatch(/Sicilian/);
    const deep = lookup(d, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8', 'd4', 'Nbd7', 'Nbd2', 'Bb7']);
    expect(deep?.name).toMatch(/Ruy Lopez/); expect(deep!.ply).toBeLessThanOrEqual(22);
    expect(lookup(d, [])).toBeNull(); expect(lookup(d, ['a3', 'a6', 'h3', 'h6', 'Ra2', 'Ra7'])?.ply ?? 0).toBeLessThanOrEqual(2);
    expect(lookup(d, ['e4', 'zz9'])?.name).toBeTruthy(); // junk after a named line is ignored, not fatal
  });
  it('recognises transpositions by position, not by move order', () => {
    const a = lookup(d, ['Nf3', 'd5', 'd4']), b = lookup(d, ['d4', 'd5', 'Nf3']);
    expect(a?.name).toBeTruthy(); expect(a?.name).toBe(b?.name);
  });
  it('offers only continuations that exist, with real line counts, and every one is legal', () => {
    const start = continuations(d, []); expect(start.map((c) => c.san)).toEqual(expect.arrayContaining(['e4', 'd4', 'Nf3', 'c4']));
    expect(start.every((c) => c.lines > 0)).toBe(true); expect(start[0].lines).toBeGreaterThanOrEqual(start[start.length - 1].lines);
    const g = new Chess(); for (const c of start) expect(() => g.move(c.san) && g.undo()).not.toThrow();
    expect(continuations(d, ['e4', 'e5']).map((c) => c.san)).toContain('Nf3');
    expect(continuations(d, ['a3', 'a6', 'b3', 'b6', 'c3', 'c6'])).toEqual([]); // off the map: nothing made up
    expect(continuations(d, ['bogus'])).toEqual([]);
  });
  it('every stored continuation leads to a stored position (no dangling lines)', () => {
    let checked = 0;
    for (const [key, p] of Object.entries(d.pos)) { if (checked++ > 400) break; const g = new Chess(`${key} 0 1`); for (const san of p.c) { g.move(san); expect(d.pos[epd(g)], `${key} ${san}`).toBeDefined(); g.undo(); } }
  });
});
