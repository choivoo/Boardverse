import { useEffect, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { RoomView, ClientMsg } from './protocol';
import { ChessBoard, GomokuBoard, GLYPH, PNAME, stoneName } from './Boards';
import { saveRecord } from './games/storage';
import type { Conn } from './online';

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function OnlineGame({ view, at, conn, send, exit }: { view: RoomView; at: number; conn: Conn; send: (m: ClientMsg) => void; exit: () => void }) {
  const [sel, setSel] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [saved, setSaved] = useState<'idle' | 'ok' | 'fail'>('idle');
  const game = useMemo(() => (view.chess ? new Chess(view.chess.fen) : null), [view.chess?.fen]); // eslint-disable-line react-hooks/exhaustive-deps
  const foe = view.players.find((p) => p.side !== view.you);
  const myTurn = view.status === 'playing' && view.turn === view.you;
  const timed = !!view.chess?.clocks;

  useEffect(() => { if (!timed) return; const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, [timed]);
  useEffect(() => { setSel(null); setPromo(null); }, [view.n]);
  useEffect(() => {
    if (view.status !== 'over' || saved !== 'idle' || !view.result) return;
    const label = view.result.winner === 'draw' ? '무승부' : view.result.winner === view.you ? '승리' : '패배';
    setSaved(saveRecord({ id: crypto.randomUUID(), game: view.game, mode: `온라인 vs ${foe?.name ?? '?'}`, result: `${label} (${view.result.reason})`, moves: view.n, at: Date.now() }) ? 'ok' : 'fail');
  }, [view, saved, foe]);

  const remain = (s: 'w' | 'b') => view.chess!.clocks![s] - (view.chess!.running === s ? now - at : 0);
  const targets = useMemo(() => (game && sel ? game.moves({ square: sel, verbose: true }) : []), [game, sel]);

  const clickSq = (sq: Square) => {
    if (!game || !myTurn || promo) return;
    if (sel) {
      const t = targets.filter((m) => m.to === sq);
      if (t.length) { t[0].promotion ? setPromo({ from: sel, to: sq }) : send({ t: 'move', n: view.n, from: sel, to: sq }); return; }
    }
    const p = game.get(sq); setSel(p && p.color === game.turn() ? sq : null);
  };

  const share = async () => {
    const url = `${location.origin}/?room=${view.code}`;
    try { if (navigator.share) await navigator.share({ title: 'Boardverse', text: `Boardverse 방 코드 ${view.code}`, url }); else await navigator.clipboard.writeText(url); } catch { /* cancelled */ }
  };

  if (view.status === 'waiting') {
    return (
      <section className="setup">
        <h1>상대를 기다리는 중…</h1>
        <p>친구에게 이 코드를 알려주세요.</p>
        <p className="code" aria-label={`방 코드 ${view.code.split('').join(' ')}`}>{view.code}</p>
        <div className="row"><button className="primary" onClick={share}>링크 공유</button><button onClick={exit}>취소</button></div>
        <p className="note">내 색: {view.game === 'chess' ? (view.you === 'w' ? '백' : '흑') : (view.you === 'w' ? '흑돌(선공)' : '백돌')}</p>
      </section>
    );
  }
  const sideName = (s: 'w' | 'b') => view.game === 'chess' ? (s === 'w' ? '백' : '흑') : (s === 'w' ? '흑돌' : '백돌');
  const st = view.status === 'over' ? '대국 종료' : myTurn ? '내 차례' : `${foe?.name ?? '상대'} 차례`;
  const bar = (s: 'w' | 'b') => {
    const p = view.players.find((x) => x.side === s);
    return <div className="player"><span>{p?.name ?? '?'} · {sideName(s)}{s === view.you ? ' (나)' : ''}{p && !p.connected ? ' · 연결 끊김' : ''}</span>
      {timed && <span className={`clock ${view.chess!.running === s ? 'active' : ''}`} aria-label={`${sideName(s)} 남은 시간`}>{fmt(remain(s))}</span>}</div>;
  };
  const top = view.you === 'w' ? 'b' : 'w';

  return (
    <section className="play">
      <div className="boardcol">
        {bar(top)}
        {view.chess && game && <ChessBoard game={game} flip={view.you === 'b'} sel={sel} targets={targets} last={view.chess.last} onSquare={clickSq} />}
        {view.gomoku && <GomokuBoard size={view.gomoku.size} board={view.gomoku.board as never} lastIdx={view.gomoku.moves.at(-1)} winLine={view.gomoku.winLine} disabled={!myTurn}
          onPlace={(i) => send({ t: 'move', n: view.n, idx: i })} />}
        {bar(view.you)}
      </div>
      <aside className="side">
        {conn !== 'open' && <p className="banner" role="alert">연결이 끊겼습니다. 다시 연결하는 중…</p>}
        <p className="status" role="status" aria-live="polite">{st}</p>
        {view.chess && <ol className="moves" aria-label="수 기록">{Array.from({ length: Math.ceil(view.chess.history.length / 2) }, (_, i) => <li key={i}>{view.chess!.history[2 * i]} {view.chess!.history[2 * i + 1] ?? ''}</li>)}</ol>}
        <div className="row">
          <button onClick={() => send({ t: 'resign' })} disabled={view.status !== 'playing'}>기권</button>
          <button onClick={exit}>나가기</button>
        </div>
        {promo && game && (
          <div className="dialog" role="dialog" aria-label="승격할 기물 선택"><p>승격할 기물</p>
            {(['q', 'r', 'b', 'n'] as const).map((p) => <button key={p} onClick={() => { send({ t: 'move', n: view.n, from: promo.from, to: promo.to, promotion: p }); setPromo(null); }}>{GLYPH[game.turn() + p]} {PNAME[p]}</button>)}
          </div>
        )}
        {view.status === 'over' && view.result && (
          <div className="dialog result" role="alertdialog" aria-label="대국 결과">
            <h2>{view.result.winner === 'draw' ? '무승부' : view.result.winner === view.you ? '승리!' : '패배'}</h2>
            <p>{view.result.reason}{view.result.winner !== 'draw' && view.game === 'gomoku' ? ` · ${stoneName(view.result.winner === 'w' ? 'B' : 'W')} 승` : ''}</p>
            <p className="note">{saved === 'ok' ? '전적이 이 브라우저에 저장되었습니다.' : saved === 'fail' ? '전적 저장에 실패했습니다.' : ''}</p>
            <div className="row"><button className="primary" onClick={exit}>홈으로</button></div>
          </div>
        )}
      </aside>
    </section>
  );
}
