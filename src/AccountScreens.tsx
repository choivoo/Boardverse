import { useEffect, useState } from 'react';
import { api, useAccount } from './api';
import { Avatar, GAME_NAME, State, fmtDate, useLoad } from './ui';
import { ITEMS, ITEM_BY_ID, SLOT_LABEL, type Slot } from './catalog';
import { SEASONS, CLAIM_GRACE_MS } from './seasons';
import type { GameKind } from './protocol';
import { CAT_LABEL, CATS } from './ratingConfig';

export function AuthScreen({ done, forgot }: { done: () => void; forgot: () => void }) {
  const { login, register, status } = useAccount();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ email: '', name: '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { mode === 'login' ? await login(f.email, f.password) : await register(f.email, f.name, f.password); done(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="setup">
      <h1>{mode === 'login' ? '로그인' : '계정 만들기'}</h1>
      <p className="note">계정이 있으면 평가 대국·레이팅·상점·친구를 쓸 수 있습니다. 계정 없이도 게스트로 모든 로컬/비평가 대국을 즐길 수 있어요.</p>
      {status === 'offline' && <p className="banner err" role="alert">서버에 연결할 수 없습니다. 지금은 게스트 로컬 플레이만 가능합니다.</p>}
      <form onSubmit={submit}>
        <label className="field">이메일<input type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        {mode === 'register' && <label className="field">닉네임 (2~16자, 한글·영문·숫자·_)<input required minLength={2} maxLength={16} autoComplete="nickname" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>}
        <label className="field">비밀번호 (8자 이상)<input type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        {err && <p className="banner err" role="alert">{err}</p>}
        <div className="row"><button className="primary" disabled={busy}>{mode === 'login' ? '로그인' : '가입하기'}</button>
          <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null); }}>{mode === 'login' ? '계정 만들기' : '로그인으로'}</button>{mode === 'login' && <button type="button" className="link" onClick={forgot}>비밀번호를 잊었나요?</button>}</div>
      </form>
    </section>
  );
}

