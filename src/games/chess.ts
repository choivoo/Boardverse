import { Chess, type Move, type Square } from 'chess.js';

export type Color = 'w' | 'b';
export type ChessEnd = { over: false } | { over: true; result: 'w' | 'b' | 'draw'; reason: string };

export interface TimeControl { id: string; label: string; baseSec: number; incSec: number }
export const TIME_CONTROLS: TimeControl[] = [
  { id: 'none', label: '무제한', baseSec: 0, incSec: 0 },
  { id: '5+0', label: '5분', baseSec: 300, incSec: 0 },
  { id: '10+0', label: '10분', baseSec: 600, incSec: 0 },
  { id: '15+10', label: '15분 + 10초', baseSec: 900, incSec: 10 },
];

export function chessEnd(g: Chess): ChessEnd {
  if (g.isCheckmate()) return { over: true, result: g.turn() === 'w' ? 'b' : 'w', reason: '체크메이트' };
  if (g.isStalemate()) return { over: true, result: 'draw', reason: '스테일메이트' };
  if (g.isInsufficientMaterial()) return { over: true, result: 'draw', reason: '기물 부족' };
  if (g.isThreefoldRepetition()) return { over: true, result: 'draw', reason: '3회 동형 반복' };
  if (g.isDrawByFiftyMoves()) return { over: true, result: 'draw', reason: '50수 규칙' };
  return { over: false };
}

export function legalTargets(g: Chess, from: Square): Move[] {
  return g.moves({ square: from, verbose: true });
}

/** Attempts a move; returns the Move or null if illegal. Promotion defaults to queen. */
export function tryMove(g: Chess, from: string, to: string, promotion: 'q' | 'r' | 'b' | 'n' = 'q'): Move | null {
  try { return g.move({ from, to, promotion }); } catch { return null; }
}

const VAL: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
function material(g: Chess, side: Color): number {
  let t = 0;
  for (const row of g.board()) for (const c of row) if (c) t += (c.color === side ? 1 : -1) * VAL[c.type];
  return t;
}

/** level 1: random; 2: greedy (captures/mates); 3: 2-ply minimax on material. */
export function chessBot(g: Chess, level: 1 | 2 | 3, rnd: () => number = Math.random): Move | null {
  const moves = g.moves({ verbose: true });
  if (!moves.length) return null;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  if (level === 1) return pick(moves);
  const me = g.turn();
  let best: Move[] = [], bestV = -Infinity;
  for (const m of moves) {
    g.move(m);
    let v: number;
    if (g.isCheckmate()) v = 1e6;
    else if (g.isDraw()) v = 0;
    else if (level === 2) v = material(g, me);
    else {
      v = Infinity;
      const replies = g.moves({ verbose: true });
      for (const r of replies) {
        g.move(r);
        v = Math.min(v, g.isCheckmate() ? -1e6 : g.isDraw() ? 0 : material(g, me));
        g.undo();
      }
    }
    g.undo();
    if (v > bestV) { bestV = v; best = [m]; } else if (v === bestV) best.push(m);
  }
  return pick(best);
}
