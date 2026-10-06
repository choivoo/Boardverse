import { useState } from 'react';
import { useOnline } from './online';
import { useAccount } from './api';
import { OnlineGame } from './OnlineGame';
import { TIME_CONTROLS } from './games/chess';
import type { GameKind } from './protocol';

const getName = () => { try { return localStorage.getItem('boardverse.v1.name') ?? ''; } catch { return ''; } };

export function OnlineScreen({ joinCode, exit, login }: { joinCode?: string; exit: () => void; login: () => void }) {
  const { view, conn, error, queued, send, leave, setError } = useOnline();
  const acct = useAccount();
  const [name, setName] = useState(getName);
  const [code, setCode] = useState(joinCode ?? '');
  const [game, setGame] = useState<GameKind>('chess');
  const [side, setSide] = useState<'w' | 'b' | 'random'>('random');
  const [time, setTime] = useState('10+0');
  const [size, setSize] = useState(innerWidth < 420 ? 13 : 15);
  const [rated, setRated] = useState(false);
  const [watchQuick, setWatchQuick] = useState(true); const [watchRoom, setWatchRoom] = useState(false);
  const remember = () => { try { localStorage.setItem('boardverse.v1.name', name.trim()); } catch { /* ignore */ } };

  if (view) return <OnlineGame view={view} exit={() => { send({ t: 'unqueue' }); send({ t: 'unwatch' }); leave(); exit(); }} />;
  const ready = conn === 'open';
  const loggedIn = !!acct.user;
  const opts = { game, time, size, rated: rated && loggedIn };
  const needVerify = !!acct.user && !acct.user.emailVerified && !!acct.config?.emailRequiredForRated;
  return (
    <section className="setup">
      <h1>온라인 대국</h1>
      <p className="note">규칙과 시계는 서버가 판정합니다. {loggedIn ? `${acct.user!.name} 님으로 접속 중.` : '게스트로 접속 중 — 평가 대국·서버 전적은 로그인 후 가능합니다.'}</p>
      {!loggedIn && <button onClick={login}>로그인 / 가입</button>}
      {conn !== 'open' && <p className="banner" role="status">{conn === 'connecting' ? '서버에 연결 중…' : '서버에 연결할 수 없습니다. 자동으로 다시 시도합니다.'}</p>}
      {error && <p className="banner err" role="alert">{error}</p>}
      {!loggedIn && <label className="field">닉네임 <input value={name} maxLength={16} placeholder="게스트" autoComplete="nickname" onChange={(e) => setName(e.target.value)} /></label>}
      <fieldset><legend>게임 설정</legend>
        <div>{(['chess', 'gomoku'] as const).map((g) => <label key={g}><input type="radio" name="og" checked={game === g} onChange={() => setGame(g)} /> {g === 'chess' ? '체스' : '오목'}</label>)}</div>
        {game === 'chess'
          ? <div>{TIME_CONTROLS.map((t) => <label key={t.id}><input type="radio" name="ot" checked={time === t.id} onChange={() => setTime(t.id)} /> {t.label}</label>)}</div>
          : <div>{[13, 15, 19].map((n) => <label key={n}><input type="radio" name="oz" checked={size === n} onChange={() => setSize(n)} /> {n}×{n}</label>)}<p className="note">프리스타일(5목 이상, 금수 없음)</p></div>}
        <label><input type="checkbox" checked={rated && loggedIn} disabled={!loggedIn || needVerify} onChange={(e) => setRated(e.target.checked)} /> 평가 대국 (레이팅 반영{loggedIn ? (needVerify ? ' · 이메일 인증 필요' : '') : ' · 로그인 필요'}) — 평가 대국은 관전 불가</label>
      </fieldset>
      <fieldset><legend>빠른 매칭</legend>
        {queued ? <><p role="status">상대를 찾는 중… (같은 설정의 플레이어를 기다립니다)</p><button onClick={() => send({ t: 'unqueue' })}>취소</button></>
          : <button className="primary" disabled={!ready} onClick={() => { remember(); send({ t: 'queue', name, ...opts, spectate: watchQuick }); }}>상대 찾기</button>}
        <label><input type="checkbox" checked={watchQuick} disabled={rated && loggedIn} onChange={(e) => setWatchQuick(e.target.checked)} /> 관전 허용 (다른 사람이 읽기 전용으로 볼 수 있음)</label>
        {rated && loggedIn && <p className="note">평가 매칭은 레이팅 차이 ±400 이내의 상대와 연결됩니다. 대기 중인 사람이 없으면 계속 기다립니다.</p>}
      </fieldset>
      <fieldset><legend>친구와 하기</legend>
        <div className="row"><button disabled={!ready} onClick={() => { remember(); send({ t: 'create', name, side, ...opts, spectate: watchRoom }); }}>방 만들기</button></div>
        <label><input type="checkbox" checked={watchRoom} disabled={rated && loggedIn} onChange={(e) => setWatchRoom(e.target.checked)} /> 관전 허용 (기본 꺼짐: 친구 방은 비공개)</label>
        <div>{([['random', '무작위'], ['w', game === 'chess' ? '백' : '흑(선공)'], ['b', game === 'chess' ? '흑' : '백']] as const).map(([v, l]) => <label key={v}><input type="radio" name="os" checked={side === v} onChange={() => setSide(v)} /> {l}</label>)}</div>
        <label className="field">방 코드로 입장 <input value={code} maxLength={5} autoCapitalize="characters" autoCorrect="off" onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }} /></label>
        <button className="primary" disabled={!ready || code.length !== 5} onClick={() => { remember(); send({ t: 'join', code, name }); }}>입장</button>
      </fieldset>
      <button onClick={exit}>뒤로</button>
    </section>
  );
}
