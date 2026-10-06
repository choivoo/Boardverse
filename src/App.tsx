import { useEffect, useMemo, useState } from 'react';
import { loadHistory, clearHistory } from './games/storage';
import { ChessGame } from './ChessGame';
import { GomokuGame } from './GomokuGame';
import { TIME_CONTROLS } from './games/chess';
import { GOMOKU_RULE_LABEL } from './games/gomoku';
import { OnlineScreen } from './OnlineScreen';
import { AccountProvider, useAccount } from './api';
import { OnlineProvider, useOnline, hasSavedRoom } from './online';
import { AuthScreen, FriendsScreen, LeaderboardScreen, ProfileScreen, PublicProfile, SeasonScreen, ShopScreen } from './AccountScreens';
import { LearnHome, PuzzleList, PuzzlePlay, ReplayHub, ReplayView, loadProg, type ReplayData } from './LearnScreens';
import { dailyPuzzle, PUZZLE_TITLE } from './puzzles';
import { seasonAt } from './seasons';
import { GAME_NAME } from './ui';

export type Opp = 'local' | 'bot';
export interface Setup { game: 'chess' | 'gomoku'; opp: Opp; level: 1 | 2 | 3; side: 'w' | 'b' | 'random'; time: string; size: number }
type Screen =
  | { name: 'home' } | { name: 'play' } | { name: 'setup'; game: 'chess' | 'gomoku'; opp: Opp } | { name: 'game'; setup: Setup }
  | { name: 'online'; code?: string } | { name: 'learn' } | { name: 'puzzles' } | { name: 'puzzle'; id: string }
  | { name: 'replayhub'; serverGame?: string } | { name: 'replay'; data: ReplayData } | { name: 'help' } | { name: 'ranking' }
  | { name: 'me' } | { name: 'auth' } | { name: 'shop' } | { name: 'season' } | { name: 'friends' } | { name: 'user'; who: string };

const TAB: Record<string, string> = { home: 'home', play: 'play', setup: 'play', game: 'play', online: 'play', learn: 'learn', puzzles: 'learn', puzzle: 'learn', replayhub: 'learn', replay: 'learn', help: 'learn', ranking: 'ranking', me: 'me', auth: 'me', shop: 'me', season: 'me', friends: 'me', user: 'ranking' };
const LEVELS = [{ v: 1, l: '초급' }, { v: 2, l: '보통' }, { v: 3, l: '어려움' }] as const;
const LEVEL_TEXT: Record<'chess' | 'gomoku', Record<number, string>> = {
  chess: { 1: '무작위 합법 수를 둡니다.', 2: '한 수 앞의 기물 득실만 봅니다.', 3: '상대 응수까지 두 수 앞을 봅니다. (강한 엔진이 아닙니다)' },
  gomoku: { 1: '돌 근처에 무작위로 둡니다.', 2: '바로 이길 수 있으면 두고, 상대의 5목을 막습니다.', 3: '패턴(열린 3·4)을 점수로 평가합니다. (강한 엔진이 아닙니다)' },
};

export function App() {
  return <AccountProvider><Shell /></AccountProvider>;
}

function Shell() {
  const acct = useAccount();
  const [screen, setScreen] = useState<Screen>(() => {
    const code = new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 5);
    return code || hasSavedRoom() ? { name: 'online', code } : { name: 'home' };
  });
  const [round, setRound] = useState(0);
  const go = (s: Screen) => { setScreen(s); window.scrollTo(0, 0); };
  const home = () => { go({ name: 'home' }); if (location.search) history.replaceState(null, '', '/'); };
  const online = screen.name === 'online' || acct.status === 'user' || hasSavedRoom();
  return (
    <OnlineProvider enabled={online} identity={acct.user?.id ?? null}>
      <Frame screen={screen} go={go} home={home} round={round} again={() => setRound((n) => n + 1)} />
    </OnlineProvider>
  );
}

