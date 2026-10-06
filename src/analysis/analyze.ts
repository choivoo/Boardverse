import { Chess } from 'chess.js';

/** Minimal UCI transport. Implemented by a Web Worker in the browser and by a child process in tests. */
export interface UciEngine { send(cmd: string): void; onLine(cb: (line: string) => void): void; terminate(): void }

export interface Preset { id: 'fast' | 'normal' | 'deep'; label: string; depth: number; movetimeMs: number }
/** Hard limits keep phones responsive: at most `depth` plies OR `movetimeMs` per position, whichever comes first. */
export const PRESETS: Preset[] = [
  { id: 'fast', label: '빠름', depth: 10, movetimeMs: 150 },
  { id: 'normal', label: '보통', depth: 12, movetimeMs: 400 },
  { id: 'deep', label: '정밀', depth: 14, movetimeMs: 1000 },
];
export const MAX_PLIES = 160;

export type Label = 'best' | 'ok' | 'inaccuracy' | 'mistake' | 'blunder';
export const LABEL_TEXT: Record<Label, string> = { best: '최선', ok: '무난', inaccuracy: '부정확', mistake: '실수', blunder: '큰 실수' };
export const LABEL_MARK: Record<Label, string> = { best: '★', ok: '', inaccuracy: '?!', mistake: '?', blunder: '??' };
/** Win-chance loss (percentage points) thresholds for the labels — our own, applied to real engine scores only. */
export const LOSS_INACCURACY = 5, LOSS_MISTAKE = 10, LOSS_BLUNDER = 15;

export interface Score { cp?: number; mate?: number }
export interface Info { depth: number; score: Score; pv: string[] }

export function parseInfo(line: string): Info | null {
  if (!line.startsWith('info ')) return null;
  const t = line.split(/\s+/);
  const mpv = t.indexOf('multipv'); if (mpv >= 0 && t[mpv + 1] !== '1') return null;
  const di = t.indexOf('depth'), si = t.indexOf('score'), pi = t.indexOf('pv');
  if (di < 0 || si < 0) return null;
  const depth = Number(t[di + 1]); const kind = t[si + 1]; const val = Number(t[si + 2]);
  if (!Number.isInteger(depth) || !Number.isFinite(val) || (kind !== 'cp' && kind !== 'mate')) return null;
  if (t[si + 3] === 'lowerbound' || t[si + 3] === 'upperbound') return null; // not a settled score
  return { depth, score: kind === 'cp' ? { cp: val } : { mate: val }, pv: pi >= 0 ? t.slice(pi + 1) : [] };
}
export function parseBestmove(line: string): string | null { const m = /^bestmove\s+(\S+)/.exec(line); return m ? m[1] : null; }

/** centipawns from the side to move's point of view; forced mates become very large values */
export function scoreToCp(s: Score): number { return s.mate !== undefined ? Math.sign(s.mate) * (10000 - 100 * Math.min(Math.abs(s.mate), 50)) : (s.cp as number); }
/** logistic win chance in percent (0..100) for a centipawn score from that side's view */
export function winPercent(cp: number): number { return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-10000, Math.min(10000, cp)))) - 1); }
export function labelFor(loss: number, isBest: boolean): Label {
  if (isBest) return 'best';
  return loss >= LOSS_BLUNDER ? 'blunder' : loss >= LOSS_MISTAKE ? 'mistake' : loss >= LOSS_INACCURACY ? 'inaccuracy' : 'ok';
}

export interface PlyResult {
  ply: number; color: 'w' | 'b'; san: string; label: Label; lossPct: number;
  /** engine eval after this move in centipawns, white's point of view (mates clamp to ±10000) */
  evalWhiteCp: number; mateAfter?: number;
  bestSan: string | null; bestUci: string | null; depthReached: number;
}
export interface Analysis {
  engine: { name: string; depth: number; movetimeMs: number }; plies: PlyResult[]; truncated: boolean;
  summary: Record<'w' | 'b', { moves: number; avgLossPct: number; counts: Record<Label, number> }>;
}

interface Searched { score: Score; bestUci: string | null; depth: number; terminal: boolean }

let busy = false; // one analysis at a time per page
export const analysisBusy = () => busy;

function collect(engine: UciEngine, until: (l: string) => boolean, ms: number, signal?: AbortSignal): { promise: Promise<string[]> } {
  const lines: string[] = [];
  const promise = new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('engine did not respond in time')), ms);
    const abort = () => { clearTimeout(timer); reject(new DOMException('cancelled', 'AbortError')); };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    engine.onLine((l) => {
      if (l.startsWith('__worker_error__')) { clearTimeout(timer); reject(new Error('engine crashed: ' + l.slice(16).trim())); return; }
      lines.push(l);
      if (until(l)) { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(lines); }
    });
  });
  return { promise };
}