export function ProfileScreen({ go, replay }: { go: (s: 'auth' | 'shop' | 'season' | 'friends' | 'tournaments' | 'clubs' | 'admin' | 'password') => void; replay: (id: string) => void }) {
  const a = useAccount();
  const games = useLoad(() => (a.user ? api<{ games: any[] }>('/api/games') : Promise.resolve({ games: [] })), [a.user?.id]);
  const [msg, setMsg] = useState<string | null>(null);
  if (a.status === 'loading') return <p role="status">불러오는 중…</p>;
  if (!a.user) return (
    <section><h1>내 정보</h1>
      <p className="empty">게스트로 플레이 중입니다. 로그인하면 레이팅·전적·상점·친구가 저장됩니다.</p>
      <button className="primary" onClick={() => go('auth')}>로그인 / 가입</button></section>
  );
  const frame = a.look.frame;
  const del = async () => {
    const pw = prompt('계정을 삭제하려면 비밀번호를 입력하세요. 되돌릴 수 없습니다.'); if (!pw) return;
    try { await api('/api/me', 'DELETE', { password: pw }); await a.refresh(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section>
      <div className="hero"><Avatar name={a.user.name} frame={frame} /><div><h1 style={{ margin: 0 }}>{a.user.name}</h1><p className="coins">🪙 {a.user.coins} 코인 <span className="note">(서버 저장)</span></p></div></div>
      <div className="row"><button onClick={() => go('shop')}>상점·보관함</button><button onClick={() => go('season')}>시즌</button><button onClick={() => go('friends')}>친구</button><button onClick={() => go('tournaments')}>대회</button><button onClick={() => go('clubs')}>클럽</button>{a.user.isAdmin && <button onClick={() => go('admin')}>관리자</button>}</div>
      {!a.user.emailVerified && a.config?.email && <EmailBanner />}
      <h2>레이팅</h2>
      <p className="note">게임 종류와 시간 분류(체스: 1~3분 미만 불릿 / 8분 미만 블리츠 / 그 이상 래피드, 시계 없음은 무제한)별로 따로 계산됩니다. 평가 대국만 반영됩니다.</p>
      <ul>{(['chess', 'gomoku'] as const).flatMap((g) => CATS[g].map((c) => { const r = a.ratings.find((x) => x.game === g && x.cat === c); if (!r && c === 'legacy') return null;
        return <li key={g + c}>{GAME_NAME[g]} · {CAT_LABEL[c]}: <strong>{r ? r.rating : 1200}</strong>{r ? ` (평가 ${r.games}판)` : ' (아직 평가 대국 없음)'}{c === 'legacy' ? ' · 이전 버전 점수, 더 이상 변하지 않음' : ''}</li>; }))}</ul>
      {Object.entries(a.stats).map(([g, st]) => <p key={g} className="note">{GAME_NAME[g as GameKind]} 전적: {st.w}승 {st.d}무 {st.l}패</p>)}
      <h2>최근 서버 전적</h2>
      <State loading={games.loading} error={games.error} retry={games.reload}>
        {games.data?.games.length ? <ul className="hist">{games.data.games.map((g) => (
          <li key={g.id}>{GAME_NAME[g.game as GameKind]} · {g.white_name} vs {g.black_name} · {g.result === 'draw' ? '무승부' : g.result === 'w' ? '백/선공 승' : '흑/후공 승'} ({g.reason}){g.rated ? ` · 평가 ${g.result === 'draw' ? '' : ''}${g.delta_w ?? 0}/${g.delta_b ?? 0}` : ' · 친선'} · {fmtDate(g.created)} <button className="link" onClick={() => replay(g.id)}>복기</button></li>))}</ul>
          : <p className="empty">서버에 저장된 대국이 없습니다. 로그인 상태로 온라인 대국을 하면 여기에 기록됩니다.</p>}
      </State>
      <h2>개인정보</h2>
      <label><input type="checkbox" checked={a.user.public} onChange={async (e) => { await api('/api/me', 'PATCH', { public: e.target.checked }); await a.refresh(); }} /> 내 최근 대국을 다른 사람에게 공개</label>
      <div className="row"><a href="/api/me/export" download><button type="button">내 데이터 내보내기</button></a><button onClick={() => go('password')}>비밀번호 변경</button><button onClick={async () => { await a.logout(); }}>로그아웃</button><button onClick={del}>계정 삭제</button></div>
      {msg && <p className="banner err" role="alert">{msg}</p>}
    </section>
  );
}

export function ShopScreen({ login }: { login: () => void }) {
  const a = useAccount();
  const [msg, setMsg] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot>('boardTheme');
  if (!a.user) return <section><h1>상점</h1><p className="empty">상점과 보관함은 로그인 후 이용할 수 있습니다. 코인은 온라인 대국을 하면 서버에서 지급됩니다.</p><button className="primary" onClick={login}>로그인</button></section>;
  const act = async (path: string, item: string) => { setMsg(null); try { await api(path, 'POST', { item }); await a.refresh(); a.setPreview({}); } catch (e) { setMsg((e as Error).message); } };
  return (
    <section>
      <h1>상점·보관함</h1>
      <p className="coins">🪙 {a.user.coins} 코인</p>
      <p className="note">코스메틱은 외형만 바꿉니다. 승률·레이팅과 무관하며 현금 결제는 없습니다. 코인은 사람과 대국(6수 이상)하면 하루 최대 100개까지 지급됩니다.</p>
      <div className="tabsrow" role="group" aria-label="분류">{(Object.keys(SLOT_LABEL) as Slot[]).map((s) => <button key={s} aria-pressed={slot === s} onClick={() => setSlot(s)}>{SLOT_LABEL[s]}</button>)}</div>
      {msg && <p className="banner err" role="alert">{msg}</p>}
      <div className="grid2">{ITEMS.filter((i) => i.slot === slot).map((i) => {
        const owned = a.inventory.includes(i.id), eq = a.equipped[i.slot] === i.id;
        return (
          <div key={i.id} className={`item ${i.rarity} ${eq ? 'equipped' : ''}`}>
            <strong>{i.name}</strong><span className="note">{i.desc}</span>
            <span className="badge">{i.rarity === 'common' ? '일반' : i.rarity === 'rare' ? '희귀' : '영웅'}{i.season ? ' · 시즌 보상' : ''}</span>
            <button onMouseEnter={() => a.setPreview({ [i.slot]: i.id })} onFocus={() => a.setPreview({ [i.slot]: i.id })} onBlur={() => a.setPreview({})} onMouseLeave={() => a.setPreview({})} onClick={() => a.setPreview({ [i.slot]: i.id })}>미리보기</button>
            {eq ? <span className="ok">✔ 장착 중</span> : owned ? <button onClick={() => act('/api/shop/equip', i.id)}>장착</button>
              : i.price === null ? <span className="note">보상으로만 획득</span> : <button className="primary" disabled={a.user!.coins < i.price} onClick={() => act('/api/shop/buy', i.id)}>🪙 {i.price} 구매</button>}
          </div>);
      })}</div>
    </section>
  );
}

export function SeasonScreen({ login }: { login: () => void }) {
  const a = useAccount();
  const d = useLoad(() => api<any>('/api/season'), [a.user?.id]);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section>
      <h1>시즌</h1>
      <State loading={d.loading} error={d.error} retry={d.reload}>
        {d.data && SEASONS.map((s) => {
          const start = Date.parse(s.start), end = Date.parse(s.end), now: number = d.data.now;
          const state = now < start ? '시작 전' : now <= end ? '진행 중' : now <= end + CLAIM_GRACE_MS ? '종료 (수령 기간)' : '종료';
          const p = d.data.progress?.[s.id];
          return (
            <article className="card" key={s.id}>
              <h2>{s.name} <span className="badge">{state}</span></h2>
              <p className="note">{new Date(start).toLocaleDateString('ko-KR')} ~ {new Date(end).toLocaleDateString('ko-KR')} (UTC 기준 판정) · 평가 대국만 집계됩니다.</p>
              {!a.user ? <><p className="empty">로그인하면 내 진행 상황과 보상을 볼 수 있습니다.</p><button onClick={login}>로그인</button></> : (
                <ul>{s.rewards.map((r) => {
                  const need = r.need ?? {}; const cur = need.rated ? p?.rated ?? 0 : need.wins ? p?.wins ?? 0 : p?.topRank ?? null;
                  const goal = need.rated ?? need.wins ?? need.topRank ?? 0;
                  const ok = need.topRank ? p?.topRank !== null && p?.topRank <= goal : cur >= goal; const claimed = p?.claimed.includes(r.id);
                  const what = r.give.coins ? `🪙 ${r.give.coins}` : ITEM_BY_ID.get(r.give.item!)?.name;
                  return (<li key={r.id}>{r.label} → {what} {claimed ? <span className="ok">✔ 수령</span> : ok ? <button className="primary" onClick={async () => { setMsg(null); try { await api('/api/season/claim', 'POST', { season: s.id, reward: r.id }); await a.refresh(); d.reload(); } catch (e) { setMsg((e as Error).message); } }}>받기</button> : need.topRank ? <span className="note">종료 후 확정</span> : <span className="note">{cur}/{goal}</span>}
                    {!need.topRank && <div className="progress" aria-hidden="true"><i style={{ width: `${Math.min(100, (100 * cur) / goal)}%` }} /></div>}</li>);
                })}</ul>)}
              {msg && <p className="banner err" role="alert">{msg}</p>}
            </article>);
        })}
      </State>
    </section>
  );
}

export function LeaderboardScreen({ profile }: { profile: (n: string) => void }) {
  const [game, setGame] = useState<GameKind>('chess');
  const [cat, setCat] = useState('blitz');
  const [page, setPage] = useState(0);
  const per = 20;
  const d = useLoad(() => api<any>(`/api/leaderboard?game=${game}&cat=${cat}&offset=${page * per}&limit=${per}`), [game, cat, page]);
  return (
    <section>
      <h1>랭킹</h1>
      <div className="tabsrow" role="group" aria-label="게임">{(['chess', 'gomoku'] as const).map((g) => <button key={g} aria-pressed={game === g} onClick={() => { setGame(g); setCat(g === 'chess' ? 'blitz' : 'std'); setPage(0); }}>{GAME_NAME[g]}</button>)}</div>
      <div className="tabsrow" role="group" aria-label="시간 분류">{CATS[game].map((c) => <button key={c} aria-pressed={cat === c} onClick={() => { setCat(c); setPage(0); }}>{CAT_LABEL[c]}</button>)}</div>
      <p className="note">평가 대국(로그인한 두 사람의 대국)만 반영되며 게임·시간 분류별로 따로 집계됩니다.</p>
      <State loading={d.loading} error={d.error} retry={d.reload}>
        {d.data?.mine && <p>내 순위: <strong>{d.data.mine.rank}위</strong> · {d.data.mine.rating} ({d.data.mine.games}판)</p>}
        {d.data?.rows.length ? (
          <table className="table"><caption className="sr">{GAME_NAME[game]} {CAT_LABEL[cat]} 랭킹</caption><thead><tr><th>순위</th><th>이름</th><th>레이팅</th><th>판</th></tr></thead>
            <tbody>{d.data.rows.map((r: any) => <tr key={r.rank} className={r.me ? 'me' : ''}><td>{r.rank}</td><td><button className="link" onClick={() => profile(r.name)}>{r.name}</button></td><td>{r.rating}</td><td>{r.games}</td></tr>)}</tbody></table>
        ) : <p className="empty">아직 랭킹에 오른 플레이어가 없습니다. 로그인한 친구와 평가 대국을 해 보세요!</p>}
        <div className="row"><button disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button><button disabled={!d.data || (page + 1) * per >= d.data.total} onClick={() => setPage(page + 1)}>다음</button></div>
      </State>
    </section>
  );
}

export function FriendsScreen({ login, profile }: { login: () => void; profile: (n: string) => void }) {
  const a = useAccount();
  const d = useLoad(() => (a.user ? api<any>('/api/friends') : Promise.resolve(null)), [a.user?.id]);
  const [name, setName] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  if (!a.user) return <section><h1>친구</h1><p className="empty">친구 기능은 로그인 후 이용할 수 있습니다.</p><button className="primary" onClick={login}>로그인</button></section>;
  const act = async (path: string, n: string, extra: object = {}) => { setMsg(null); try { await api(path, 'POST', { name: n, ...extra }); d.reload(); setName(''); } catch (e) { setMsg((e as Error).message); } };
  const report = (n: string) => { const reason = prompt(`${n} 님을 신고하는 이유를 적어주세요.`); if (reason) act('/api/report', n, { reason }); };
  return (
    <section>
      <h1>친구</h1>
      <form className="row" onSubmit={(e) => { e.preventDefault(); act('/api/friends/request', name); }}>
        <label className="field" style={{ flex: 1 }}>닉네임으로 친구 요청<input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} /></label>
        <button className="primary" disabled={!name}>요청</button>
      </form>
      {msg && <p className="banner err" role="alert">{msg}</p>}
      <State loading={d.loading} error={d.error} retry={d.reload}>
        {d.data && <>
          {d.data.incoming.length > 0 && <><h2>받은 요청</h2><ul>{d.data.incoming.map((n: string) => <li key={n}>{n} <button className="primary" onClick={() => act('/api/friends/accept', n)}>수락</button> <button onClick={() => act('/api/block', n)}>차단</button></li>)}</ul></>}
          <h2>친구 {d.data.friends.length}</h2>
          {d.data.friends.length ? <ul>{d.data.friends.map((f: any) => <li key={f.name}><button className="link" onClick={() => profile(f.name)}>{f.name}</button> <span className={f.online ? 'ok' : 'note'}>{f.online ? '● 온라인' : '○ 오프라인'}</span> <button onClick={() => act('/api/friends/remove', f.name)}>삭제</button> <button onClick={() => act('/api/block', f.name)}>차단</button> <button onClick={() => report(f.name)}>신고</button></li>)}</ul> : <p className="empty">아직 친구가 없습니다. 방을 만든 뒤 친구에게 초대를 보낼 수 있어요.</p>}
          {d.data.outgoing.length > 0 && <p className="note">보낸 요청: {d.data.outgoing.join(', ')}</p>}
          {d.data.blocked.length > 0 && <><h2>차단 목록</h2><ul>{d.data.blocked.map((n: string) => <li key={n}>{n} <button onClick={() => act('/api/unblock', n)}>해제</button></li>)}</ul></>}
        </>}
      </State>
    </section>
  );
}