function Frame({ screen, go, home, round, again }: { screen: Screen; go: (s: Screen) => void; home: () => void; round: number; again: () => void }) {
  const acct = useAccount();
  const o = useOnline();
  const toAuth = () => go({ name: 'auth' });
  // a room (e.g. matchmaking result) may appear while the player is elsewhere
  useEffect(() => { if (o.view && screen.name !== 'online') go({ name: 'online' }); }, [o.view?.code]); // eslint-disable-line react-hooks/exhaustive-deps
  const inGame = screen.name === 'game' || (screen.name === 'online' && !!o.view);
  return (
    <>
      <a className="skip" href="#main">본문으로 건너뛰기</a>
      <header className="top">
        <button className="brand" onClick={home} aria-label="Boardverse 홈"><img src="/wordmark.svg" alt="Boardverse" height="32" /></button>
        <nav aria-label="계정">{acct.user ? <button className="link" onClick={() => go({ name: 'me' })}><span className="nm">🪙 {acct.user.coins} · {acct.user.name}</span></button> : <button className="link" onClick={toAuth}>로그인</button>}</nav>
      </header>
      {o.invites[0] && (
        <div className="toast" role="alert"><span>{o.invites[0].from} 님이 {GAME_NAME[o.view?.game ?? 'chess'] ? '대국' : ''}에 초대했어요 ({o.invites[0].code})</span>
          <span><button className="primary" onClick={() => { const inv = o.invites[0]; o.dismissInvite(inv.code); o.send({ t: 'join', code: inv.code, name: acct.user?.name ?? '' }); go({ name: 'online' }); }}>참가</button> <button onClick={() => o.dismissInvite(o.invites[0].code)}>무시</button></span></div>
      )}
      {o.info && <div className="toast" role="status">{o.info}</div>}
      <main id="main" tabIndex={-1}>
        {screen.name === 'home' && <Home go={go} />}
        {screen.name === 'play' && <PlayHub go={go} />}
        {screen.name === 'setup' && <SetupScreen s={screen} go={go} />}
        {screen.name === 'game' && (screen.setup.game === 'chess' ? <ChessGame key={round} setup={screen.setup} exit={home} again={again} /> : <GomokuGame key={round} setup={screen.setup} exit={home} />)}
        {screen.name === 'online' && <OnlineScreen joinCode={screen.code} exit={home} login={toAuth} />}
        {screen.name === 'learn' && <LearnHome go={(t) => go(t === 'puzzles' ? { name: 'puzzles' } : t === 'replay' ? { name: 'replayhub' } : t === 'help' ? { name: 'help' } : { name: 'puzzle', id: t.puzzle })} />}
        {screen.name === 'puzzles' && <PuzzleList open={(id) => go({ name: 'puzzle', id })} />}
        {screen.name === 'puzzle' && <PuzzlePlay id={screen.id} back={() => go({ name: 'puzzles' })} />}
        {screen.name === 'replayhub' && <ReplayHub open={(data) => go({ name: 'replay', data })} serverGameId={screen.serverGame} />}
        {screen.name === 'replay' && <ReplayView data={screen.data} back={() => go({ name: 'replayhub' })} />}
        {screen.name === 'help' && <Help back={() => go({ name: 'learn' })} />}
        {screen.name === 'ranking' && <LeaderboardScreen profile={(who) => go({ name: 'user', who })} />}
        {screen.name === 'user' && <PublicProfile name={screen.who} back={() => go({ name: 'ranking' })} />}
        {screen.name === 'me' && <ProfileScreen go={(t) => go({ name: t })} replay={(id) => go({ name: 'replayhub', serverGame: id })} />}
        {screen.name === 'auth' && <AuthScreen done={() => go({ name: 'me' })} />}
        {screen.name === 'shop' && <ShopScreen login={toAuth} />}
        {screen.name === 'season' && <SeasonScreen login={toAuth} />}
        {screen.name === 'friends' && <FriendsScreen login={toAuth} profile={(who) => go({ name: 'user', who })} />}
      </main>
      {!inGame && (
        <nav className="tabs" aria-label="주 메뉴">
          {([['home', '🏠', '홈', { name: 'home' }], ['play', '🎲', '플레이', { name: 'play' }], ['learn', '🧩', '학습', { name: 'learn' }], ['ranking', '🏆', '랭킹', { name: 'ranking' }], ['me', '👤', '내 정보', { name: 'me' }]] as const).map(([k, ic, label, target]) => (
            <button key={k} aria-current={TAB[screen.name] === k ? 'page' : undefined} onClick={() => go(target as Screen)}><span className="ic" aria-hidden="true">{ic}</span>{label}</button>))}
        </nav>
      )}
    </>
  );
}