async function search(engine: UciEngine, fen: string, p: Preset, signal?: AbortSignal): Promise<Searched> {
  const g = new Chess(fen);
  if (g.isGameOver()) return { score: { cp: g.isCheckmate() ? -10000 : 0 }, bestUci: null, depth: 0, terminal: true };
  const c = collect(engine, (l) => l.startsWith('bestmove'), p.movetimeMs * 6 + 8000, signal);
  engine.send(`position fen ${fen}`); engine.send(`go depth ${p.depth} movetime ${p.movetimeMs}`);
  const lines = await c.promise;
  let last: Info | null = null; for (const l of lines) { const i = parseInfo(l); if (i) last = i; }
  const best = parseBestmove(lines[lines.length - 1]);
  if (!last || !best || best === '(none)') throw new Error('engine returned no usable result');
  const legal = g.moves({ verbose: true }).some((m) => m.from + m.to + (m.promotion ?? '') === best);
  if (!legal) throw new Error('engine returned an illegal move'); // never trust engine output blindly
  return { score: last.score, bestUci: best, depth: last.depth, terminal: false };
}

async function init(engine: UciEngine, signal?: AbortSignal): Promise<string> {
  let c = collect(engine, (l) => l === 'uciok', 15000, signal); engine.send('uci');
  const name = ((await c.promise).find((l) => l.startsWith('id name ')) ?? 'id name unknown').slice(8);
  engine.send('setoption name Hash value 16');
  c = collect(engine, (l) => l === 'readyok', 15000, signal); engine.send('isready'); await c.promise;
  engine.send('ucinewgame');
  return name;
}

/** Analyses a FINISHED game given as SAN moves from the standard start position. */
export async function analyzeGame(engine: UciEngine, sans: string[], preset: Preset, opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}): Promise<Analysis> {
  if (busy) throw new Error('an analysis is already running');
  busy = true;
  try {
    const truncated = sans.length > MAX_PLIES; const moves = sans.slice(0, MAX_PLIES);
    const g = new Chess(); const fens = [g.fen()]; const verbose: { from: string; to: string; promotion?: string; san: string; color: 'w' | 'b' }[] = [];
    for (const san of moves) { const m = g.move(san); verbose.push({ from: m.from, to: m.to, promotion: m.promotion, san: m.san, color: m.color }); fens.push(g.fen()); }
    const name = await init(engine, opts.signal);
    const res: Searched[] = [];
    for (let i = 0; i < fens.length; i++) { res.push(await search(engine, fens[i], preset, opts.signal)); opts.onProgress?.(i + 1, fens.length); }
    const plies: PlyResult[] = verbose.map((m, i) => {
      const before = res[i], after = res[i + 1];
      const bestWp = winPercent(scoreToCp(before.score)); // mover's view at the position before the move
      const afterWp = 100 - winPercent(scoreToCp(after.score)); // `after` is from the opponent's view
      const loss = Math.max(0, bestWp - afterWp);
      const isBest = before.bestUci === m.from + m.to + (m.promotion ?? '');
      const afterCpSide = scoreToCp(after.score); // side to move after the move
      const whiteCp = m.color === 'w' ? -afterCpSide : afterCpSide; // after a white move black is to move
      let bestSan: string | null = null;
      if (before.bestUci) { const t = new Chess(fens[i]); try { bestSan = t.move({ from: before.bestUci.slice(0, 2), to: before.bestUci.slice(2, 4), promotion: before.bestUci[4] }).san; } catch { bestSan = null; } }
      return { ply: i + 1, color: m.color, san: m.san, label: labelFor(loss, isBest), lossPct: Math.round(loss * 10) / 10, evalWhiteCp: Math.max(-10000, Math.min(10000, whiteCp)), mateAfter: after.score.mate, bestSan, bestUci: before.bestUci, depthReached: before.depth };
    });
    const sum = (c: 'w' | 'b') => { const mine = plies.filter((p) => p.color === c); const counts: Record<Label, number> = { best: 0, ok: 0, inaccuracy: 0, mistake: 0, blunder: 0 }; for (const p of mine) counts[p.label]++;
      return { moves: mine.length, avgLossPct: mine.length ? Math.round((mine.reduce((a, p) => a + p.lossPct, 0) / mine.length) * 10) / 10 : 0, counts }; };
    return { engine: { name, depth: preset.depth, movetimeMs: preset.movetimeMs }, plies, truncated, summary: { w: sum('w'), b: sum('b') } };
  } finally { busy = false; engine.send('stop'); }
}
