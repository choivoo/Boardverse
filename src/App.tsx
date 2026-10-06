import { useState } from 'react';
import { loadHistory, clearHistory } from './games/storage';
import { ChessGame } from './ChessGame';
import { GomokuGame } from './GomokuGame';
import { TIME_CONTROLS } from './games/chess';
import { GOMOKU_RULE_LABEL } from './games/gomoku';

export type Opp = 'local' | 'bot';
export interface Setup {
  game: 'chess' | 'gomoku';
  opp: Opp;
  level: 1 | 2 | 3;
  side: 'w' | 'b' | 'random';
  time: string;
  size: number;
}
type Screen = { name: 'home' } | { name: 'setup'; game: 'chess' | 'gomoku'; opp: Opp } | { name: 'play'; setup: Setup } | { name: 'help' };

const LEVELS = [{ v: 1, l: '초급' }, { v: 2, l: '보통' }, { v: 3, l: '어려움' }] as const;

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [round, setRound] = useState(0);
  const home = () => setScreen({ name: 'home' });
  return (
    <>
      <a className="skip" href="#main">본문으로 건너뛰기</a>
      <header className="top">
        <button className="brand" onClick={home} aria-label="Boardverse 홈">
          <img src="/logo.svg" alt="" width="32" height="32" /> Boardverse
        </button>
        <nav aria-label="주요 메뉴">
          <button className="link" onClick={() => setScreen({ name: 'help' })}>도움말</button>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {screen.name === 'home' && <Home go={setScreen} />}
        {screen.name === 'setup' && <SetupScreen s={screen} go={setScreen} />}
        {screen.name === 'help' && <Help back={home} />}
        {screen.name === 'play' && (screen.setup.game === 'chess'
          ? <ChessGame key={round} setup={screen.setup} exit={home} again={() => setRound((n) => n + 1)} />
          : <GomokuGame setup={screen.setup} exit={home} />)}
      </main>
    </>
  );
}

function Home({ go }: { go: (s: Screen) => void }) {
  const [hist, setHist] = useState(loadHistory);
  return (
    <section>
      <h1>보드게임 클럽, 지금 바로 한 판.</h1>
      <p className="lead">가입 없이 체스와 오목을 즐기세요. 컴퓨터와 겨루거나 한 기기에서 친구와 번갈아 두세요.</p>
      <div className="cards">
        {(['chess', 'gomoku'] as const).map((g) => (
          <article className="card" key={g}>
            <h2>{g === 'chess' ? '♞ 체스' : '● 오목'}</h2>
            <p>{g === 'chess' ? '표준 규칙, 체스 시계, 캐슬링·앙파상·승격 지원.' : `15×15 판, ${GOMOKU_RULE_LABEL}.`}</p>
            <div className="row">
              <button className="primary" onClick={() => go({ name: 'setup', game: g, opp: 'bot' })}>컴퓨터와 하기</button>
              <button onClick={() => go({ name: 'setup', game: g, opp: 'local' })}>친구와 하기 (같은 기기)</button>
            </div>
          </article>
        ))}
      </div>
      <p className="note">온라인 대국과 계정 로그인은 1.0에 포함되지 않습니다. 게스트로 플레이하며, 전적은 이 브라우저에만 저장됩니다.</p>
      <h2>최근 게임</h2>
      {hist.length === 0 ? <p className="empty">아직 기록된 게임이 없어요. 첫 판을 시작해 보세요!</p> : (
        <>
          <ul className="hist">
            {hist.slice(0, 8).map((r) => (
              <li key={r.id}>{r.game === 'chess' ? '체스' : '오목'} · {r.mode} · <strong>{r.result}</strong> · {r.moves}수 · {new Date(r.at).toLocaleDateString('ko-KR')}</li>
            ))}
          </ul>
          <button className="link" onClick={() => { clearHistory(); setHist([]); }}>기록 지우기</button>
        </>
      )}
    </section>
  );
}

function SetupScreen({ s, go }: { s: Extract<Screen, { name: 'setup' }>; go: (s: Screen) => void }) {
  const [cfg, setCfg] = useState<Setup>({ game: s.game, opp: s.opp, level: 2, side: 'w', time: 'none', size: 15 });
  const set = <K extends keyof Setup>(k: K, v: Setup[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const chess = s.game === 'chess';
  return (
    <section className="setup">
      <h1>{chess ? '체스' : '오목'} 게임 준비</h1>
      <p>{s.opp === 'bot' ? '컴퓨터와 대국' : '같은 기기에서 2인 대국'}</p>
      {s.opp === 'bot' && (
        <fieldset><legend>난이도</legend>
          {LEVELS.map((l) => <label key={l.v}><input type="radio" name="lv" checked={cfg.level === l.v} onChange={() => set('level', l.v)} /> {l.l}</label>)}
        </fieldset>
      )}
      <fieldset><legend>내 색</legend>
        {([['w', chess ? '백' : '흑 (선공)'], ['b', chess ? '흑' : '백 (후공)'], ['random', '무작위']] as const).map(([v, l]) =>
          <label key={v}><input type="radio" name="side" checked={cfg.side === v} onChange={() => set('side', v)} /> {l}</label>)}
      </fieldset>
      {chess ? (
        <fieldset><legend>시간</legend>
          {TIME_CONTROLS.map((t) => <label key={t.id}><input type="radio" name="tc" checked={cfg.time === t.id} onChange={() => set('time', t.id)} /> {t.label}</label>)}
        </fieldset>
      ) : (
        <fieldset><legend>보드 크기</legend>
          {[13, 15, 19].map((n) => <label key={n}><input type="radio" name="sz" checked={cfg.size === n} onChange={() => set('size', n)} /> {n}×{n}</label>)}
          <p className="note">규칙: {GOMOKU_RULE_LABEL}</p>
        </fieldset>
      )}
      <div className="row">
        <button className="primary" onClick={() => go({ name: 'play', setup: cfg })}>시작</button>
        <button onClick={() => go({ name: 'home' })}>뒤로</button>
      </div>
    </section>
  );
}

function Help({ back }: { back: () => void }) {
  return (
    <section className="help">
      <h1>도움말</h1>
      <h2>체스</h2>
      <p>기물을 선택(클릭/Enter)하면 이동 가능한 칸이 표시됩니다. 목적지를 선택해 이동하세요. 체크메이트하면 승리, 스테일메이트·기물 부족·3회 반복·50수 규칙은 무승부입니다. 폰이 끝 줄에 도달하면 승격할 기물을 고릅니다.</p>
      <h2>오목</h2>
      <p>흑이 먼저 둡니다. 가로·세로·대각선으로 같은 색 돌 5개 이상을 먼저 이으면 승리하며, 금수 규칙은 없습니다(프리스타일). 판이 가득 차면 무승부입니다.</p>
      <h2>조작</h2>
      <p>보드는 Tab으로 진입해 방향키로 칸을 이동하고 Enter/Space로 선택합니다. 모바일에서는 칸을 탭하세요.</p>
      <h2>데이터 저장</h2>
      <p>계정과 서버가 없습니다. 최근 게임 기록(최대 50개)은 이 브라우저의 localStorage에만 저장되며, 홈에서 지울 수 있습니다. 진행 중인 게임은 저장되지 않습니다.</p>
      <button onClick={back}>홈으로</button>
    </section>
  );
}