export function PublicProfile({ name, back }: { name: string; back: () => void }) {
  const a = useAccount();
  const d = useLoad(() => api<any>(`/api/user/${encodeURIComponent(name)}`), [name]);
  const act = async (path: string, extra: object = {}) => { try { await api(path, 'POST', { name, ...extra }); alert('완료되었습니다.'); } catch (e) { alert((e as Error).message); } };
  return (
    <section>
      <h1>{name}</h1>
      <State loading={d.loading} error={d.error} retry={d.reload}>
        {d.data && <>
          <p>{d.data.online ? <span className="ok">● 온라인</span> : <span className="note">○ 오프라인</span>}</p>
          <ul>{d.data.ratings.length ? d.data.ratings.map((r: any) => <li key={r.game + r.cat}>{GAME_NAME[r.game as GameKind]} · {CAT_LABEL[r.cat]}: {r.rating} ({r.games}판)</li>) : <li className="note">평가 대국 없음</li>}</ul>
          {d.data.games ? <ul className="hist">{d.data.games.map((g: any) => <li key={g.id}>{GAME_NAME[g.game as GameKind]} · {g.white_name} vs {g.black_name} · {g.result === 'draw' ? '무승부' : g.result === 'w' ? '백/선공 승' : '흑/후공 승'}</li>)}</ul> : <p className="note">대국 기록을 비공개로 설정했습니다.</p>}
          {a.user && a.user.name.toLowerCase() !== name.toLowerCase() && <div className="row"><button onClick={() => act('/api/friends/request')}>친구 요청</button><button onClick={() => act('/api/block')}>차단</button><button onClick={() => { const r = prompt('신고 사유'); if (r) act('/api/report', { reason: r }); }}>신고</button></div>}
        </>}
      </State>
      <button onClick={back}>뒤로</button>
    </section>
  );
}

