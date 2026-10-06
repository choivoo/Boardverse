import { useEffect, useState } from 'react';
import type { Setup } from './App';
import { gomokuBot, newGomoku, playGomoku, undoGomoku, GOMOKU_RULE_LABEL, type Stone } from './games/gomoku';
import { saveRecord } from './games/storage';
import { GomokuBoard, stoneName } from './Boards';

export function GomokuGame({ setup, exit }: { setup: Setup; exit: () => void }) {
  const [mine, setMine] = useState<Stone>(() => setup.side === 'random' ? (Math.random() < 0.5 ? 'B' : 'W') : setup.side === 'w' ? 'B' : 'W');
  const [s, setS] = useState(() => newGomoku(setup.size));
  const [saved, setSaved] = useState<'idle' | 'ok' | 'fail'>('idle');
  const botTurn = setup.opp === 'bot' && s.turn !== mine && s.status === 'playing';
  const name = stoneName;
  const lastIdx = s.moves.at(-1);

  useEffect(() => {
    if (!botTurn) return;
    const id = setTimeout(() => { const m = gomokuBot(s, setup.level); const n = m >= 0 ? playGomoku(s, m) : null; if (n) setS(n); }, 350);
    return () => clearTimeout(id);
  }, [botTurn, s, setup.level]);

  useEffect(() => {
    if (s.status === 'playing' || saved !== 'idle') return;
    const label = s.status === 'draw' ? '무승부' : setup.opp === 'bot' ? (s.winner === mine ? '승리' : '패배') : `${name(s.winner!)} 승`;
    setSaved(saveRecord({ id: crypto.randomUUID(), game: 'gomoku', mode: setup.opp === 'bot' ? `컴퓨터(${['', '초급', '보통', '어려움'][setup.level]})` : '2인', result: `${label} (${s.size}×${s.size})`, moves: s.moves.length, at: Date.now() }) ? 'ok' : 'fail');
  }, [s, saved, setup, mine]);

  const place = (i: number) => { if (botTurn) return; const n = playGomoku(s, i); if (n) setS(n); };
  const restart = () => { setS(newGomoku(setup.size)); setSaved('idle'); if (setup.side === 'random') setMine(Math.random() < 0.5 ? 'B' : 'W'); };
  const undo = () => setS(undoGomoku(s, setup.opp === 'bot' ? (botTurn ? 0 : 2) : 1));
  const status = s.status === 'playing' ? `${name(s.turn)} 차례${botTurn ? ' (컴퓨터 생각 중…)' : ''}` : '대국 종료';

  return (
    <section className="play">
      <div className="boardcol">
        <div className="player"><span>{setup.opp === 'bot' ? `나: ${name(mine)} · 컴퓨터: ${name(mine === 'B' ? 'W' : 'B')}` : '흑 vs 백 (같은 기기)'}</span></div>
        <GomokuBoard size={s.size} board={s.board} lastIdx={lastIdx} winLine={s.winLine} disabled={botTurn || s.status !== 'playing'} onPlace={place} />
      </div>
      <aside className="side">
        <p className="status" role="status" aria-live="polite">{status}</p>
        <p className="note">규칙: {GOMOKU_RULE_LABEL}</p>
        <p>착수 {s.moves.length}수</p>
        <div className="row">
          <button onClick={undo} disabled={s.status !== 'playing' || s.moves.length === 0 || botTurn}>되돌리기</button>
          <button onClick={restart}>재시작</button>
          <button onClick={exit}>나가기</button>
        </div>
        {s.status !== 'playing' && (
          <div className="dialog result" role="alertdialog" aria-label="대국 결과">
            <h2>{s.status === 'draw' ? '무승부' : `${name(s.winner!)} 승리`}</h2>
            <p>{s.status === 'draw' ? '판이 가득 찼습니다.' : '5목 완성'}</p>
            <p className="note">{saved === 'ok' ? '전적이 이 브라우저에 저장되었습니다.' : saved === 'fail' ? '전적 저장에 실패했습니다 (브라우저 저장소 사용 불가).' : ''}</p>
            <div className="row"><button className="primary" onClick={restart}>다시 하기</button><button onClick={exit}>홈으로</button></div>
          </div>
        )}
      </aside>
    </section>
  );
}
