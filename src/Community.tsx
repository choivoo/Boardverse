import { useState } from 'react';
import { api, useAccount } from './api';
import { useOnline } from './online';
import { GAME_NAME, State, fmtDate, useLoad } from './ui';
import { TIME_CONTROLS } from './games/chess';

const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const STATUS_LABEL: Record<string, string> = { upcoming: '예정', running: '진행 중', ended: '종료' };

// ---------------- tournaments ----------------
export function TournamentsScreen({ open, login }: { open: (id: number) => void; login: () => void }) {
  const a = useAccount();
  const d = useLoad(() => api<{ tournaments: any[] }>('/api/tournaments'), [a.user?.id]);
  const [f, setF] = useState({ name: '', game: 'gomoku', time: '5+0', start: 10, minutes: 30 }); const [msg, setMsg] = useState<string | null>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { const starts = Date.now() + f.start * 60_000; await api('/api/admin/tournaments', 'POST', { name: f.name, game: f.game, time: f.time, starts, ends: starts + f.minutes * 60_000 }); setF({ ...f, name: '' }); d.reload(); } catch (x) { setMsg((x as Error).message); }
  };
  return (
    <section>
      <h1>대회</h1>
      <p className="note">아레나 방식: 대회 시간 동안 참가자끼리 자유롭게 경기를 찾습니다. 승 2점·무 1점·패 0점이며 레이팅에는 영향이 없습니다.</p>
      <State loading={d.loading} error={d.error} retry={d.reload}>
        {d.data?.tournaments.length ? <ul className="hist">{d.data.tournaments.map((t) => (
          <li key={t.id}><button className="link" onClick={() => open(t.id)}>{t.name}</button> · {GAME_NAME[t.game as 'chess']}{t.game === 'chess' ? ` ${t.time}` : ''} · <span className="badge">{STATUS_LABEL[t.status]}</span> · {when(t.starts)}~{when(t.ends)} · 참가 {t.players}명{t.joined ? ' · ✔ 참가함' : ''}</li>))}</ul>
          : <p className="empty">예정된 대회가 없습니다.</p>}
      </State>
      {a.user?.isAdmin && (
        <form onSubmit={create} className="card"><h2>대회 만들기 (관리자)</h2>
          <label className="field">이름<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={3} maxLength={40} required /></label>
          <div>{(['gomoku', 'chess'] as const).map((g) => <label key={g}><input type="radio" name="tg" checked={f.game === g} onChange={() => setF({ ...f, game: g })} /> {GAME_NAME[g]}</label>)}</div>
          {f.game === 'chess' && <div>{TIME_CONTROLS.filter((t) => t.baseSec).map((t) => <label key={t.id}><input type="radio" name="tt" checked={f.time === t.id} onChange={() => setF({ ...f, time: t.id })} /> {t.label}</label>)}</div>}
          <label className="field">몇 분 뒤 시작<input type="number" min={0} max={1440} value={f.start} onChange={(e) => setF({ ...f, start: Number(e.target.value) })} /></label>
          <label className="field">진행 시간(분, 5~360)<input type="number" min={5} max={360} value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} /></label>
          {msg && <p role="alert" className="err">{msg}</p>}<button className="primary">만들기</button></form>
      )}
      {!a.user && <button onClick={login}>로그인하고 참가하기</button>}
    </section>
  );
}

