import type { Db } from './db';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { DEFAULTS, ITEM_BY_ID, FREE_ITEMS, type Slot } from '../src/catalog';
import { SEASONS, CLAIM_GRACE_MS, type Season } from '../src/seasons';
import type { GameKind } from '../src/protocol';
import { migrate } from './migrate';
import { ratingCat } from '../src/ratingConfig';
import { TIME_CONTROLS } from '../src/games/chess';

export const START_RATING = 1200;
const SESSION_MS = 30 * 86400_000;
export const DAILY_COIN_CAP = 100;
export const MIN_REWARD_PLIES = 6;
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export interface GameSummary {
  id: string; game: GameKind; whiteId: number | null; blackId: number | null; whiteName: string; blackName: string;
  rated: boolean; time: string; result: 'w' | 'b' | 'draw'; reason: string; moves: string[]; tid?: number | null;
}
export const catOf = (game: GameKind, time: string) => { const t = TIME_CONTROLS.find((x) => x.id === time) ?? TIME_CONTROLS[0]; return ratingCat(game, t.baseSec, t.incSec); };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const NAME_RE = /^[A-Za-z0-9가-힣_]{2,16}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function eloDelta(ra: number, rb: number, score: number, games: number): number {
  const k = games < 20 ? 40 : 20;
  return Math.round(k * (score - 1 / (1 + 10 ** ((rb - ra) / 400))));
}

type Row = Record<string, any>;

