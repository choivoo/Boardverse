import { ApiError, type Store } from './store';

export type Role = 'owner' | 'admin' | 'member';
const RANK: Record<string, number> = { owner: 3, admin: 2, member: 1 };
const NAME_RE = /^[A-Za-z0-9가-힣_ ]{2,24}$/;
const MAX_MEMBERS = 100, MAX_CLUBS_PER_USER = 10;

const club = (s: Store, id: number) => { const c = s.get('SELECT * FROM clubs WHERE id=?', id); if (!c) throw new ApiError(404, '클럽을 찾을 수 없습니다.'); return c as any; };
const member = (s: Store, id: number, uid: number) => s.get('SELECT role,status FROM club_members WHERE club_id=? AND user_id=?', id, uid) as { role: Role; status: string } | undefined;
const active = (s: Store, id: number, uid: number) => { const m = member(s, id, uid); return m?.status === 'active' ? m.role : null; };
const target = (s: Store, name: string) => { const u = s.userByName(name); if (!u) throw new ApiError(404, '사용자를 찾을 수 없습니다.'); return u as { id: number; name: string }; };
const need = (s: Store, id: number, uid: number, min: Role) => { const r = active(s, id, uid); if (!r || RANK[r] < RANK[min]) throw new ApiError(403, '권한이 없습니다.'); return r; };
const myClubs = (s: Store, uid: number) => (s.get('SELECT COUNT(*) c FROM club_members WHERE user_id=? AND status=\'active\'', uid)!.c as number);
const ownerBlocks = (s: Store, id: number, uid: number) => s.all('SELECT user_id FROM club_members WHERE club_id=? AND status=\'active\' AND role IN (\'owner\',\'admin\')', id).some((m) => s.isBlocked(uid, m.user_id as number));