export function EmailBanner() {
  const a = useAccount(); const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="banner" role="status">
      <p>이메일이 아직 인증되지 않았습니다.{a.config?.emailRequiredForRated ? ' 평가 대국·대회 참가에는 인증이 필요합니다.' : ''}</p>
      {a.config?.emailDev && <p className="note">개발 모드: 메일은 실제로 발송되지 않고 서버 메모리의 outbox에만 쌓입니다.</p>}
      <button onClick={async () => { try { await api('/api/email/send-verification', 'POST', {}); setMsg('인증 메일을 보냈습니다.'); } catch (e) { setMsg((e as Error).message); } }}>인증 메일 보내기</button>
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}

export function EmailLinkScreen({ kind, token, done }: { kind: 'verify' | 'reset'; token: string; done: () => void }) {
  const a = useAccount();
  const [pw, setPw] = useState(''); const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null); const [busy, setBusy] = useState(kind === 'verify');
  useEffect(() => { if (kind !== 'verify') return; api('/api/email/verify', 'POST', { token }).then(() => { setMsg({ t: '이메일이 인증되었습니다.', ok: true }); a.refresh(); }).catch((e: Error) => setMsg({ t: e.message })).finally(() => setBusy(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (kind === 'verify') return <section><h1>이메일 인증</h1>{busy ? <p role="status">확인 중…</p> : <p role="status" className={msg?.ok ? 'ok' : 'err'}>{msg?.t}</p>}<button className="primary" onClick={done}>계속</button></section>;
  return (
    <section className="setup"><h1>비밀번호 재설정</h1>
      <form onSubmit={async (e) => { e.preventDefault(); try { await api('/api/password/reset', 'POST', { token, password: pw }); setMsg({ t: '변경되었습니다. 다시 로그인하세요.', ok: true }); } catch (x) { setMsg({ t: (x as Error).message }); } }}>
        <label className="field">새 비밀번호 (8자 이상)<input type="password" minLength={8} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {msg && <p role="status" className={msg.ok ? 'ok' : 'err'}>{msg.t}</p>}
        <div className="row"><button className="primary">변경</button><button type="button" onClick={done}>로그인으로</button></div>
      </form></section>
  );
}

export function ForgotScreen({ back }: { back: () => void }) {
  const a = useAccount(); const [email, setEmail] = useState(''); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  if (a.config && !a.config.email) return <section><h1>비밀번호 찾기</h1><p className="banner">이 서버에는 이메일 발송(SMTP)이 설정되어 있지 않아 비밀번호 재설정을 사용할 수 없습니다. 운영자에게 문의하세요.</p><button onClick={back}>뒤로</button></section>;
  return (
    <section className="setup"><h1>비밀번호 찾기</h1>
      {a.config?.emailDev && <p className="banner">개발 모드: 메일은 발송되지 않고 서버 outbox에만 기록됩니다.</p>}
      <form onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api('/api/password/forgot', 'POST', { email }); setMsg('해당 주소로 가입한 계정이 있다면 재설정 링크를 보냈습니다.'); } catch (x) { setErr((x as Error).message); } }}>
        <label className="field">가입 이메일<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {msg && <p role="status" className="ok">{msg}</p>}{err && <p role="alert" className="err">{err}</p>}
        <div className="row"><button className="primary">재설정 링크 받기</button><button type="button" onClick={back}>뒤로</button></div></form></section>
  );
}

export function PasswordScreen({ back }: { back: () => void }) {
  const [f, setF] = useState({ old: '', password: '' }); const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null);
  return (
    <section className="setup"><h1>비밀번호 변경</h1>
      <p className="note">변경하면 다른 기기의 로그인은 모두 해제됩니다.</p>
      <form onSubmit={async (e) => { e.preventDefault(); try { await api('/api/password/change', 'POST', f); setMsg({ t: '변경되었습니다.', ok: true }); setF({ old: '', password: '' }); } catch (x) { setMsg({ t: (x as Error).message }); } }}>
        <label className="field">현재 비밀번호<input type="password" required autoComplete="current-password" value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} /></label>
        <label className="field">새 비밀번호 (8자 이상)<input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        {msg && <p role="status" className={msg.ok ? 'ok' : 'err'}>{msg.t}</p>}
        <div className="row"><button className="primary">변경</button><button type="button" onClick={back}>뒤로</button></div></form></section>
  );
}
