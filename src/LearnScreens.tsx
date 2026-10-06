import { useEffect, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { ChessBoard, GomokuBoard } from './Boards';
import { chessPuzzles, gomokuPuzzles, dailyPuzzle, isCorrectChessMove, isCorrectGomokuMove, opponentReply, gomokuPuzzleBoard, matesNow, forcesMate2, PUZZLE_TEXT, PUZZLE_TITLE, type ChessPuzzle, type GomokuPuzzle } from './puzzles';
import { loadHistory } from './games/storage';
import { newGomoku, playGomoku } from './games/gomoku';
import { api, useAccount } from './api';
import { GAME_NAME, fmtDate, useLoad } from './ui';

// ---------- puzzle progress (local only) ----------
const PKEY = 'boardverse.v1.puzzles';
interface Prog { solved: string[]; last: string | null; streak: number }
const today = () => new Date().toISOString().slice(0, 10);
export function loadProg(): Prog { try { const v = JSON.parse(localStorage.getItem(PKEY) ?? '{}'); return { solved: Array.isArray(v.solved) ? v.solved : [], last: v.last ?? null, streak: v.streak ?? 0 }; } catch { return { solved: [], last: null, streak: 0 }; } }
function markSolved(id: string): Prog {
  const p = loadProg(); const t = today();
  if (!p.solved.includes(id)) p.solved.push(id);
  if (p.last !== t) { const y = new Date(Date.now() - 86400_000).toISOString().slice(0, 10); p.streak = p.last === y ? p.streak + 1 : 1; p.last = t; }
  try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { /* ignore */ }
  return p;
}

export function LearnHome({ go }: { go: (s: 'puzzles' | 'replay' | 'help' | { puzzle: string }) => void }) {
  const [p] = useState(loadProg);
  const d = useMemo(() => dailyPuzzle(), []);
  const done = p.solved.includes(d.p.id);
  return (
    <section>
      <h1>학습</h1>
      <div className="cards">
        <article className="card"><h2>🧩 오늘의 문제</h2><p>{PUZZLE_TITLE[d.p.kind]} · {GAME_NAME[d.game]}{done ? ' · ✔ 해결' : ''}</p>
          <button className="primary" onClick={() => go({ puzzle: d.p.id })}>{done ? '다시 풀기' : '풀기'}</button>
          <p className="note">연속 {p.last === today() || p.last === new Date(Date.now() - 86400_000).toISOString().slice(0, 10) ? p.streak : 0}일 · 이 기기에만 저장됩니다.</p></article>
        <article className="card"><h2>퍼즐 모음</h2><p>체스 {chessPuzzles.length}문제 · 오목 {gomokuPuzzles.length}문제 (직접 생성·검증)</p><button onClick={() => go('puzzles')}>문제 목록</button></article>
        <article className="card"><h2>복기 · PGN</h2><p>지난 대국을 한 수씩 돌려보고, 체스는 PGN으로 내보내거나 불러올 수 있어요. (엔진 평가는 없는 단순 기보 뷰어입니다)</p><button onClick={() => go('replay')}>열기</button></article>
        <article className="card"><h2>규칙 · 조작법</h2><p>체스와 오목의 규칙 요약.</p><button onClick={() => go('help')}>도움말</button></article>
      </div>
    </section>
  );
}

export function PuzzleList({ open }: { open: (id: string) => void }) {
  const [p] = useState(loadProg);
  const grp = (title: string, list: { id: string; kind: keyof typeof PUZZLE_TITLE }[]) => (
    <><h2>{title}</h2><div className="grid2">{list.map((x, i) => <button key={x.id} onClick={() => open(x.id)}>{p.solved.includes(x.id) ? '✔ ' : ''}{i + 1}. {PUZZLE_TITLE[x.kind]}</button>)}</div></>);
  return <section><h1>퍼즐</h1><p className="note">진행 상황은 이 기기(localStorage)에만 저장됩니다.</p>{grp('체스', chessPuzzles)}{grp('오목', gomokuPuzzles)}</section>;
}

export function PuzzlePlay({ id, back }: { id: string; back: () => void }) {
  const cp = chessPuzzles.find((p) => p.id === id), gp = gomokuPuzzles.find((p) => p.id === id);
  if (cp) return <ChessPuzzlePlay p={cp} back={back} />;
  if (gp) return <GomokuPuzzlePlay p={gp} back={back} />;
  return <section><p className="banner err">문제를 찾을 수 없습니다.</p><button onClick={back}>뒤로</button></section>;
}

function Feedback({ t, ok }: { t: string; ok?: boolean }) { return <p role="status" aria-live="polite" className={ok ? "ok status" : "status"}>{t}</p>; }

function ChessPuzzlePlay({ p, back }: { p: ChessPuzzle; back: () => void }) {
  const [game] = useState(() => new Chess(p.fen));
  const [, force] = useState(0);
  const [sel, setSel] = useState<Square | null>(null);
  const [step, setStep] = useState<0 | 1>(0);
  const [msg, setMsg] = useState<{ t: string; ok?: boolean }>({ t: PUZZLE_TEXT[p.kind] });
  const [done, setDone] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const side = new Chess(p.fen).turn();
  const targets = sel ? game.moves({ square: sel, verbose: true }) : [];
  const click = (sq: Square) => {
    if (done) return;
    const t = targets.find((m) => m.to === sq);
    if (sel && t) {
      const mv = { from: sel, to: sq, promotion: t.promotion ? 'q' : undefined };
      if (!isCorrectChessMove(p, game, mv, step)) { setMsg({ t: '아쉬워요, 다시 생각해 보세요.' }); setSel(null); return; }
      game.move(mv); setSel(null); setHint(null); force((n) => n + 1);
      if (game.isCheckmate()) { setDone(true); setMsg({ t: '정답! 체크메이트입니다 🎉', ok: true }); markSolved(p.id); return; }
      setMsg({ t: '좋아요! 상대가 응수합니다…', ok: true });
      setTimeout(() => { const r = opponentReply(game); game.move(r); setStep(1); setMsg({ t: '이제 체크메이트를 완성하세요.' }); force((n) => n + 1); }, 600);
      return;
    }
    const pc = game.get(sq); setSel(pc && pc.color === game.turn() ? sq : null);
  };
  const reveal = () => {
    const c = game.moves({ verbose: true }).find((m) => (step === 1 || p.kind === 'mate1' ? matesNow(game).some((x) => x.san === m.san) : forcesMate2(game, m)));
    setHint(c ? c.from : null); setMsg({ t: '초록 칸의 기물이 핵심입니다.' });
  };
  return (
    <section className="play">
      <div className="boardcol"><ChessBoard game={game} flip={side === 'b'} sel={sel} targets={targets} last={null} onSquare={click} hint={hint as Square | null} /></div>
      <aside className="side"><h2>{PUZZLE_TITLE[p.kind]}</h2><p>{side === 'w' ? '백' : '흑'} 차례</p><Feedback {...msg} />
        <div className="row"><button onClick={reveal} disabled={done || step === 1 && game.turn() === (side === 'w' ? 'b' : 'w')}>힌트</button><button onClick={() => { game.load(p.fen); setStep(0); setDone(false); setSel(null); setHint(null); setMsg({ t: PUZZLE_TEXT[p.kind] }); force((n) => n + 1); }}>다시</button><button onClick={back}>목록</button></div></aside>
    </section>
  );
}

function GomokuPuzzlePlay({ p, back }: { p: GomokuPuzzle; back: () => void }) {
  const base = useMemo(() => gomokuPuzzleBoard(p), [p]);
  const [board, setBoard] = useState(base.board);
  const [msg, setMsg] = useState<{ t: string; ok?: boolean }>({ t: PUZZLE_TEXT[p.kind] });
  const [done, setDone] = useState(false);
  const [mark, setMark] = useState<number | undefined>();
  const place = (i: number) => {
    if (done) return;
    if (!isCorrectGomokuMove(p, i)) { setMsg({ t: '아쉬워요. 다시 생각해 보세요.' }); return; }
    const b = board.slice(); b[i] = p.toMove; setBoard(b); setMark(i); setDone(true); markSolved(p.id);
    setMsg({ t: p.kind === 'win1' ? '정답! 5목 완성 🎉' : '정답! 상대의 5목을 막았습니다 🎉', ok: true });
  };
  return (
    <section className="play">
      <div className="boardcol"><GomokuBoard size={p.size} board={board} lastIdx={mark} winLine={[]} disabled={done} onPlace={place} /></div>
      <aside className="side"><h2>{PUZZLE_TITLE[p.kind]}</h2><p>{p.toMove === 'B' ? '흑' : '백'} 차례</p><Feedback {...msg} />
        <div className="row"><button onClick={() => { setBoard(base.board); setDone(false); setMark(undefined); setMsg({ t: PUZZLE_TEXT[p.kind] }); }}>다시</button><button onClick={back}>목록</button></div></aside>
    </section>
  );
}

// ---------- replay & PGN ----------
export interface ReplayData { game: 'chess' | 'gomoku'; moves: string[]; title: string; size?: number; players?: [string, string]; result?: string }

export function ReplayView({ data, back }: { data: ReplayData; back: () => void }) {
  const [k, setK] = useState(data.moves.length);
  useEffect(() => setK(data.moves.length), [data]);
  const chess = useMemo(() => { if (data.game !== 'chess') return null; const g = new Chess(); let last: { from: string; to: string } | null = null; for (const m of data.moves.slice(0, k)) { const r = g.move(m); last = { from: r.from, to: r.to }; } return { g, last }; }, [data, k]);
  const gomoku = useMemo(() => { if (data.game !== 'gomoku') return null; let s = newGomoku(data.size ?? 15); for (const m of data.moves.slice(0, k)) s = playGomoku(s, Number(m)) ?? s; return s; }, [data, k]);
  const pgn = useMemo(() => {
    if (data.game !== 'chess') return '';
    const g = new Chess(); for (const m of data.moves) g.move(m);
    g.setHeader('Event', 'Boardverse'); g.setHeader('White', data.players?.[0] ?? '?'); g.setHeader('Black', data.players?.[1] ?? '?'); if (data.result) g.setHeader('Result', data.result);
    return g.pgn();
  }, [data]);
  return (
    <section className="play">
      <div className="boardcol">
        {chess && <ChessBoard game={chess.g} flip={false} sel={null} targets={[]} last={chess.last} onSquare={() => {}} />}
        {gomoku && <GomokuBoard size={gomoku.size} board={gomoku.board} lastIdx={gomoku.moves.at(-1)} winLine={k === data.moves.length ? gomoku.winLine : []} disabled readOnly onPlace={() => {}} />}
      </div>
      <aside className="side">
        <h2>{data.title}</h2>
        <p role="status">{k} / {data.moves.length}수</p>
        <input type="range" min={0} max={data.moves.length} value={k} onChange={(e) => setK(Number(e.target.value))} aria-label="수 이동" />
        <div className="stepper"><button onClick={() => setK(0)} aria-label="처음으로">⏮</button><button onClick={() => setK(Math.max(0, k - 1))} aria-label="이전 수">◀</button><button onClick={() => setK(Math.min(data.moves.length, k + 1))} aria-label="다음 수">▶</button><button onClick={() => setK(data.moves.length)} aria-label="마지막으로">⏭</button></div>
        {data.game === 'chess' && <><label className="field">PGN<textarea readOnly value={pgn} /></label>
          <div className="row"><button onClick={() => navigator.clipboard?.writeText(pgn)}>복사</button><a download="boardverse.pgn" href={`data:application/x-chess-pgn;charset=utf-8,${encodeURIComponent(pgn)}`}><button type="button">파일 저장</button></a></div></>}
        <button onClick={back}>뒤로</button>
      </aside>
    </section>
  );
}

export function ReplayHub({ open, serverGameId }: { open: (d: ReplayData) => void; serverGameId?: string }) {
  const a = useAccount();
  const [pgn, setPgn] = useState(''); const [err, setErr] = useState<string | null>(null);
  const local = useMemo(() => loadHistory().filter((r) => r.list?.length), []);
  const server = useLoad(async () => {
    if (!a.user) return null;
    if (serverGameId) { const g = await api<any>(`/api/games/${serverGameId}`); open({ game: g.game, moves: g.moves, title: `${g.white_name} vs ${g.black_name}`, players: [g.white_name, g.black_name], result: g.result === 'w' ? '1-0' : g.result === 'b' ? '0-1' : '1/2-1/2' }); }
    return (await api<{ games: any[] }>('/api/games')).games;
  }, [a.user?.id, serverGameId]);
  const importPgn = () => {
    try { const g = new Chess(); g.loadPgn(pgn.trim()); const moves = g.history(); if (!moves.length) throw new Error('수가 없습니다.'); setErr(null); open({ game: 'chess', moves, title: '불러온 PGN' }); }
    catch (e) { setErr(`PGN을 읽을 수 없습니다: ${(e as Error).message.split('\n')[0]}`); }
  };
  return (
    <section>
      <h1>복기</h1>
      <h2>이 기기의 기록</h2>
      {local.length ? <ul className="hist">{local.map((r) => <li key={r.id}>{GAME_NAME[r.game]} · {r.mode} · {r.result} · {fmtDate(r.at)} <button className="link" onClick={() => open({ game: r.game, moves: r.list!, title: `${GAME_NAME[r.game]} ${fmtDate(r.at)}` })}>복기</button></li>)}</ul> : <p className="empty">복기할 수 있는 대국이 아직 없습니다. 한 판 둔 뒤 다시 와 보세요.</p>}
      {a.user && <><h2>서버 기록</h2>{server.data?.length ? <ul className="hist">{server.data.map((g: any) => <li key={g.id}>{GAME_NAME[g.game as 'chess']} · {g.white_name} vs {g.black_name} · {fmtDate(g.created)} <button className="link" onClick={async () => { const f = await api<any>(`/api/games/${g.id}`); open({ game: f.game, moves: f.moves, title: `${f.white_name} vs ${f.black_name}`, players: [f.white_name, f.black_name], result: f.result === 'w' ? '1-0' : f.result === 'b' ? '0-1' : '1/2-1/2' }); }}>복기</button></li>)}</ul> : <p className="empty">서버 기록이 없습니다.</p>}</>}
      <h2>체스 PGN 불러오기</h2>
      <label className="field">PGN 붙여넣기<textarea value={pgn} onChange={(e) => setPgn(e.target.value)} placeholder="1. e4 e5 2. Nf3 ..." /></label>
      {err && <p className="banner err" role="alert">{err}</p>}
      <button className="primary" disabled={!pgn.trim()} onClick={importPgn}>불러오기</button>
    </section>
  );
}
