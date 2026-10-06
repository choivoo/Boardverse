import { Chess } from 'chess.js';
import { findWin, newGomoku, type Stone } from './games/gomoku';
import { CHESS_PUZZLES, GOMOKU_PUZZLES } from './puzzleData';

export interface ChessPuzzle { id: string; kind: 'mate1' | 'mate2'; fen: string }
export interface GomokuPuzzle { id: string; kind: 'win1' | 'block1'; size: number; black: number[]; white: number[]; toMove: Stone }
export const chessPuzzles: ChessPuzzle[] = CHESS_PUZZLES as ChessPuzzle[];
export const gomokuPuzzles: GomokuPuzzle[] = GOMOKU_PUZZLES as GomokuPuzzle[];
export const PUZZLE_TITLE = { mate1: '메이트 1수', mate2: '메이트 2수', win1: '한 수로 승리', block1: '상대의 5목을 막아라' } as const;
export const PUZZLE_TEXT = {
  mate1: '한 수로 체크메이트를 만드세요.', mate2: '두 수 안에 체크메이트를 만드세요. (첫 수가 중요합니다)',
  win1: '5목을 완성해 바로 이기세요.', block1: '상대가 다음 수에 5목을 완성합니다. 막으세요!',
} as const;

// ---- chess solvers (pure functions over chess.js) ----
export const matesNow = (g: Chess) => g.moves({ verbose: true }).filter((m) => { g.move(m); const r = g.isCheckmate(); g.undo(); return r; });
/** True if the side to move can force mate in exactly one more own move after `reply`s. */
export function forcesMate2(g: Chess, first: { from: string; to: string; promotion?: string }): boolean {
  g.move(first);
  let ok = !g.isGameOver();
  if (ok) for (const r of g.moves({ verbose: true })) { g.move(r); const m = matesNow(g).length > 0; g.undo(); if (!m) { ok = false; break; } }
  g.undo();
  return ok;
}
export function isCorrectChessMove(p: ChessPuzzle, g: Chess, m: { from: string; to: string; promotion?: string }, step: 0 | 1): boolean {
  if (p.kind === 'mate1' || step === 1) { g.move(m); const r = g.isCheckmate(); g.undo(); return r; }
  return forcesMate2(g, m);
}
/** Opponent's reply in a mate2 puzzle: the defence that is not an immediate blunder, preferring captures/checks last. */
export function opponentReply(g: Chess) { const ms = g.moves({ verbose: true }); return ms.find((m) => !m.captured) ?? ms[0]; }

// ---- gomoku solvers ----
export function gomokuPuzzleBoard(p: GomokuPuzzle) {
  const s = newGomoku(p.size);
  for (const i of p.black) s.board[i] = 'B'; for (const i of p.white) s.board[i] = 'W';
  s.turn = p.toMove;
  return s;
}
const wins = (board: (Stone | null)[], size: number, i: number, who: Stone) => { const b = board.slice(); b[i] = who; return findWin({ size, board: b }, i).length > 0; };
export const winningCells = (board: (Stone | null)[], size: number, who: Stone) => board.map((c, i) => (c === null && wins(board, size, i, who) ? i : -1)).filter((i) => i >= 0);
export function isCorrectGomokuMove(p: GomokuPuzzle, i: number): boolean {
  const s = gomokuPuzzleBoard(p);
  if (s.board[i] !== null) return false;
  if (p.kind === 'win1') return wins(s.board, s.size, i, p.toMove);
  const b = s.board.slice(); b[i] = p.toMove;
  return winningCells(b, s.size, p.toMove === 'B' ? 'W' : 'B').length === 0;
}
/** Deterministic "puzzle of the day" from the bundled set (UTC date). */
export function dailyPuzzle(now = Date.now()) {
  const day = Math.floor(now / 86400_000);
  const all = [...chessPuzzles.map((p) => ({ game: 'chess' as const, p })), ...gomokuPuzzles.map((p) => ({ game: 'gomoku' as const, p }))];
  return all[day % all.length];
}
