import { useState } from 'react';
import { useRoom } from './online';
import { OnlineGame } from './OnlineGame';
import { TIME_CONTROLS } from './games/chess';
import type { GameKind } from './protocol';

const getName = () => { try { return localStorage.getItem('boardverse.v1.name') ?? ''; } catch { return ''; } };

export function OnlineScreen({ joinCode, exit }: { joinCode?: string; exit: () => void }) {
  const { view, conn, error, at, send, leave, setError } = useRoom(true);
  const [name, setName] = useState(getName);
  const [code, setCode] = useState(joinCode ?? '');
  const [game, setGame] = useState<GameKind>('chess');
  const [side, setSide] = useState<'w' | 'b' | 'random'>('random');
  const [time, setTime] = useState('none');
  const [size, setSize] = useState(innerWidth < 420 ? 13 : 15);
  const remember = () => { try { localStorage.setItem('boardverse.v1.name', name.trim()); } catch { /* ignore */ } };

  if (view) return <OnlineGame view={view} at={at} conn={conn} send={send} exit={() => { leave(); exit(); }} />;
  const ready = conn === 'open';
  return (
    <section className="setup">
      <h1>온라인 대국</h1>
      <p className="note">로그인 없이 방 코드로 친구와 대결합니다. 규칙과 시계는 서버가 판정합니다.</p>
      {conn !== 'open' && <p className="banner" role="status">{conn === 'connecting' ? '서버에 연결 중…' : '서버에 연결할 수 없습니다. 자동으로 다시 시도합니다.'}</p>}
      {error && <p className="banner err" role="alert">{error}</p>}
      <label className="field">닉네임 <input value={name} maxLength={16} placeholder="게스트" autoComplete="nickname" onChange={(e) => setName(e.target.value)} /></label>
      <fieldset><legend>방 입장</legend>
        <label className="field">방 코드 <input value={code} maxLength={5} autoCapitalize="characters" autoCorrect="off" inputMode="text" onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }} /></label>
        <button className="primary" disabled={!ready || code.length !== 5} onClick={() => { remember(); send({ t: 'join', code, name }); }}>입장</button>
      </fieldset>
      <fieldset><legend>새 방 만들기</legend>
        <div>{(['chess', 'gomoku'] as const).map((g) => <label key={g}><input type="radio" name="og" checked={game === g} onChange={() => setGame(g)} /> {g === 'chess' ? '체스' : '오목'}</label>)}</div>
        <div>{([['random', '무작위'], ['w', game === 'chess' ? '백' : '흑(선공)'], ['b', game === 'chess' ? '흑' : '백']] as const).map(([v, l]) => <label key={v}><input type="radio" name="os" checked={side === v} onChange={() => setSide(v)} /> {l}</label>)}</div>
        {game === 'chess'
          ? <div>{TIME_CONTROLS.map((t) => <label key={t.id}><input type="radio" name="ot" checked={time === t.id} onChange={() => setTime(t.id)} /> {t.label}</label>)}</div>
          : <div>{[13, 15, 19].map((n) => <label key={n}><input type="radio" name="oz" checked={size === n} onChange={() => setSize(n)} /> {n}×{n}</label>)}</div>}
        <button className="primary" disabled={!ready} onClick={() => { remember(); send({ t: 'create', game, name, side, time, size }); }}>방 만들기</button>
      </fieldset>
      <button onClick={exit}>뒤로</button>
    </section>
  );
}
