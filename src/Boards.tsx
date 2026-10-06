import { useState } from 'react';
import type { Chess, Move, Square } from 'chess.js';
import type { GomokuState, Stone } from './games/gomoku';

export const GLYPH: Record<string, string> = { wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙', bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟' };
export const PNAME: Record<string, string> = { k: '킹', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰' };
export const stoneName = (c: Stone) => (c === 'B' ? '흑' : '백');

function arrowNav(e: React.KeyboardEvent<HTMLDivElement>, a: string, b: string) {
  const el = document.activeElement as HTMLElement;
  const x = Number(el.dataset[a]), y = Number(el.dataset[b]);
  const d: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  if (Number.isNaN(x) || !d[e.key]) return;
  e.preventDefault();
  (e.currentTarget.querySelector(`[data-${a}="${x + d[e.key][0]}"][data-${b}="${y + d[e.key][1]}"]`) as HTMLElement | null)?.focus();
}

export function ChessBoard({ game, flip, sel, targets, last, onSquare }: {
  game: Chess; flip: boolean; sel: Square | null; targets: Move[]; last?: { from: string; to: string } | null; onSquare: (sq: Square) => void;
}) {
  const board = game.board();
  const kingSq = game.isCheck() ? board.flat().find((c) => c && c.type === 'k' && c.color === game.turn())?.square : undefined;
  const order = [...Array(8).keys()]; if (flip) order.reverse();
  return (
    <div className="board chess" role="grid" aria-label="체스판" onKeyDown={(e) => arrowNav(e, 'c', 'r')}>
      {order.map((r) => order.map((c) => {
        const p = board[r][c]; const sq = ('abcdefgh'[c] + (8 - r)) as Square;
        const isT = targets.some((m) => m.to === sq);
        const cls = ['sq', (r + c) % 2 ? 'dark' : 'light', sel === sq && 'sel', isT && 'target', last && (last.from === sq || last.to === sq) && 'last', kingSq === sq && 'check'].filter(Boolean).join(' ');
        return (
          <button key={sq} className={cls} data-r={r} data-c={c} role="gridcell" onClick={() => onSquare(sq)}
            aria-label={`${sq}${p ? ` ${p.color === 'w' ? '백' : '흑'} ${PNAME[p.type]}` : ' 빈 칸'}${isT ? ', 이동 가능' : ''}${sel === sq ? ', 선택됨' : ''}`}>
            {p && <span className={`piece ${p.color}`} aria-hidden="true">{GLYPH[p.color + p.type]}</span>}
            {isT && <span className="dot" aria-hidden="true">{p ? '✕' : '•'}</span>}
          </button>
        );
      }))}
    </div>
  );
}

const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };

/** Gomoku board. In "confirm" mode (default on touch screens) a tap previews the stone and a second tap/button confirms. */
export function GomokuBoard({ size, board, lastIdx, winLine, disabled, onPlace }: {
  size: number; board: GomokuState['board']; lastIdx?: number; winLine: number[]; disabled: boolean; onPlace: (i: number) => void;
}) {
  const [confirm, setConfirm] = useState(coarse);
  const [pending, setPending] = useState<number | null>(null);
  const tap = (i: number) => {
    if (disabled || board[i]) return;
    if (!confirm) return onPlace(i);
    if (pending === i) { setPending(null); onPlace(i); } else setPending(i);
  };
  const pend = pending !== null && !board[pending] && !disabled ? pending : null;
  return (
    <>
      <div className="board gomoku" role="grid" aria-label="오목판" style={{ ['--n' as string]: size }} onKeyDown={(e) => arrowNav(e, 'x', 'y')}>
        {board.map((c, i) => {
          const x = i % size, y = Math.floor(i / size); const win = winLine.includes(i);
          return (
            <button key={i} role="gridcell" data-x={x} data-y={y} className={`pt ${i === lastIdx ? 'last' : ''} ${win ? 'win' : ''} ${i === pend ? 'pend' : ''}`} onClick={() => tap(i)}
              aria-label={`${x + 1}열 ${y + 1}행 ${c ? stoneName(c) + '돌' : '빈 칸'}${i === lastIdx ? ', 마지막 수' : ''}${win ? ', 승리 줄' : ''}${i === pend ? ', 착수 대기' : ''}`}>
              {c && <span className={`stone ${c}`} aria-hidden="true">{win ? '★' : i === lastIdx ? '◦' : ''}</span>}
              {i === pend && <span className="ghost" aria-hidden="true">＋</span>}
            </button>
          );
        })}
      </div>
      <div className="confirmbar">
        <label><input type="checkbox" checked={confirm} onChange={(e) => { setConfirm(e.target.checked); setPending(null); }} /> 신중 착수 (탭 후 확정)</label>
        {confirm && <button className="primary" disabled={pend === null} onClick={() => { if (pend !== null) { setPending(null); onPlace(pend); } }}>착수</button>}
      </div>
    </>
  );
}