function Home({ go }: { go: (s: Screen) => void }) {
  const [hist, setHist] = useState(loadHistory);
  const acct = useAccount();
  const d = useMemo(() => dailyPuzzle(), []);
  const solved = loadProg().solved.includes(d.p.id);
  const season = seasonAt(Date.now());
  return (
    <section>
      <h1>보드게임 클럽, 지금 바로 한 판.</h1>
      <p className="lead">체스와 오목을 가입 없이 즐기고, 로그인하면 레이팅·시즌·상점까지.</p>
      <div className="cards">
        {(['chess', 'gomoku'] as const).map((g) => (
          <article className="card" key={g}>
            <img src={`/card-${g}.svg`} alt="" width="120" height="80" />
            <h2>{GAME_NAME[g]}</h2>
            <p>{g === 'chess' ? '표준 규칙, 체스 시계, 캐슬링·앙파상·승격.' : `프리스타일(5목 이상, 금수 없음), 13/15/19 판.`}</p>
            <div className="row">
              <button className="primary" onClick={() => go({ name: 'setup', game: g, opp: 'bot' })}>컴퓨터와</button>
              <button onClick={() => go({ name: 'setup', game: g, opp: 'local' })}>같은 기기</button>
              <button onClick={() => go({ name: 'online' })}>온라인</button>
            </div>
          </article>
        ))}
        <article className="card"><h2>🧩 오늘의 문제</h2><p>{GAME_NAME[d.game]} · {PUZZLE_TITLE[d.p.kind]}{solved ? ' · ✔ 해결' : ''}</p><button onClick={() => go({ name: 'puzzle', id: d.p.id })}>풀어보기</button></article>
        <article className="card"><h2>🏆 시즌</h2>{season ? <p>{season.name} 진행 중 · 평가 대국으로 보상을 모으세요.</p> : <p>진행 중인 시즌이 없습니다.</p>}<button onClick={() => go({ name: 'season' })}>자세히</button>
          {!acct.user && <p className="note">평가 대국과 시즌은 로그인이 필요해요.</p>}</article>
      </div>
      <p className="note">{acct.status === 'offline' ? '서버에 연결할 수 없어 온라인 기능이 꺼져 있습니다. 로컬·컴퓨터 대국은 그대로 가능합니다.' : acct.user ? '로그인됨 · 온라인 전적은 서버에 저장됩니다.' : '게스트 플레이 중 · 전적은 이 브라우저에만 저장됩니다.'}</p>
      <h2>최근 게임 (이 기기)</h2>
      {hist.length === 0 ? <p className="empty">아직 기록된 게임이 없어요. 첫 판을 시작해 보세요!</p> : (
        <>
          <ul className="hist">{hist.slice(0, 6).map((r) => <li key={r.id}>{GAME_NAME[r.game]} · {r.mode} · <strong>{r.result}</strong> · {r.moves}수{r.list?.length ? <> <button className="link" onClick={() => go({ name: 'replay', data: { game: r.game, moves: r.list!, title: `${GAME_NAME[r.game]} 복기` } })}>복기</button></> : null}</li>)}</ul>
          <button className="link" onClick={() => { clearHistory(); setHist([]); }}>기록 지우기</button>
        </>
      )}
    </section>
  );
}

