export type Side = 'w' | 'b';
export type GameKind = 'chess' | 'gomoku';

export type ClientMsg =
  | { t: 'create'; game: GameKind; name: string; side: Side | 'random'; time?: string; size?: number; rated?: boolean }
  | { t: 'queue'; game: GameKind; name: string; time?: string; size?: number; rated?: boolean }
  | { t: 'unqueue' }
  | { t: 'draw'; action: 'offer' | 'accept' | 'decline' }
  | { t: 'rematch' }
  | { t: 'invite'; to: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; token: string }
  | { t: 'move'; n: number; from?: string; to?: string; promotion?: string; idx?: number }
  | { t: 'resign' };

export interface RoomView {
  code: string;
  game: GameKind;
  status: 'waiting' | 'playing' | 'over';
  rated: boolean;
  time: string;
  /** side that currently offers a draw, if any */
  drawOffer: Side | null;
  rematch: Side[];
  players: { name: string; side: Side; connected: boolean; registered: boolean }[];
  you: Side;
  /** number of moves played; clients echo it back to reject stale submissions */
  n: number;
  turn: Side;
  chess?: { fen: string; history: string[]; last: { from: string; to: string } | null; clocks: { w: number; b: number } | null; running: Side | null };
  gomoku?: { size: number; board: (string | null)[]; moves: number[]; winLine: number[] };
  result?: { winner: Side | 'draw'; reason: string; ratingDelta?: { w: number; b: number } };
}

export type ServerMsg =
  | { t: 'joined'; token: string; view: RoomView }
  | { t: 'view'; view: RoomView }
  | { t: 'queued' }
  | { t: 'unqueued' }
  | { t: 'invited'; from: string; code: string }
  | { t: 'info'; msg: string }
  | { t: 'error'; msg: string; fatal?: boolean };