export function TournamentDetail({ id, back, play, login }: { id: number; back: () => void; play: (tid: number) => void; login: () => void }) {
  const a = useAccount(); const o = useOnline();
  const d = useLoad(() => api<any>(`/api/tournaments/${id}`), [id, a.user?.id]);
  const list = useLoad(() => api<{ tournaments: any[] }>('/api/tournaments'), [id, a.user?.id]);
  const [msg, setMsg] = useState<string | null>(null);
  const me = list.data?.tournaments.find((t) => t.id === id);
  const act = async (what: 'join' | 'leave') => { setMsg(null); try { await api(`/api/tournaments/${id}/${what}`, 'POST', {}); d.reload(); list.reload(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <section>
      <State loading={d.loading} error={d.error} retry={d.reload}>
        {d.data && <>
          <h1>{d.data.tournament.name}</h1>
          <p>{GAME_NAME[d.data.tournament.game as 'chess']}{d.data.tournament.game === 'chess' ? ` ${d.data.tournament.time}` : ` ${d.data.tournament.size}×${d.data.tournament.size}`} · <span className="badge">{STATUS_LABEL[d.data.tournament.status]}</span> · {when(d.data.tournament.starts)} ~ {when(d.data.tournament.ends)}</p>
          {msg && <p role="alert" className="err">{msg}</p>}
          <div className="row">
            {!a.user ? <button className="primary" onClick={login}>로그인</button>
              : me?.joined ? <>
                {d.data.tournament.status === 'running' && (o.queued ? <><span role="status">상대를 찾는 중…</span><button onClick={() => o.send({ t: 'unqueue' })}>취소</button></> : <button className="primary" disabled={o.conn !== 'open'} onClick={() => play(id)}>경기 찾기</button>)}
                {d.data.tournament.status === 'upcoming' && <button onClick={() => act('leave')}>참가 취소</button>}</>
              : d.data.tournament.status !== 'ended' && <button className="primary" onClick={() => act('join')}>참가</button>}
          </div>
          {o.error && <p role="alert" className="err">{o.error}</p>}
          <h2>순위 {d.data.tournament.finalized ? '(최종)' : '(실시간)'}</h2>
          {d.data.rows.length ? <table className="table"><thead><tr><th>순위</th><th>이름</th><th>점수</th><th>경기</th><th>승</th></tr></thead><tbody>
            {d.data.rows.map((r: any) => <tr key={r.name} className={r.name === a.user?.name ? 'me' : ''}><td>{r.rank}</td><td>{r.name}</td><td>{r.points}</td><td>{r.played}</td><td>{r.wins}</td></tr>)}</tbody></table> : <p className="empty">아직 참가자가 없습니다.</p>}
          <button onClick={d.reload}>새로고침</button> <button onClick={back}>목록</button>
        </>}
      </State>
    </section>
  );
}

// ---------------- clubs ----------------
export function ClubsScreen({ open, login }: { open: (id: number) => void; login: () => void }) {
  const a = useAccount(); const [q, setQ] = useState(''); const [f, setF] = useState({ name: '', about: '', public: true }); const [msg, setMsg] = useState<string | null>(null);
  const d = useLoad(() => api<{ clubs: any[] }>(`/api/clubs?q=${encodeURIComponent(q)}`), [q, a.user?.id]);
  const mine = useLoad(() => (a.user ? api<{ clubs: any[] }>('/api/clubs/mine') : Promise.resolve({ clubs: [] })), [a.user?.id]);
  const create = async (e: React.FormEvent) => { e.preventDefault(); setMsg(null); try { const r = await api<{ id: number }>('/api/clubs', 'POST', f); open(r.id); } catch (x) { setMsg((x as Error).message); } };
  return (
    <section>
      <h1>클럽</h1>
      {mine.data?.clubs.length ? <><h2>내 클럽</h2><ul>{mine.data.clubs.map((c) => <li key={c.id}><button className="link" onClick={() => open(c.id)}>{c.name}</button> {c.status !== 'active' && <span className="badge">{c.status === 'invited' ? '초대받음' : '승인 대기'}</span>}{c.role === 'owner' && <span className="badge">소유자</span>}</li>)}</ul></> : null}
      <label className="field">클럽 검색<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름" /></label>
      <State loading={d.loading} error={d.error} retry={d.reload}>
        {d.data?.clubs.length ? <ul>{d.data.clubs.map((c) => <li key={c.id}><button className="link" onClick={() => open(c.id)}>{c.name}</button> · {c.members}명 · {c.public ? '공개' : '초대/승인제'}<br /><span className="note">{c.about}</span></li>)}</ul> : <p className="empty">클럽이 없습니다. 첫 클럽을 만들어 보세요!</p>}
      </State>
      {a.user ? (
        <form onSubmit={create} className="card"><h2>클럽 만들기</h2>
          <label className="field">이름 (2~24자)<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={24} /></label>
          <label className="field">소개<input value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} maxLength={300} /></label>
          <label><input type="checkbox" checked={f.public} onChange={(e) => setF({ ...f, public: e.target.checked })} /> 누구나 바로 가입 (해제 시 승인제)</label>
          {msg && <p role="alert" className="err">{msg}</p>}<button className="primary">만들기</button></form>
      ) : <button onClick={login}>로그인하고 클럽 이용하기</button>}
      <p className="note">클럽전(클럽 대항 경기)은 아직 지원하지 않습니다.</p>
    </section>
  );
}

export function ClubDetail({ id, back, login }: { id: number; back: () => void; login: () => void }) {
  const a = useAccount(); const d = useLoad(() => api<any>(`/api/clubs/${id}`), [id, a.user?.id]); const [msg, setMsg] = useState<string | null>(null); const [who, setWho] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const act = async (what: string, body: object = {}, method = 'POST') => { setMsg(null); try { await api(`/api/clubs/${id}${what ? '/' + what : ''}`, method, body); if (what === '' ) back(); else d.reload(); } catch (e) { setMsg((e as Error).message); } };
  const c = d.data; const role = c?.mine?.status === 'active' ? c.mine.role : null; const isAdmin = role === 'owner' || role === 'admin';
  return (
    <section>
      <State loading={d.loading} error={d.error} retry={d.reload}>
        {c && <>
          <h1>{c.name}</h1><p>{c.about}</p><p className="note">{c.count}명 · {c.public ? '공개 클럽' : '승인제 클럽'}{role ? ` · 내 역할: ${role === 'owner' ? '소유자' : role === 'admin' ? '관리자' : '멤버'}` : ''}</p>
          {msg && <p role="alert" className="err">{msg}</p>}
          {c.notice && <div className="banner"><strong>공지</strong><p>{c.notice}</p></div>}
          <div className="row">
            {!a.user ? <button onClick={login}>로그인</button> : !c.mine ? <button className="primary" onClick={() => act('join')}>{c.public ? '가입' : '가입 요청'}</button>
              : c.mine.status === 'pending' ? <button onClick={() => act('leave')}>요청 취소</button>
              : c.mine.status === 'invited' ? <><button className="primary" onClick={() => act('answer', { accept: true })}>초대 수락</button><button onClick={() => act('answer', { accept: false })}>거절</button></>
              : role !== 'owner' ? <button onClick={() => act('leave')}>탈퇴</button> : <button onClick={() => confirm('클럽을 삭제할까요? 되돌릴 수 없습니다.') && act('', {}, 'DELETE')}>클럽 삭제</button>}
            {a.user && c.mine?.status !== 'pending' && role !== 'owner' && <button onClick={() => { const r = prompt('신고 사유'); if (r) act('report', { reason: r }); }}>클럽 신고</button>}
          </div>
          {c.members && <><h2>멤버</h2><ul>{c.members.map((m: any) => <li key={m.name}>{m.name} <span className="badge">{m.role === 'owner' ? '소유자' : m.role === 'admin' ? '관리자' : '멤버'}</span>
            {isAdmin && m.role !== 'owner' && (role === 'owner' || m.role === 'member') && <> <button onClick={() => act('kick', { name: m.name })}>내보내기</button></>}
            {role === 'owner' && m.role !== 'owner' && <> <button onClick={() => act('role', { name: m.name, role: m.role === 'admin' ? 'member' : 'admin' })}>{m.role === 'admin' ? '관리자 해제' : '관리자 지정'}</button></>}</li>)}</ul></>}
          {isAdmin && <>
            {c.pending?.length > 0 && <><h2>대기 중</h2><ul>{c.pending.map((p: any) => <li key={p.name}>{p.name} <span className="badge">{p.status === 'pending' ? '가입 요청' : '초대함'}</span> {p.status === 'pending' && <><button className="primary" onClick={() => act('accept', { name: p.name })}>수락</button> <button onClick={() => act('reject', { name: p.name })}>거절</button></>}</li>)}</ul></>}
            <form className="row" onSubmit={(e) => { e.preventDefault(); act('invite', { name: who }); setWho(''); }}><label className="field" style={{ flex: 1 }}>닉네임으로 초대<input value={who} onChange={(e) => setWho(e.target.value)} /></label><button disabled={!who}>초대</button></form>
            <label className="field">공지<textarea value={notice ?? c.notice ?? ''} onChange={(e) => setNotice(e.target.value)} maxLength={500} /></label><button onClick={() => act('update', { notice: notice ?? '' })}>공지 저장</button>
          </>}
          <button onClick={back}>목록</button>
        </>}
      </State>
    </section>
  );
}

// ---------------- live games (spectate) ----------------
export function LiveScreen({ watch }: { watch: (code: string) => void }) {
  const d = useLoad(() => api<{ games: any[] }>('/api/live'), []);
  return (
    <section>
      <h1>관전</h1>
      <p className="note">관전은 읽기 전용입니다. 친구 방과 평가 대국은 공개되지 않으며, 빠른 매칭 대국만 (플레이어가 끄지 않았다면) 목록에 나타납니다.</p>
      <State loading={d.loading} error={d.error} retry={d.reload}>
        {d.data?.games.length ? <ul>{d.data.games.map((g) => <li key={g.code}>{GAME_NAME[g.game as 'chess']} · {g.players.join(' vs ')} · {g.n}수 · 관전 {g.spectators}명 <button onClick={() => watch(g.code)}>관전</button></li>)}</ul> : <p className="empty">지금 관전할 수 있는 대국이 없습니다.</p>}
      </State>
      <button onClick={d.reload}>새로고침</button>
    </section>
  );
}

// ---------------- admin ----------------
const R_STATUS: Record<string, string> = { open: '접수', reviewing: '검토 중', actioned: '조치 완료', dismissed: '기각' };
export function AdminScreen() {
  const a = useAccount(); const [filter, setFilter] = useState(''); const [tab, setTab] = useState<'reports' | 'audit'>('reports');
  const reports = useLoad(() => (a.user?.isAdmin ? api<{ reports: any[] }>(`/api/admin/reports${filter ? `?status=${filter}` : ''}`) : Promise.resolve(null)), [filter, a.user?.id]);
  const audit = useLoad(() => (a.user?.isAdmin && tab === 'audit' ? api<{ log: any[] }>('/api/admin/audit') : Promise.resolve(null)), [tab, a.user?.id]);
  const [msg, setMsg] = useState<string | null>(null);
  if (!a.user?.isAdmin) return <section><h1>관리자</h1><p className="banner err" role="alert">관리자 권한이 없습니다. (권한은 서버가 검증합니다.)</p></section>;
  const set = async (id: number, status: string) => { const note = status === 'open' ? '' : prompt('처리 메모 (선택)') ?? ''; try { await api(`/api/admin/reports/${id}`, 'POST', { status, note }); reports.reload(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <section>
      <h1>관리자</h1>
      <div className="tabsrow" role="group" aria-label="관리 메뉴"><button aria-pressed={tab === 'reports'} onClick={() => setTab('reports')}>신고</button><button aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>감사 로그</button></div>
      {msg && <p role="alert" className="err">{msg}</p>}
      {tab === 'reports' ? <>
        <div className="tabsrow" role="group" aria-label="상태 필터">{['', 'open', 'reviewing', 'actioned', 'dismissed'].map((s) => <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)}>{s ? R_STATUS[s] : '전체'}</button>)}</div>
        <p className="note">신고 열람은 감사 로그에 기록됩니다. <button className="link" onClick={reports.reload}>새로고침</button></p>
        <State loading={reports.loading} error={reports.error} retry={reports.reload}>
          {reports.data?.reports.length ? reports.data.reports.map((r) => (
            <article key={r.id} className="card"><p><strong>#{r.id}</strong> <span className="badge">{r.kind === 'club' ? '클럽' : '사용자'}</span> <span className="badge">{R_STATUS[r.status]}</span> · {fmtDate(r.created)}</p>
              <p>신고자 {r.reporter ?? '(탈퇴)'} → 대상 {r.target ?? '(탈퇴)'}</p><p>{r.reason}</p>
              {r.context && <details><summary>채팅 증거</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{r.context}</pre></details>}
              {r.note && <p className="note">메모: {r.note} ({r.handled_by})</p>}
              <div className="row">{['reviewing', 'actioned', 'dismissed'].filter((s) => s !== r.status).map((s) => <button key={s} onClick={() => set(r.id, s)}>{R_STATUS[s]}</button>)}</div></article>))
            : <p className="empty">해당하는 신고가 없습니다.</p>}
        </State></> : (
        <State loading={audit.loading} error={audit.error} retry={audit.reload}>
          <table className="table"><thead><tr><th>시각</th><th>관리자</th><th>작업</th><th>대상</th></tr></thead><tbody>{audit.data?.log.map((l) => <tr key={l.id}><td>{new Date(l.at).toLocaleString('ko-KR')}</td><td>{l.admin ?? '(운영자 도구)'}</td><td>{l.action}</td><td>{l.target} {l.detail}</td></tr>)}</tbody></table>
        </State>)}
    </section>
  );
}