export function createClub(s: Store, uid: number, name: string, about: string, isPublic: boolean) {
  name = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) throw new ApiError(400, '클럽 이름은 2~24자의 한글·영문·숫자·밑줄·공백만 쓸 수 있습니다.');
  if (myClubs(s, uid) >= MAX_CLUBS_PER_USER) throw new ApiError(400, `클럽은 최대 ${MAX_CLUBS_PER_USER}개까지 가입할 수 있습니다.`);
  if (s.get('SELECT 1 FROM clubs WHERE name_lc=?', name.toLowerCase())) throw new ApiError(409, '이미 있는 클럽 이름입니다.');
  return s.tx(() => {
    const id = Number(s.run('INSERT INTO clubs(name,name_lc,about,is_public,created) VALUES(?,?,?,?,?)', name, name.toLowerCase(), String(about ?? '').slice(0, 300), isPublic ? 1 : 0, s.now()).lastInsertRowid);
    s.run('INSERT INTO club_members VALUES(?,?,\'owner\',\'active\')', id, uid);
    return id;
  });
}
export function searchClubs(s: Store, q: string, uid?: number) {
  const like = `%${String(q ?? '').toLowerCase().replace(/[%_]/g, '')}%`;
  return s.all('SELECT c.id,c.name,c.about,c.is_public,(SELECT COUNT(*) FROM club_members m WHERE m.club_id=c.id AND m.status=\'active\') members FROM clubs c WHERE c.name_lc LIKE ? ORDER BY members DESC, c.id LIMIT 30', like)
    .map((c) => { const m = uid ? member(s, c.id, uid) : undefined; return { id: c.id, name: c.name, about: c.about, public: !!c.is_public, members: c.members, mine: m ? { role: m.role, status: m.status } : null }; });
}
export function myClubList(s: Store, uid: number) {
  return s.all('SELECT c.id,c.name,c.is_public,m.role,m.status FROM club_members m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=? ORDER BY c.name', uid).map((c) => ({ id: c.id, name: c.name, public: !!c.is_public, role: c.role, status: c.status }));
}
export function getClub(s: Store, id: number, uid?: number) {
  const c = club(s, id); const m = uid ? member(s, id, uid) : undefined; const isMember = m?.status === 'active';
  const out: any = { id: c.id, name: c.name, about: c.about, public: !!c.is_public, mine: m ? { role: m.role, status: m.status } : null,
    count: s.get('SELECT COUNT(*) c FROM club_members WHERE club_id=? AND status=\'active\'', id)!.c };
  if (isMember || c.is_public) out.members = s.all('SELECT u.name,m.role FROM club_members m JOIN users u ON u.id=m.user_id WHERE m.club_id=? AND m.status=\'active\' ORDER BY m.role DESC, u.name', id);
  if (isMember) out.notice = c.notice;
  if (m && RANK[m.role] >= 2 && isMember) out.pending = s.all('SELECT u.name,m.status FROM club_members m JOIN users u ON u.id=m.user_id WHERE m.club_id=? AND m.status IN (\'pending\',\'invited\')', id);
  return out;
}
export function joinClub(s: Store, uid: number, id: number) {
  const c = club(s, id);
  if (member(s, id, uid)) throw new ApiError(409, '이미 가입했거나 요청 중입니다.');
  if (ownerBlocks(s, id, uid)) throw new ApiError(403, '이 클럽에는 가입할 수 없습니다.');
  if (myClubs(s, uid) >= MAX_CLUBS_PER_USER) throw new ApiError(400, '가입 가능한 클럽 수를 넘었습니다.');
  const n = s.get('SELECT COUNT(*) c FROM club_members WHERE club_id=? AND status=\'active\'', id)!.c as number;
  if (c.is_public && n >= MAX_MEMBERS) throw new ApiError(400, '클럽이 가득 찼습니다.');
  s.run('INSERT INTO club_members VALUES(?,?,\'member\',?)', id, uid, c.is_public ? 'active' : 'pending');
  return c.is_public ? 'active' : 'pending';
}
export function leaveClub(s: Store, uid: number, id: number) {
  const m = member(s, id, uid); if (!m) return;
  if (m.role === 'owner' && m.status === 'active') throw new ApiError(400, '소유자는 나갈 수 없습니다. 클럽을 삭제하거나 소유권을 넘기세요.');
  s.run('DELETE FROM club_members WHERE club_id=? AND user_id=?', id, uid);
}
export function decideRequest(s: Store, actor: number, id: number, name: string, accept: boolean) {
  need(s, id, actor, 'admin'); const t = target(s, name);
  const m = member(s, id, t.id); if (!m || m.status !== 'pending') throw new ApiError(404, '가입 요청이 없습니다.');
  if (accept) {
    if (s.isBlocked(actor, t.id)) throw new ApiError(403, '수락할 수 없습니다.');
    s.run('UPDATE club_members SET status=\'active\' WHERE club_id=? AND user_id=?', id, t.id);
  } else s.run('DELETE FROM club_members WHERE club_id=? AND user_id=?', id, t.id);
}
export function inviteToClub(s: Store, actor: number, id: number, name: string) {
  need(s, id, actor, 'admin'); const t = target(s, name);
  if (s.isBlocked(actor, t.id)) throw new ApiError(403, '초대할 수 없습니다.');
  if (member(s, id, t.id)) throw new ApiError(409, '이미 멤버이거나 요청 중입니다.');
  s.run('INSERT INTO club_members VALUES(?,?,\'member\',\'invited\')', id, t.id);
}
export function answerInvite(s: Store, uid: number, id: number, accept: boolean) {
  const m = member(s, id, uid); if (!m || m.status !== 'invited') throw new ApiError(404, '초대가 없습니다.');
  if (!accept) return s.run('DELETE FROM club_members WHERE club_id=? AND user_id=?', id, uid);
  if (myClubs(s, uid) >= MAX_CLUBS_PER_USER) throw new ApiError(400, '가입 가능한 클럽 수를 넘었습니다.');
  s.run('UPDATE club_members SET status=\'active\' WHERE club_id=? AND user_id=?', id, uid);
}
export function kickMember(s: Store, actor: number, id: number, name: string) {
  const ar = need(s, id, actor, 'admin'); const t = target(s, name); const m = member(s, id, t.id);
  if (!m) throw new ApiError(404, '멤버가 아닙니다.');
  if (RANK[m.role] >= RANK[ar]) throw new ApiError(403, '같거나 높은 권한의 멤버는 내보낼 수 없습니다.');
  s.run('DELETE FROM club_members WHERE club_id=? AND user_id=?', id, t.id);
}
export function setRole(s: Store, actor: number, id: number, name: string, role: 'admin' | 'member') {
  need(s, id, actor, 'owner'); const t = target(s, name); const m = member(s, id, t.id);
  if (!m || m.status !== 'active' || m.role === 'owner') throw new ApiError(400, '변경할 수 없습니다.');
  if (role !== 'admin' && role !== 'member') throw new ApiError(400, '잘못된 역할입니다.');
  s.run('UPDATE club_members SET role=? WHERE club_id=? AND user_id=?', role, id, t.id);
}
export function updateClub(s: Store, actor: number, id: number, b: { about?: string; notice?: string; public?: boolean }) {
  need(s, id, actor, 'admin');
  if (b.about !== undefined) s.run('UPDATE clubs SET about=? WHERE id=?', String(b.about).slice(0, 300), id);
  if (b.notice !== undefined) s.run('UPDATE clubs SET notice=? WHERE id=?', String(b.notice).replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 500), id);
  if (b.public !== undefined) { need(s, id, actor, 'owner'); s.run('UPDATE clubs SET is_public=? WHERE id=?', b.public ? 1 : 0, id); }
}
export function deleteClub(s: Store, actor: number, id: number) { need(s, id, actor, 'owner'); s.run('DELETE FROM clubs WHERE id=?', id); }
/** Owner's name, used as the target of a club report. */
export function clubOwner(s: Store, id: number): string { return (s.get('SELECT u.name n FROM club_members m JOIN users u ON u.id=m.user_id WHERE m.club_id=? AND m.role=\'owner\'', id) as any)?.n; }
