import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store';
import { SCHEMA_VERSION } from './migrate';

// DDL of the first released server version (schema v1) – a real "old" database to migrate.
const V1 = `
CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, name_lc TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL, coins INTEGER NOT NULL DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 1);
CREATE TABLE ratings(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, game TEXT NOT NULL, rating INTEGER NOT NULL, games INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,game));
CREATE TABLE games(id TEXT PRIMARY KEY, game TEXT NOT NULL, white_id INTEGER, black_id INTEGER, white_name TEXT NOT NULL, black_name TEXT NOT NULL, rated INTEGER NOT NULL, time TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL, moves TEXT NOT NULL, delta_w INTEGER, delta_b INTEGER, created INTEGER NOT NULL);
CREATE TABLE reports(id INTEGER PRIMARY KEY, reporter INTEGER, target INTEGER, reason TEXT NOT NULL, game_id TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open');
INSERT INTO users VALUES(1,'a@x.com','alice','alice','s','h',1,42,1),(2,'b@x.com','bobby','bobby','s','h',1,7,1);
INSERT INTO ratings VALUES(1,'chess',1500,30),(2,'chess',1400,30),(1,'gomoku',1300,5);
INSERT INTO games VALUES('g1','chess',1,2,'alice','bobby',1,'5+0','w','x','["e4","e5"]',10,-10,5);
INSERT INTO games VALUES('g2','gomoku',1,2,'alice','bobby',1,'none','b','x','[0,1]',-5,5,6);
INSERT INTO reports VALUES(1,1,2,'rude',NULL,9,'open');
`;

describe('schema migration', () => {
  it('upgrades a v1 database in place, keeping every user, rating, game and report', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bv-')), 'old.db');
    const old = new DatabaseSync(path); old.exec(V1); old.close();
    const s = new Store(path);
    expect((s.db.prepare('PRAGMA user_version').get() as any).user_version).toBe(SCHEMA_VERSION);
    expect(s.coins(1)).toBe(42);
    expect(s.ratings(1).sort((a, b) => a.game.localeCompare(b.game))).toEqual([{ game: 'chess', cat: 'legacy', rating: 1500, games: 30 }, { game: 'gomoku', cat: 'std', rating: 1300, games: 5 }]);
    expect(s.rating(1, 'chess', 'blitz')).toBe(1200); // old score is NOT copied into new time categories
    expect(s.all('SELECT id,cat FROM games ORDER BY id')).toEqual([{ id: 'g1', cat: 'legacy' }, { id: 'g2', cat: 'std' }]);
    expect(s.all('SELECT reason,kind,status FROM reports')).toEqual([{ reason: 'rude', kind: 'user', status: 'open' }]);
    // new games rate into the new category and keep legacy untouched
    s.recordGame({ id: 'n1', game: 'chess', whiteId: 1, blackId: 2, whiteName: 'alice', blackName: 'bobby', rated: true, time: '5+0', result: 'w', reason: 'x', moves: ['a', 'b', 'c', 'd'] });
    expect(s.rating(1, 'chess', 'blitz')).toBe(1220); expect(s.rating(1, 'chess', 'legacy')).toBe(1500);
    s.db.close();
    const again = new Store(path); // idempotent re-open
    expect(again.rating(1, 'chess', 'blitz')).toBe(1220);
  });
  it('a fresh database lands on the same schema version', () => {
    expect((new Store(':memory:').db.prepare('PRAGMA user_version').get() as any).user_version).toBe(SCHEMA_VERSION);
  });
});
