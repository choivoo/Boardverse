export type Stone = 'B' | 'W';
export type Cell = Stone | null;
export type GomokuStatus = 'playing' | 'won' | 'draw';

export interface GomokuState {
  size: number;
  board: Cell[];
  turn: Stone;
  status: GomokuStatus;
  winner: Stone | null;
  winLine: number[];
  moves: number[];
}

/** Rules: freestyle — five or more in a row wins; no renju restrictions. */
export const GOMOKU_RULE_LABEL = '프리스타일 (5목 이상 승리, 금수 없음)';

export function newGomoku(size = 15): GomokuState {
  return { size, board: Array(size * size).fill(null), turn: 'B', status: 'playing', winner: null, winLine: [], moves: [] };
}

const DIRS: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function findWin(s: Pick<GomokuState, 'size' | 'board'>, idx: number): number[] {
  const stone = s.board[idx];
  if (!stone) return [];
  const x0 = idx % s.size, y0 = Math.floor(idx / s.size);
  for (const [dx, dy] of DIRS) {
    const line = [idx];
    for (const sign of [1, -1]) {
      let x = x0 + dx * sign, y = y0 + dy * sign;
      while (x >= 0 && y >= 0 && x < s.size && y < s.size && s.board[y * s.size + x] === stone) {
        line.push(y * s.size + x);
        x += dx * sign; y += dy * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}

/** Returns a new state, or null if the move is illegal. */
export function playGomoku(s: GomokuState, idx: number): GomokuState | null {
  if (s.status !== 'playing' || !Number.isInteger(idx) || idx < 0 || idx >= s.board.length || s.board[idx]) return null;
  const board = s.board.slice();
  board[idx] = s.turn;
  const moves = [...s.moves, idx];
  const winLine = findWin({ size: s.size, board }, idx);
  if (winLine.length) return { ...s, board, moves, status: 'won', winner: s.turn, winLine };
  if (moves.length === board.length) return { ...s, board, moves, status: 'draw' };
  return { ...s, board, moves, turn: s.turn === 'B' ? 'W' : 'B' };
}

export function undoGomoku(s: GomokuState, count = 1): GomokuState {
  let st = newGomoku(s.size);
  const keep = s.moves.slice(0, Math.max(0, s.moves.length - count));
  for (const m of keep) st = playGomoku(st, m)!;
  return st;
}

/** Heuristic bot. level 1 = random near stones, 2 = blocks/wins, 3 = pattern scoring. */
export function gomokuBot(s: GomokuState, level: 1 | 2 | 3, rnd: () => number = Math.random): number {
  const { size, board } = s;
  const empties: number[] = [];
  const near: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i]) continue;
    empties.push(i);
    const x = i % size, y = Math.floor(i / size);
    let adj = false;
    for (let dy = -2; dy <= 2 && !adj; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size && board[ny * size + nx]) { adj = true; break; }
    }
    if (adj) near.push(i);
  }
  if (!empties.length) return -1;
  if (!near.length) return Math.floor(size / 2) * size + Math.floor(size / 2);
  const cands = near;
  const me = s.turn, foe: Stone = me === 'B' ? 'W' : 'B';
  const wins = (i: number, who: Stone) => { const b = board.slice(); b[i] = who; return findWin({ size, board: b }, i).length > 0; };
  if (level === 1) return cands[Math.floor(rnd() * cands.length)];
  for (const i of cands) if (wins(i, me)) return i;
  for (const i of cands) if (wins(i, foe)) return i;
  if (level === 2) return cands[Math.floor(rnd() * cands.length)];
  const score = (i: number, who: Stone) => {
    const x0 = i % size, y0 = Math.floor(i / size);
    let total = 0;
    for (const [dx, dy] of DIRS) {
      let count = 1, open = 0;
      for (const sign of [1, -1]) {
        let x = x0 + dx * sign, y = y0 + dy * sign;
        while (x >= 0 && y >= 0 && x < size && y < size && board[y * size + x] === who) { count++; x += dx * sign; y += dy * sign; }
        if (x >= 0 && y >= 0 && x < size && y < size && !board[y * size + x]) open++;
      }
      if (count >= 4) total += open === 2 ? 5000 : 800;
      else if (count === 3) total += open === 2 ? 600 : 60;
      else if (count === 2) total += open === 2 ? 50 : 5;
      else total += 1;
    }
    return total;
  };
  let best = cands[0], bestScore = -1;
  for (const i of cands) {
    const sc = score(i, me) * 1.1 + score(i, foe) + rnd();
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  return best;
}
