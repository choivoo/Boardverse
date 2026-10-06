import { useEffect, useState } from 'react';
import { Chess } from 'chess.js';

export interface OpeningData {
  v: 1; source: { repo: string; commit: string; license: string; fetched: string; entries: number };
  names: [string, string][]; pos: Record<string, { n?: number; c: string[]; d: number }>;
}
let cache: OpeningData | null = null; let pending: Promise<OpeningData> | null = null;
/** The dictionary (~115 KB gzipped) is loaded on first use, never at startup. */
export function loadOpenings(): Promise<OpeningData> {
  if (cache) return Promise.resolve(cache);
  return (pending ??= import('./openingsData.json').then((m) => (cache = m.default as unknown as OpeningData)));
}
export function useOpenings(): OpeningData | null {
  const [d, setD] = useState<OpeningData | null>(cache);
  useEffect(() => { if (!cache) loadOpenings().then(setD).catch(() => setD(null)); }, []);
  return d;
}
export const epd = (g: Chess) => g.fen().split(' ').slice(0, 4).join(' ');

export interface Opening { eco: string; name: string; ply: number }
/** "Play the moves backwards until a named position is found" (the data set's recommended classification). */
export function lookup(data: OpeningData, moves: string[]): Opening | null {
  const g = new Chess(); const keys: string[] = [epd(g)];
  for (const m of moves) { try { g.move(m); } catch { break; } keys.push(epd(g)); }
  for (let i = keys.length - 1; i >= 1; i--) { const n = data.pos[keys[i]]?.n; if (n !== undefined) return { eco: data.names[n][0], name: data.names[n][1], ply: i }; }
  return null;
}
export interface Continuation { san: string; named: Opening | null; lines: number }
/** Known next moves from the current position (only moves that occur in the data set), with how many catalogued lines pass through each. */
export function continuations(data: OpeningData, moves: string[]): Continuation[] {
  const g = new Chess(); for (const m of moves) { try { g.move(m); } catch { return []; } }
  const here = data.pos[epd(g)]; if (!here) return [];
  return here.c.map((san) => { const t = new Chess(g.fen()); t.move(san); const p = data.pos[epd(t)]; return { san, named: p?.n !== undefined ? { eco: data.names[p.n][0], name: data.names[p.n][1], ply: moves.length + 1 } : null, lines: p?.d ?? 0 }; }).sort((a, b) => b.lines - a.lines);
}
/** Synchronous helper for already-loaded data (returns null until loadOpenings() has completed). */
export function openingAt(moves: string[]): Opening | null { return cache ? lookup(cache, moves) : null; }
