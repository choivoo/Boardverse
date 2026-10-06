import { useEffect, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { RoomView } from './protocol';
import { ChessBoard, GomokuBoard, GLYPH, PNAME } from './Boards';
import { saveRecord } from './games/storage';
import { api, useAccount } from './api';
import { useOnline } from './online';

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function OnlineGame({ view, exit }: { view: RoomView; exit: () => void }) {
  const { at, conn, send } = useOnline();
  const acct = useAccount();
  const [sel, setSel] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [saved, setSaved] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const game = useMemo(() => (view.chess ? new Chess(view.chess.fen) : null), [view.chess?.fen]); // eslint-disable-line react-hooks/exhaustive-deps
  const foe = view.players.find((p) => p.side !== view.you);
  const myTurn = view.status === 'playing' && view.turn === view.you;
  const timed = !!view.chess?.clocks;

  useEffect(() => { if (!timed) return; const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, [timed]);
  useEffect(() => { setSel(null); setPromo(null); }, [view.n]);
  useEffect(() => { if (view.status === 'over') acct.refresh(); }, [view.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (view.status !== 'over' || saved !== 'idle' || !view.result) return;
    const label = view.result.winner === 'draw' ? '무승부' : view.result.winner === view.you ? '승리' : '패배';
    setSaved(saveRecord({ id: crypto.randomUUID(), game: view.game, mode: `온라인${view.rated ? '(평가)' : ''} vs ${foe?.name ?? '?'}`, result: `${label} (${view.result.reason})`, moves: view.n, at: Date.now(),
      list: view.chess ? view.chess.history : view.gomoku?.moves.map(String) }) ? 'ok' : 'fail');
  }, [view, saved, foe]);

  const remain = (s: 'w' | 'b') => view.chess!.clocks![s] - (view.chess!.running === s ? now - at : 0);
  const targets = useMemo(() => (game && sel ? game.moves({ square: sel, verbose: true }) : []), [game, sel]);
  const clickSq = (sq: Square) => {
    if (!game || !myTurn || promo) return;
    if (sel) { const t = targets.filter((m) => m.to === sq); if (t.length) { t[0].promotion ? setPromo({ from: sel, to: sq }) : send({ t: 'move', n: view.n, from: sel, to: sq }); return; } }
    const p = game.get(sq); setSel(p && p.color === game.turn() ? sq : null);
  };
  const share = async () => {
    const url = `${location.origin}/?room=${view.code}`;
    try { if (navigator.share) await navigator.share({ title: 'Boardverse', text: `Boardverse 방 코드 ${view.code}`, url }); else await navigator.clipboard.writeText(url); setNote('링크를 복사했습니다.'); } catch { /* cancelled */ }
  };
  const sideName = (s: 'w' | 'b') => view.game === 'chess' ? (s === 'w' ? '백' : '흑') : (s === 'w' ? '흑돌' : '백돌');

  if (view.status === 'waiting') {
    return (
      <section className="setup">
        <h1>상대를 기다리는 중…</h1>
        <p>친구에게 이 코드를 알려주세요. {view.rated ? '(평가 대국: 로그인한 상대만 입장 가능)' : ''}</p>
        <p className="code" aria-label={`방 코드 ${view.code.split('').join(' ')}`}>{view.code}</p>
        <div className="row"><button className="primary" onClick={share}>링크 공유</button><button onClick={exit}>취소</button></div>
        {note && <p role="status" className="note">{note}</p>}
        <p className="note">내 색: {sideName(view.you)} · {view.rated ? '평가' : '친선'} · 방은 서버 메모리에만 있어 서버가 재시작되면 사라집니다.</p>
      </section>
    );
  }
  const st = view.status === 'over' ? '대국 종료' : myTurn ? '내 차례' : `${foe?.name ?? '상대'} 차례`;
  const bar = (s: 'w' | 'b') => {
    const p = view.players.find((x) => x.side === s);
    return <div className="player"><span>{p?.name ?? '?'} · {sideName(s)}{s === view.you ? ' (나)' : ''}{p && !p.registered ? ' · 게스트' : ''}{p && !p.connected ? ' · 연결 끊김' : ''}</span>
      {timed && <span className={`clock ${view.chess!.running === s ? 'active' : ''}`} aria-label={`${sideName(s)} 남은 시간`}>{fmt(remain(s))}</span>}</div>;
  };
  const top = view.you === 'w' ? 'b' : 'w';
  const iOffered = view.drawOffer === view.you, theyOffered = view.drawOffer && view.drawOffer !== view.you;
  const delta = view.result?.ratingDelta ? (view.you === 'w' ? view.result.ratingDelta.w : view.result.ratingDelta.b) : null;
  const rematchMine = view.rematch.includes(view.you);
  const report = async () => {
    const reason = prompt(`${foe?.name} 님을 신고하는 이유를 적어주세요.`); if (!reason || !foe) return;
    try { await api('/api/report', 'POST', { name: foe.name, reason }); setNote('신고가 접수되었습니다.'); } catch (e) { setNote((e as Error).message); }
  };

  return (
    <section className="play">
      <div className="boardcol">
        {bar(top)}
        {view.chess && game && <ChessBoard game={game} flip={view.you === 'b'} sel={sel} targets={targets} last={view.chess.last} onSquare={clickSq} />}
        {view.gomoku && <GomokuBoard size={view.gomoku.size} board={view.gomoku.board as never} lastIdx={view.gomoku.moves.at(-1)} winLine={view.gomoku.winLine} disabled={!myTurn} onPlace={(i) => send({ t: 'move', n: view.n, idx: i })} />}
        {bar(view.you)}
      </div>
      <aside className="side">
        {conn !== 'open' && <p className="banner" role="alert">연결이 끊겼습니다. 다시 연결하는 중…</p>}
        <p className="status" role="status" aria-live="polite">{st} <span className="badge">{view.rated ? '평가' : '친선'}</span></p>
        {theyOffered && view.status === 'playing' && <div className="banner" role="alert">상대가 무승부를 제안했습니다. <button className="primary" onClick={() => send({ t: 'draw', action: 'accept' })}>수락</button> <button onClick={() => send({ t: 'draw', action: 'decline' })}>거절</button></div>}
        {view.chess && <ol className="moves" aria-label="수 기록">{Array.from({ length: Math.ceil(view.chess.history.length / 2) }, (_, i) => <li key={i}>{view.chess!.history[2 * i]} {view.chess!.history[2 * i + 1] ?? ''}</li>)}</ol>}
        <div className="row">
          <button onClick={() => send({ t: 'draw', action: 'offer' })} disabled={view.status !== 'playing' || iOffered || !!view.drawOffer}>{iOffered ? '제안함' : '무승부 제안'}</button>
          <button onClick={() => confirm('기권할까요?') && send({ t: 'resign' })} disabled={view.status !== 'playing'}>기권</button>
          <button onClick={exit}>나가기</button>
        </div>
        {note && <p role="status" className="note">{note}</p>}
        {promo && game && (
          <div className="dialog" role="dialog" aria-label="승격할 기물 선택"><p>승격할 기물</p>
            {(['q', 'r', 'b', 'n'] as const).map((p) => <button key={p} onClick={() => { send({ t: 'move', n: view.n, from: promo.from, to: promo.to, promotion: p }); setPromo(null); }}>{GLYPH[game.turn() + p]} {PNAME[p]}</button>)}
          </div>
        )}
        {view.status === 'over' && view.result && (
          <div className="dialog result" role="alertdialog" aria-label="대국 결과">
            <h2>{view.result.winner === 'draw' ? '무승부' : view.result.winner === view.you ? '승리!' : '패배'}</h2>
            <p>{view.result.reason}</p>
            {view.rated ? <p>{delta !== null ? `레이팅 ${delta >= 0 ? '+' : ''}${delta}` : '레이팅 변화 없음 (수가 너무 적어 반영되지 않음)'}</p> : <p className="note">친선 대국은 레이팅에 반영되지 않습니다.</p>}
            <p className="note">{saved === 'ok' ? '전적이 이 브라우저에 저장되었습니다.' : saved === 'fail' ? '전적 저장에 실패했습니다.' : ''}{acct.user ? ' 서버 기록에도 저장되었습니다.' : ' 게스트 대국은 서버에 저장되지 않습니다.'}</p>
            <div className="row">
              <button className="primary" onClick={() => send({ t: 'rematch' })} disabled={rematchMine || !foe?.connected}>{rematchMine ? '상대 수락 대기…' : view.rematch.length ? '재대결 수락' : '재대결'}</button>
              {acct.user && foe?.registered && <button onClick={report}>상대 신고</button>}
              <button onClick={exit}>홈으로</button></div>
          </div>
        )}
      </aside>
    </section>
  );
}
