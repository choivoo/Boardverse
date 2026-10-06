import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { Setup } from './App';
import { chessBot, chessEnd, legalTargets, tryMove, TIME_CONTROLS, type Color } from './games/chess';
import { saveRecord } from './games/storage';
import { ChessBoard, GLYPH, PNAME as NAME } from './Boards';

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function ChessGame({ setup, exit, again }: { setup: Setup; exit: () => void; again: () => void }) {
  const tc = TIME_CONTROLS.find((t) => t.id === setup.time)!;
  const [mine] = useState<Color>(() => setup.side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : setup.side);
  const [game, setGame] = useState(() => new Chess());
  const [, force] = useState(0);
  const [sel, setSel] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [clocks, setClocks] = useState({ w: tc.baseSec * 1000, b: tc.baseSec * 1000 });
  const [timeout, setTimeoutLoser] = useState<Color | null>(null);
  const [resigned, setResigned] = useState<Color | null>(null);
  const [hint, setHint] = useState<{ sq: Square; san: string } | null>(null);
  const [saved, setSaved] = useState<'idle' | 'ok' | 'fail'>('idle');
  const last = useRef(Date.now());
  const flip = setup.opp === 'bot' ? mine === 'b' : false;
  const end = chessEnd(game);
  const over = end.over || timeout !== null || resigned !== null;
  const botTurn = setup.opp === 'bot' && game.turn() !== mine;

  const result = timeout ? { result: timeout === 'w' ? 'b' : 'w', reason: '시간 초과' } : resigned ? { result: resigned === 'w' ? 'b' : 'w', reason: '기권' } : end.over ? end : null;

  // clock tick
  useEffect(() => {
    if (!tc.baseSec || over) return;
    last.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now(); const dt = now - last.current; last.current = now;
      const side = game.turn();
      setClocks((c) => {
        const v = c[side] - dt;
        if (v <= 0) setTimeoutLoser(side);
        return { ...c, [side]: Math.max(0, v) };
      });
    }, 200);
    return () => clearInterval(id);
  }, [game, over, tc.baseSec]);

  const apply = (from: string, to: string, promotion: 'q' | 'r' | 'b' | 'n' = 'q') => {
    const side = game.turn();
    const m = tryMove(game, from, to, promotion);
    if (!m) return false;
    if (tc.incSec) setClocks((c) => ({ ...c, [side]: c[side] + tc.incSec * 1000 }));
    setSel(null); setPromo(null); setHint(null); force((n) => n + 1);
    setGame(game); // same instance, force re-render below via key
    return true;
  };

  // bot move
  useEffect(() => {
    if (!botTurn || over) return;
    const id = setTimeout(() => {
      const m = chessBot(game, setup.level);
      if (m) apply(m.from, m.to, (m.promotion as 'q') ?? 'q');
    }, 450);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botTurn, over, game.fen()]);

  // save once on finish
  useEffect(() => {
    if (!result || saved !== 'idle') return;
    const label = result.result === 'draw' ? '무승부' : setup.opp === 'bot' ? (result.result === mine ? '승리' : '패배') : result.result === 'w' ? '백 승' : '흑 승';
    setSaved(saveRecord({ id: crypto.randomUUID(), game: 'chess', mode: setup.opp === 'bot' ? `컴퓨터(${['', '초급', '보통', '어려움'][setup.level]})` : '2인', result: `${label} (${result.reason})`, moves: game.history().length, at: Date.now(), list: game.history() }) ? 'ok' : 'fail');
  }, [result, saved, setup, mine, game]);

  const targets = useMemo(() => (sel ? legalTargets(game, sel) : []), [sel, game, game.fen()]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastMove = game.history({ verbose: true }).at(-1);

  const click = (sq: Square) => {
    if (over || botTurn || promo) return;
    const piece = game.get(sq);
    if (sel) {
      const t = targets.filter((m) => m.to === sq);
      if (t.length) {
        if (t[0].promotion) setPromo({ from: sel, to: sq }); else apply(sel, sq);
        return;
      }
    }
    setSel(piece && piece.color === game.turn() ? sq : null);
  };

  const undo = () => {
    const n = setup.opp === 'bot' ? (botTurn ? 0 : 2) : 1;
    for (let i = 0; i < n; i++) game.undo();
    setSel(null); setTimeoutLoser(null); force((x) => x + 1);
  };

  const status = result ? '대국 종료' : game.isCheck() ? `체크! ${game.turn() === 'w' ? '백' : '흑'} 차례` : `${game.turn() === 'w' ? '백' : '흑'} 차례${botTurn ? ' (컴퓨터 생각 중…)' : ''}`;
  const hist = game.history();
  const clockBox = (c: Color) => tc.baseSec ? <span className={`clock ${game.turn() === c && !over ? 'active' : ''}`} aria-label={`${c === 'w' ? '백' : '흑'} 남은 시간`}>{fmt(clocks[c])}</span> : null;
  const top: Color = flip ? 'w' : 'b', bottom: Color = flip ? 'b' : 'w';
  const who = (c: Color) => `${c === 'w' ? '백' : '흑'}${setup.opp === 'bot' ? (c === mine ? ' (나)' : ' (컴퓨터)') : ''}`;

  return (
    <section className="play">
      <div className="boardcol">
        <div className="player"><span>{who(top)}</span>{clockBox(top)}</div>
        <ChessBoard game={game} flip={flip} sel={sel} targets={targets} last={lastMove} onSquare={click} hint={hint?.sq ?? null} />
        <div className="player"><span>{who(bottom)}</span>{clockBox(bottom)}</div>
      </div>
      <aside className="side">
        <p className="status" role="status" aria-live="polite">{status}</p>
        {hint && <p className="note" role="status">추천 수: {hint.san} (초록 칸의 기물) · 약한 봇의 추천이라 최선이 아닐 수 있어요</p>}
        <ol className="moves" aria-label="수 기록">{Array.from({ length: Math.ceil(hist.length / 2) }, (_, i) => <li key={i}>{hist[2 * i]} {hist[2 * i + 1] ?? ''}</li>)}</ol>
        <div className="row">
          <button onClick={undo} disabled={over || hist.length === 0 || botTurn}>되돌리기</button>
          {setup.opp === 'bot' && <button onClick={() => { const m = chessBot(game, 3); if (m) setHint({ sq: m.from as Square, san: m.san }); }} disabled={over || botTurn}>힌트</button>}
          <button onClick={() => setResigned(setup.opp === 'bot' ? mine : game.turn())} disabled={over}>기권</button>
          <button onClick={exit}>나가기</button>
        </div>
        {promo && (
          <div className="dialog" role="dialog" aria-label="승격할 기물 선택">
            <p>승격할 기물</p>
            {(['q', 'r', 'b', 'n'] as const).map((p) => <button key={p} onClick={() => apply(promo.from, promo.to, p)}>{GLYPH[game.turn() + p]} {NAME[p]}</button>)}
          </div>
        )}
        {result && (
          <div className="dialog result" role="alertdialog" aria-label="대국 결과">
            <h2>{result.result === 'draw' ? '무승부' : `${result.result === 'w' ? '백' : '흑'} 승리`}</h2>
            <p>{result.reason}</p>
            <p className="note">{saved === 'ok' ? '전적이 이 브라우저에 저장되었습니다.' : saved === 'fail' ? '전적 저장에 실패했습니다 (브라우저 저장소 사용 불가).' : ''}</p>
            <div className="row"><button className="primary" onClick={again}>다시 하기</button><button onClick={exit}>홈으로</button></div>
          </div>
        )}
      </aside>
    </section>
  );
}