export class Store {
  db: Db;
  constructor(db: Db, public now: () => number = Date.now) {
    this.db = db;
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, name_lc TEXT UNIQUE NOT NULL,
        salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL, coins INTEGER NOT NULL DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ratings(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, game TEXT NOT NULL, rating INTEGER NOT NULL, games INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,game));
      CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY, game TEXT NOT NULL, white_id INTEGER, black_id INTEGER, white_name TEXT NOT NULL, black_name TEXT NOT NULL,
        rated INTEGER NOT NULL, time TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL, moves TEXT NOT NULL, delta_w INTEGER, delta_b INTEGER, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS games_w ON games(white_id); CREATE INDEX IF NOT EXISTS games_b ON games(black_id);
      CREATE TABLE IF NOT EXISTS inventory(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, item TEXT NOT NULL, PRIMARY KEY(user_id,item));
      CREATE TABLE IF NOT EXISTS equipped(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, slot TEXT NOT NULL, item TEXT NOT NULL, PRIMARY KEY(user_id,slot));
      CREATE TABLE IF NOT EXISTS friends(a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, PRIMARY KEY(a,b));
      CREATE TABLE IF NOT EXISTS blocks(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(user_id,blocked));
      CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, reporter INTEGER, target INTEGER, reason TEXT NOT NULL, game_id TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open');
      CREATE TABLE IF NOT EXISTS rewards(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, coins INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY(user_id,key));
      CREATE TABLE IF NOT EXISTS season_claims(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, season TEXT NOT NULL, reward TEXT NOT NULL, PRIMARY KEY(user_id,season,reward));
      CREATE TABLE IF NOT EXISTS season_results(season TEXT NOT NULL, game TEXT NOT NULL, rank INTEGER NOT NULL, user_id INTEGER, rating INTEGER NOT NULL, PRIMARY KEY(season,game,rank));
    `);
    migrate(this.db);
  }
  get(sql: string, ...p: any[]): Row | undefined { return this.db.prepare(sql).get(...p) as Row | undefined; }
  all(sql: string, ...p: any[]): Row[] { return this.db.prepare(sql).all(...p) as Row[]; }
  run(sql: string, ...p: any[]) { return this.db.prepare(sql).run(...p); }
  tx<T>(fn: () => T): T { return this.db.tx(fn); }

  // ---- accounts ----
  register(email: string, name: string, password: string): number {
    email = String(email ?? '').trim().toLowerCase(); name = String(name ?? '').trim(); password = String(password ?? '');
    if (!EMAIL_RE.test(email)) throw new ApiError(400, '이메일 형식이 올바르지 않습니다.');
    if (!NAME_RE.test(name)) throw new ApiError(400, '닉네임은 2~16자의 한글·영문·숫자·밑줄만 쓸 수 있습니다.');
    if (password.length < 8 || password.length > 128) throw new ApiError(400, '비밀번호는 8자 이상이어야 합니다.');
    if (this.get('SELECT 1 FROM users WHERE email=?', email)) throw new ApiError(409, '이미 가입된 이메일입니다.');
    if (this.get('SELECT 1 FROM users WHERE name_lc=?', name.toLowerCase())) throw new ApiError(409, '이미 사용 중인 닉네임입니다.');
    const salt = randomBytes(16).toString('hex'), hash = scryptSync(password, salt, 64).toString('hex');
    return this.tx(() => {
      const id = Number(this.run('INSERT INTO users(email,name,name_lc,salt,hash,created) VALUES(?,?,?,?,?,?)', email, name, name.toLowerCase(), salt, hash, this.now()).lastInsertRowid);
      for (const i of FREE_ITEMS) this.run('INSERT INTO inventory VALUES(?,?)', id, i);
      for (const [slot, item] of Object.entries(DEFAULTS)) this.run('INSERT INTO equipped VALUES(?,?,?)', id, slot, item);
      return id;
    });
  }
  login(email: string, password: string): number {
    const u = this.get('SELECT * FROM users WHERE email=?', String(email ?? '').trim().toLowerCase());
    const salt = u?.salt ?? '00'.repeat(16);
    const h = scryptSync(String(password ?? '').slice(0, 128), salt, 64);
    if (!u || !timingSafeEqual(h, Buffer.from(u.hash, 'hex'))) throw new ApiError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
    return u.id;
  }
  createSession(userId: number): string {
    const token = randomBytes(32).toString('base64url');
    this.run('INSERT INTO sessions VALUES(?,?,?)', sha(token), userId, this.now() + SESSION_MS);
    return token;
  }
  userBySession(token: string | undefined): { id: number; name: string } | null {
    if (!token) return null;
    const r = this.get('SELECT u.id,u.name,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', sha(token));
    if (!r || r.expires < this.now()) return null;
    return { id: r.id, name: r.name };
  }
  endSession(token: string) { this.run('DELETE FROM sessions WHERE token=?', sha(token)); }
  deleteUser(id: number, password: string) {
    const u = this.get('SELECT * FROM users WHERE id=?', id)!;
    if (!timingSafeEqual(scryptSync(String(password ?? '').slice(0, 128), u.salt, 64), Buffer.from(u.hash, 'hex'))) throw new ApiError(401, '비밀번호가 올바르지 않습니다.');
    // Games keep only anonymised names; personal rows cascade away.
    this.tx(() => {
      this.run('UPDATE games SET white_id=NULL, white_name=\'(탈퇴)\' WHERE white_id=?', id);
      this.run('UPDATE games SET black_id=NULL, black_name=\'(탈퇴)\' WHERE black_id=?', id);
      this.run('UPDATE reports SET reporter=NULL WHERE reporter=?', id); this.run('UPDATE reports SET target=NULL WHERE target=?', id);
      // clubs: ownership passes to the longest-standing admin, else member; a club with nobody left is deleted
      for (const c of this.all('SELECT club_id FROM club_members WHERE user_id=? AND role=\'owner\' AND status=\'active\'', id)) {
        const next = this.get('SELECT user_id FROM club_members WHERE club_id=? AND user_id<>? AND status=\'active\' ORDER BY CASE role WHEN \'admin\' THEN 0 ELSE 1 END, rowid LIMIT 1', c.club_id, id);
        if (next) this.run('UPDATE club_members SET role=\'owner\' WHERE club_id=? AND user_id=?', c.club_id, next.user_id); else this.run('DELETE FROM clubs WHERE id=?', c.club_id);
      }
      this.run('UPDATE audit_log SET admin_id=NULL WHERE admin_id=?', id); this.run('UPDATE tournaments SET created_by=NULL WHERE created_by=?', id);
      this.run('UPDATE season_results SET user_id=NULL WHERE user_id=?', id);
      this.run('DELETE FROM users WHERE id=?', id);
    });
  }
  userByName(name: string) { return this.get('SELECT id,name,is_public FROM users WHERE name_lc=?', String(name ?? '').toLowerCase()); }
  nameOf(id: number) { return this.get('SELECT name FROM users WHERE id=?', id)?.name as string | undefined; }
  setPublic(id: number, v: boolean) { this.run('UPDATE users SET is_public=? WHERE id=?', v ? 1 : 0, id); }

  // ---- ratings & games ----
  rating(id: number, game: GameKind, cat: string = game === 'gomoku' ? 'std' : 'rapid') { return (this.get('SELECT rating FROM ratings WHERE user_id=? AND game=? AND cat=?', id, game, cat)?.rating as number) ?? START_RATING; }
  ratings(id: number) { return this.all('SELECT game,cat,rating,games FROM ratings WHERE user_id=?', id); }

  /** Idempotent: the same game id is only recorded (and rated/rewarded) once. */
  recordGame(g: GameSummary): { w: number; b: number } | null {
    return this.tx(() => {
      if (this.get('SELECT 1 FROM games WHERE id=?', g.id)) return null;
      const bothUsers = g.whiteId !== null && g.blackId !== null && g.whiteId !== g.blackId;
      const rated = g.rated && bothUsers && g.moves.length >= 2;
      let dw: number | null = null, db: number | null = null;
      if (rated) {
        const cat = catOf(g.game, g.time);
        const cur = (id: number) => this.get('SELECT rating,games FROM ratings WHERE user_id=? AND game=? AND cat=?', id, g.game, cat) ?? { rating: START_RATING, games: 0 };
        const a = cur(g.whiteId!), b = cur(g.blackId!);
        const sw = g.result === 'w' ? 1 : g.result === 'draw' ? 0.5 : 0;
        dw = eloDelta(a.rating, b.rating, sw, a.games); db = eloDelta(b.rating, a.rating, 1 - sw, b.games);
        const up = (id: number, r: Row, d: number) => this.run('INSERT INTO ratings VALUES(?,?,?,?,1) ON CONFLICT(user_id,game,cat) DO UPDATE SET rating=?, games=games+1', id, g.game, cat, r.rating + d, r.rating + d);
        up(g.whiteId!, a, dw); up(g.blackId!, b, db);
      }
      this.run('INSERT INTO games(id,game,white_id,black_id,white_name,black_name,rated,time,result,reason,moves,delta_w,delta_b,created,cat,tid) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', g.id, g.game, g.whiteId, g.blackId, g.whiteName, g.blackName, rated ? 1 : 0, g.time, g.result, g.reason, JSON.stringify(g.moves), dw, db, this.now(), catOf(g.game, g.time), g.tid ?? null);
      if (g.tid && bothUsers) this.tournamentResult(g);
      if (bothUsers && g.moves.length >= MIN_REWARD_PLIES) {
        const day = new Date(this.now()).toISOString().slice(0, 10);
        for (const [uid, side] of [[g.whiteId!, 'w'], [g.blackId!, 'b']] as const) {
          const want = g.result === 'draw' ? 5 : g.result === side ? 10 : 3;
          const used = (this.get('SELECT COALESCE(SUM(coins),0) s FROM rewards WHERE user_id=? AND day=?', uid, day)?.s as number) ?? 0;
          const coins = Math.max(0, Math.min(want, DAILY_COIN_CAP - used));
          if (coins > 0) { this.run('INSERT OR IGNORE INTO rewards VALUES(?,?,?,?)', uid, 'game:' + g.id, coins, day); this.run('UPDATE users SET coins=coins+? WHERE id=?', coins, uid); }
        }
      }
      return dw === null ? { w: 0, b: 0 } : { w: dw, b: db! };
    });
  }
  tournamentResult(g: GameSummary) {
    for (const [uid, side] of [[g.whiteId!, 'w'], [g.blackId!, 'b']] as const) {
      const pts = g.result === 'draw' ? 1 : g.result === side ? 2 : 0;
      this.run('UPDATE tournament_players SET points=points+?, played=played+1, wins=wins+? WHERE tid=? AND user_id=?', pts, g.result === side ? 1 : 0, g.tid, uid);
    }
  }
  gamesOf(id: number, limit = 30) {
    return this.all('SELECT id,game,cat,white_name,black_name,white_id,black_id,rated,time,result,reason,delta_w,delta_b,created FROM games WHERE white_id=? OR black_id=? ORDER BY created DESC LIMIT ?', id, id, Math.min(limit, 100));
  }
  gameFor(userId: number, gameId: string) {
    const g = this.get('SELECT * FROM games WHERE id=?', gameId);
    if (!g || (g.white_id !== userId && g.black_id !== userId)) return null;
    return { ...g, moves: JSON.parse(g.moves) };
  }
  stats(id: number) {
    const r = this.all('SELECT game, CASE WHEN result=\'draw\' THEN \'d\' WHEN (result=\'w\' AND white_id=?) OR (result=\'b\' AND black_id=?) THEN \'w\' ELSE \'l\' END o, COUNT(*) c FROM games WHERE white_id=? OR black_id=? GROUP BY game,o', id, id, id, id);
    const out: Record<string, { w: number; l: number; d: number }> = {};
    for (const x of r) { (out[x.game] ??= { w: 0, l: 0, d: 0 })[x.o as 'w' | 'l' | 'd'] = x.c; }
    return out;
  }
  leaderboard(game: GameKind, cat: string, offset: number, limit: number, me?: number) {
    offset = Math.max(0, offset | 0); limit = Math.min(50, Math.max(1, limit | 0));
    const rows = this.all('SELECT u.name,r.rating,r.games,r.user_id FROM ratings r JOIN users u ON u.id=r.user_id WHERE r.game=? AND r.cat=? AND r.games>0 ORDER BY r.rating DESC, r.games DESC, u.id LIMIT ? OFFSET ?', game, cat, limit, offset)
      .map((r, i) => ({ rank: offset + i + 1, name: r.name, rating: r.rating, games: r.games, me: r.user_id === me }));
    const total = this.get('SELECT COUNT(*) c FROM ratings WHERE game=? AND cat=? AND games>0', game, cat)!.c as number;
    let mine: { rank: number; rating: number; games: number } | null = null;
    if (me) {
      const m = this.get('SELECT rating,games FROM ratings WHERE user_id=? AND game=? AND cat=? AND games>0', me, game, cat);
      if (m) mine = { rank: (this.get('SELECT COUNT(*) c FROM ratings WHERE game=? AND cat=? AND games>0 AND rating>?', game, cat, m.rating)!.c as number) + 1, rating: m.rating, games: m.games };
    }
    return { rows, total, mine };
  }

  // ---- shop ----
  coins(id: number) { return this.get('SELECT coins FROM users WHERE id=?', id)!.coins as number; }
  inventory(id: number) { return this.all('SELECT item FROM inventory WHERE user_id=?', id).map((r) => r.item as string); }
  equipped(id: number): Record<string, string> { return Object.fromEntries(this.all('SELECT slot,item FROM equipped WHERE user_id=?', id).map((r) => [r.slot, r.item])); }
  buy(id: number, itemId: string) {
    const it = ITEM_BY_ID.get(itemId);
    if (!it) throw new ApiError(404, '없는 아이템입니다.');
    if (it.price === null) throw new ApiError(400, '구매할 수 없는 보상 아이템입니다.');
    this.tx(() => {
      if (this.get('SELECT 1 FROM inventory WHERE user_id=? AND item=?', id, itemId)) throw new ApiError(409, '이미 보유한 아이템입니다.');
      const upd = this.run('UPDATE users SET coins=coins-? WHERE id=? AND coins>=?', it.price!, id, it.price!);
      if (!upd.changes) throw new ApiError(402, '코인이 부족합니다.');
      this.run('INSERT INTO inventory VALUES(?,?)', id, itemId);
    });
  }
  equip(id: number, itemId: string) {
    const it = ITEM_BY_ID.get(itemId);
    if (!it) throw new ApiError(404, '없는 아이템입니다.');
    if (!this.get('SELECT 1 FROM inventory WHERE user_id=? AND item=?', id, itemId)) throw new ApiError(403, '보유하지 않은 아이템입니다.');
    this.run('INSERT INTO equipped VALUES(?,?,?) ON CONFLICT(user_id,slot) DO UPDATE SET item=?', id, it.slot as Slot, itemId, itemId);
  }

  // ---- seasons ----
  seasonById(id: string): Season | undefined { return SEASONS.find((s) => s.id === id); }
  seasonProgress(userId: number, s: Season) {
    const a = Date.parse(s.start), b = Date.parse(s.end);
    const rows = this.all('SELECT result,white_id FROM games WHERE rated=1 AND created BETWEEN ? AND ? AND (white_id=? OR black_id=?)', a, b, userId, userId);
    const wins = rows.filter((r) => (r.result === 'w') === (r.white_id === userId) && r.result !== 'draw').length;
    const rank = this.all('SELECT MIN(rank) r FROM season_results WHERE season=? AND user_id=?', s.id, userId)[0]?.r as number | null;
    return { rated: rows.length, wins, topRank: rank ?? null, claimed: this.all('SELECT reward FROM season_claims WHERE user_id=? AND season=?', userId, s.id).map((r) => r.reward as string) };
  }
  claimSeasonReward(userId: number, seasonId: string, rewardId: string) {
    const s = this.seasonById(seasonId), r = s?.rewards.find((x) => x.id === rewardId);
    if (!s || !r) throw new ApiError(404, '없는 보상입니다.');
    const t = this.now();
    if (t < Date.parse(s.start) || t > Date.parse(s.end) + CLAIM_GRACE_MS) throw new ApiError(400, '수령 기간이 아닙니다.');
    this.tx(() => {
      const p = this.seasonProgress(userId, s);
      const need = r.need ?? {};
      if ((need.rated && p.rated < need.rated) || (need.wins && p.wins < need.wins) || (need.topRank && !(p.topRank !== null && p.topRank <= need.topRank))) throw new ApiError(400, '조건을 아직 달성하지 못했습니다.');
      if (this.get('SELECT 1 FROM season_claims WHERE user_id=? AND season=? AND reward=?', userId, seasonId, rewardId)) throw new ApiError(409, '이미 수령했습니다.');
      this.run('INSERT INTO season_claims VALUES(?,?,?)', userId, seasonId, rewardId);
      if (r.give.coins) this.run('UPDATE users SET coins=coins+? WHERE id=?', r.give.coins, userId);
      if (r.give.item) this.run('INSERT OR IGNORE INTO inventory VALUES(?,?)', userId, r.give.item);
    });
  }
  /** Idempotent: snapshots the top 10 per game once a season has ended. Run from the server tick. */
  finalizeSeasons() {
    for (const s of SEASONS) {
      if (this.now() <= Date.parse(s.end) || this.get('SELECT 1 FROM season_results WHERE season=? LIMIT 1', s.id)) continue;
      this.tx(() => {
        for (const [game, cat] of [['chess', 'blitz'], ['chess', 'rapid'], ['chess', 'bullet'], ['chess', 'untimed'], ['gomoku', 'std']] as const) {
          this.all('SELECT user_id,rating FROM ratings WHERE game=? AND cat=? AND games>0 ORDER BY rating DESC, games DESC, user_id LIMIT 10', game, cat)
            .forEach((r, i) => this.run('INSERT INTO season_results VALUES(?,?,?,?,?)', s.id, `${game}/${cat}`, i + 1, r.user_id, r.rating));
        }
        this.run('INSERT OR IGNORE INTO season_results VALUES(?,?,?,?,?)', s.id, '_done', 0, null, 0);
      });
    }
  }

  // ---- social ----
  isBlocked(a: number, b: number) { return !!this.get('SELECT 1 FROM blocks WHERE (user_id=? AND blocked=?) OR (user_id=? AND blocked=?)', a, b, b, a); }
  block(me: number, name: string) {
    const t = this.userByName(name); if (!t || t.id === me) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    this.tx(() => { this.run('INSERT OR IGNORE INTO blocks VALUES(?,?)', me, t.id); this.run('DELETE FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)', me, t.id, t.id, me); });
  }
  unblock(me: number, name: string) { const t = this.userByName(name); if (t) this.run('DELETE FROM blocks WHERE user_id=? AND blocked=?', me, t.id); }
  friendRequest(me: number, name: string) {
    const t = this.userByName(name);
    if (!t || t.id === me || this.isBlocked(me, t.id)) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    const rev = this.get('SELECT status FROM friends WHERE a=? AND b=?', t.id, me);
    if (rev?.status === 'accepted' || this.get('SELECT 1 FROM friends WHERE a=? AND b=? AND status=\'accepted\'', me, t.id)) throw new ApiError(409, '이미 친구입니다.');
    if (rev?.status === 'pending') return this.acceptFriend(me, name);
    this.run('INSERT OR IGNORE INTO friends VALUES(?,?,\'pending\')', me, t.id);
  }
  acceptFriend(me: number, name: string) {
    const t = this.userByName(name);
    if (!t || !this.get('SELECT 1 FROM friends WHERE a=? AND b=? AND status=\'pending\'', t.id, me)) throw new ApiError(404, '받은 요청이 없습니다.');
    this.tx(() => { this.run('UPDATE friends SET status=\'accepted\' WHERE a=? AND b=?', t.id, me); this.run('INSERT OR REPLACE INTO friends VALUES(?,?,\'accepted\')', me, t.id); });
  }
  removeFriend(me: number, name: string) {
    const t = this.userByName(name); if (!t) return;
    this.run('DELETE FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)', me, t.id, t.id, me);
  }
  isFriend(a: number, b: number) { return !!this.get('SELECT 1 FROM friends WHERE a=? AND b=? AND status=\'accepted\'', a, b); }
  friends(me: number) {
    const n = (q: string) => this.all(q, me).map((r) => ({ id: r.id as number, name: r.name as string }));
    return {
      friends: n('SELECT u.id,u.name FROM friends f JOIN users u ON u.id=f.b WHERE f.a=? AND f.status=\'accepted\' ORDER BY u.name'),
      incoming: n('SELECT u.id,u.name FROM friends f JOIN users u ON u.id=f.a WHERE f.b=? AND f.status=\'pending\''),
      outgoing: n('SELECT u.id,u.name FROM friends f JOIN users u ON u.id=f.b WHERE f.a=? AND f.status=\'pending\''),
      blocked: n('SELECT u.id,u.name FROM blocks b JOIN users u ON u.id=b.blocked WHERE b.user_id=?'),
    };
  }
  report(me: number, name: string, reason: string, gameId?: string, context?: string, kind = 'user') {
    const t = this.userByName(name); reason = Store.redact(String(reason ?? '').trim());
    if (!t || t.id === me) throw new ApiError(404, '사용자를 찾을 수 없습니다.');
    if (reason.length < 3) throw new ApiError(400, '신고 사유를 입력하세요.');
    const day = this.now() - 86400_000;
    if ((this.get('SELECT COUNT(*) c FROM reports WHERE reporter=? AND created>?', me, day)!.c as number) >= 10) throw new ApiError(429, '하루 신고 한도를 넘었습니다.');
    this.run('INSERT INTO reports(reporter,target,reason,game_id,created,kind,context) VALUES(?,?,?,?,?,?,?)', me, t.id, reason, gameId ? String(gameId).slice(0, 40) : null, this.now(), kind, context ? Store.redact(context, 2500) : null);
  }

  // ---- unfinished online rooms (restart recovery) ----
  saveRoom(code: string, data: string) { this.run('INSERT INTO rooms VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET data=?, updated=?', code, data, this.now(), data, this.now()); }
  dropRoom(code: string) { this.run('DELETE FROM rooms WHERE code=?', code); }
  loadRooms(): string[] { return this.all('SELECT data FROM rooms').map((r) => r.data as string); }
  gameRecorded(id: string) { return !!this.get('SELECT 1 FROM games WHERE id=?', id); }
  setMeta(k: string, v: string) { this.run('INSERT INTO meta VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?', k, v, v); }
  getMeta(k: string) { return this.get('SELECT v FROM meta WHERE k=?', k)?.v as string | undefined; }

  // ---- email tokens, password reset ----
  admins = new Set<string>();
  userByEmail(email: string) { return this.get('SELECT id,email,name,email_verified FROM users WHERE email=?', String(email ?? '').trim().toLowerCase()); }
  userRow(id: number) { return this.get('SELECT id,email,name,email_verified FROM users WHERE id=?', id); }
  /** Admin = email listed in ADMIN_EMAILS AND verified (ownership proven by email link, or by the operator via scripts/verify-user.ts). */
  isAdmin(id: number) { const u = this.userRow(id); return !!u && u.email_verified === 1 && this.admins.has(String(u.email)); }
  /** Returns the raw token (only ever sent by email); only its SHA-256 is stored. Max 3 per hour per user and kind. */
  createToken(userId: number, kind: 'verify' | 'reset', ttlMs: number): string {
    const recent = this.get('SELECT COUNT(*) c FROM tokens WHERE user_id=? AND kind=? AND created>?', userId, kind, this.now() - 3600_000)!.c as number;
    if (recent >= 3) throw new ApiError(429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
    const raw = randomBytes(32).toString('base64url');
    this.run('INSERT INTO tokens VALUES(?,?,?,?,0,?)', sha(raw), userId, kind, this.now() + ttlMs, this.now());
    return raw;
  }
  revokeToken(raw: string) { this.run('DELETE FROM tokens WHERE hash=?', sha(String(raw))); }
  /** One-time use: succeeds once, then the same token is rejected. */
  consumeToken(raw: string, kind: 'verify' | 'reset'): number {
    return this.tx(() => {
      const r = this.get('SELECT user_id,expires,used FROM tokens WHERE hash=? AND kind=?', sha(String(raw ?? '')), kind);
      if (!r || r.used || r.expires < this.now()) throw new ApiError(400, '링크가 만료되었거나 이미 사용되었습니다.');
      this.run('UPDATE tokens SET used=1 WHERE hash=?', sha(String(raw)));
      return r.user_id as number;
    });
  }
  markVerified(id: number) { this.run('UPDATE users SET email_verified=1 WHERE id=?', id); }
  deleteSessions(id: number) { this.run('DELETE FROM sessions WHERE user_id=?', id); }
  setPassword(id: number, password: string) {
    password = String(password ?? '');
    if (password.length < 8 || password.length > 128) throw new ApiError(400, '비밀번호는 8자 이상이어야 합니다.');
    const salt = randomBytes(16).toString('hex'), hash = scryptSync(password, salt, 64).toString('hex');
    this.tx(() => { this.run('UPDATE users SET salt=?, hash=?, pw_changed=? WHERE id=?', salt, hash, this.now(), id); this.deleteSessions(id); this.run('UPDATE tokens SET used=1 WHERE user_id=? AND kind=\'reset\'', id); });
  }
  changePassword(id: number, oldPw: string, newPw: string) {
    const u = this.get('SELECT salt,hash FROM users WHERE id=?', id)!;
    if (!timingSafeEqual(scryptSync(String(oldPw ?? '').slice(0, 128), u.salt, 64), Buffer.from(u.hash, 'hex'))) throw new ApiError(401, '현재 비밀번호가 올바르지 않습니다.');
    this.setPassword(id, newPw);
  }
  purgeExpired() { this.run('DELETE FROM tokens WHERE expires<?', this.now() - 86400_000); this.run('DELETE FROM sessions WHERE expires<?', this.now()); }

  // ---- reports & admin audit ----
  static redact(s: string, max = 500): string {
    return String(s ?? '').replace(/(password|passwd|pw|비밀번호|token|토큰)\s*[:=]?\s*\S+/gi, '$1 [가림]').replace(/[A-Za-z0-9_-]{24,}/g, '[가림]').slice(0, max);
  }
  audit(adminId: number | null, action: string, target: string | null, detail?: string) { this.run('INSERT INTO audit_log(admin_id,action,target,detail,at) VALUES(?,?,?,?,?)', adminId, action, target, detail ? String(detail).slice(0, 300) : null, this.now()); }
  auditLog(limit = 100) { return this.all('SELECT a.id,a.action,a.target,a.detail,a.at,u.name admin FROM audit_log a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT ?', Math.min(limit, 200)); }
  listReports(adminId: number, status?: string) {
    const rows = this.all(`SELECT r.id,r.kind,r.reason,r.game_id,r.context,r.created,r.status,r.note,r.handled_at,rp.name reporter,tg.name target,h.name handled_by
      FROM reports r LEFT JOIN users rp ON rp.id=r.reporter LEFT JOIN users tg ON tg.id=r.target LEFT JOIN users h ON h.id=r.handled_by
      ${status ? 'WHERE r.status=?' : ''} ORDER BY r.created DESC LIMIT 200`, ...(status ? [status] : []));
    this.audit(adminId, 'view_reports', status ?? 'all', `${rows.length} rows`);
    return rows;
  }
  handleReport(adminId: number, id: number, status: string, note: string) {
    if (!['open', 'reviewing', 'actioned', 'dismissed'].includes(status)) throw new ApiError(400, '알 수 없는 상태입니다.');
    const r = this.get('SELECT id FROM reports WHERE id=?', id); if (!r) throw new ApiError(404, '신고를 찾을 수 없습니다.');
    this.run('UPDATE reports SET status=?, note=?, handled_by=?, handled_at=? WHERE id=?', status, Store.redact(note), adminId, this.now(), id);
    this.audit(adminId, 'handle_report', String(id), status);
  }

  exportUser(id: number) {
    const u = this.get('SELECT id,email,name,created,coins,is_public FROM users WHERE id=?', id)!;
    return {
      user: u, ratings: this.ratings(id), games: this.all('SELECT * FROM games WHERE white_id=? OR black_id=?', id, id), inventory: this.inventory(id), equipped: this.equipped(id), friends: this.friends(id),
      clubs: this.all('SELECT c.name,m.role,m.status FROM club_members m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=?', id),
      tournaments: this.all('SELECT t.name,p.points,p.played,p.wins,p.final_rank FROM tournament_players p JOIN tournaments t ON t.id=p.tid WHERE p.user_id=?', id),
      reportsFiled: this.all('SELECT kind,reason,created,status FROM reports WHERE reporter=?', id),
      seasonClaims: this.all('SELECT season,reward FROM season_claims WHERE user_id=?', id),
    };
  }
}
