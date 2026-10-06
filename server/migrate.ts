import type { DatabaseSync } from 'node:sqlite';

/** Schema version history (PRAGMA user_version). v0/v1 = original schema from the first server release.
 *  v2 = rating categories, tournaments, clubs, email tokens, admin audit, report triage.
 *  Migrations are additive and run inside a transaction; old data is preserved (never dropped). */
export const SCHEMA_VERSION = 2;
const cols = (db: DatabaseSync, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const addCol = (db: DatabaseSync, t: string, c: string, ddl: string) => { if (!cols(db, t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`); };

export function migrate(db: DatabaseSync) {
  const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (v >= SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!cols(db, 'ratings').includes('cat')) {
      // Old per-game ratings are kept, not copied into the new time categories: chess -> frozen 'legacy', gomoku -> 'std'.
      db.exec(`CREATE TABLE ratings_v2(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, game TEXT NOT NULL, cat TEXT NOT NULL, rating INTEGER NOT NULL, games INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,game,cat));
        INSERT INTO ratings_v2 SELECT user_id, game, CASE game WHEN 'chess' THEN 'legacy' ELSE 'std' END, rating, games FROM ratings;
        DROP TABLE ratings; ALTER TABLE ratings_v2 RENAME TO ratings;`);
    }
    addCol(db, 'games', 'cat', 'TEXT'); addCol(db, 'games', 'tid', 'INTEGER');
    db.exec("UPDATE games SET cat=CASE game WHEN 'chess' THEN 'legacy' ELSE 'std' END WHERE cat IS NULL");
    addCol(db, 'users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
    addCol(db, 'users', 'pw_changed', 'INTEGER NOT NULL DEFAULT 0');
    addCol(db, 'reports', 'kind', "TEXT NOT NULL DEFAULT 'user'");
    addCol(db, 'reports', 'note', 'TEXT'); addCol(db, 'reports', 'handled_by', 'INTEGER'); addCol(db, 'reports', 'handled_at', 'INTEGER');
    addCol(db, 'reports', 'context', 'TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY, admin_id INTEGER, action TEXT NOT NULL, target TEXT, detail TEXT, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tournaments(id INTEGER PRIMARY KEY, name TEXT NOT NULL, game TEXT NOT NULL, time TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 15, starts INTEGER NOT NULL, ends INTEGER NOT NULL, created_by INTEGER, finalized INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tournament_players(tid INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, points INTEGER NOT NULL DEFAULT 0, played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, final_rank INTEGER, PRIMARY KEY(tid,user_id));
      CREATE TABLE IF NOT EXISTS clubs(id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_lc TEXT UNIQUE NOT NULL, about TEXT NOT NULL DEFAULT '', notice TEXT NOT NULL DEFAULT '', is_public INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS club_members(club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(club_id,user_id));
    `);
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