function PlayHub({ go }: { go: (s: Screen) => void }) {
  return (
    <section>
      <h1>플레이</h1>
      <div className="cards">
        <article className="card"><h2>🌐 온라인</h2><p>빠른 매칭, 친구 방 코드, 평가 대국(로그인).</p><button className="primary" onClick={() => go({ name: 'online' })}>온라인으로 하기</button></article>
        {(['chess', 'gomoku'] as const).map((g) => (
          <article className="card" key={g}><h2>{GAME_NAME[g]} 연습</h2><p>인터넷 없이도 가능합니다.</p>
            <div className="row"><button onClick={() => go({ name: 'setup', game: g, opp: 'bot' })}>컴퓨터와</button><button onClick={() => go({ name: 'setup', game: g, opp: 'local' })}>같은 기기 2인</button></div></article>))}
      </div>
    </section>
  );
}

function SetupScreen({ s, go }: { s: Extract<Screen, { name: 'setup' }>; go: (s: Screen) => void }) {
  const [cfg, setCfg] = useState<Setup>({ game: s.game, opp: s.opp, level: 2, side: 'w', time: 'none', size: innerWidth < 420 ? 13 : 15 });
  const set = <K extends keyof Setup>(k: K, v: Setup[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const chess = s.game === 'chess';
  return (
    <section className="setup">
      <h1>{chess ? '체스' : '오목'} 게임 준비</h1>
      <p>{s.opp === 'bot' ? '컴퓨터와 대국 (오프라인 실행 · 비평가)' : '같은 기기에서 2인 대국 (비평가)'}</p>
      {s.opp === 'bot' && (
        <fieldset><legend>난이도</legend>
          {LEVELS.map((l) => <label key={l.v}><input type="radio" name="lv" checked={cfg.level === l.v} onChange={() => set('level', l.v)} /> {l.l}</label>)}
          <p className="note">{LEVEL_TEXT[s.game][cfg.level]}</p>
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
      <div className="row"><button className="primary" onClick={() => go({ name: 'game', setup: cfg })}>시작</button><button onClick={() => go({ name: 'play' })}>뒤로</button></div>
    </section>
  );
}

function Help({ back }: { back: () => void }) {
  return (
    <section className="help">
      <h1>도움말</h1>
      <h2>체스</h2>
      <p>기물을 선택(탭/Enter)하면 이동 가능한 칸이 표시됩니다. 목적지를 선택해 이동하세요. 체크메이트하면 승리, 스테일메이트·기물 부족·3회 반복·50수 규칙은 무승부입니다. 폰이 끝 줄에 도달하면 승격할 기물을 고릅니다.</p>
      <h2>오목</h2>
      <p>흑이 먼저 둡니다. 가로·세로·대각선으로 같은 색 돌 5개 이상을 먼저 이으면 승리하며, 금수 규칙은 없습니다(프리스타일). 판이 가득 차면 무승부입니다. 터치 기기에서는 탭으로 위치를 미리 보고 "착수"로 확정합니다.</p>
      <h2>평가 대국과 레이팅</h2>
      <p>로그인한 두 사람이 평가 대국을 하면 Elo 방식으로 레이팅이 바뀝니다(시작 1200, 20판 미만 K=40, 이후 K=20). 체스와 오목은 따로 계산되며, 수가 2개 미만인 대국·게스트·컴퓨터 대국·친선 대국은 반영되지 않습니다.</p>
      <h2>데이터 저장</h2>
      <p>게스트: 최근 기록(최대 50개)과 퍼즐 진행은 이 브라우저(localStorage)에만 저장됩니다. 로그인: 계정, 레이팅, 코인, 보유 아이템, 온라인 대국 기록은 서버 DB에 저장되며 내 정보에서 내보내기·삭제할 수 있습니다. 진행 중인 컴퓨터/로컬 대국은 새로고침하면 사라집니다.</p>
      <button onClick={back}>뒤로</button>
    </section>
  );
}
