import { DatabaseSync } from 'node:sqlite';
import { Store } from './store';
import type { Db } from './db';

export class NodeDb implements Db {
  private d: DatabaseSync;
  constructor(path: string) { this.d = new DatabaseSync(path); }
  exec(sql: string) { this.d.exec(sql); }
  prepare(sql: string) { return this.d.prepare(sql) as unknown as ReturnType<Db['prepare']>; }
  tx<T>(fn: () => T): T { this.d.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.d.exec('COMMIT'); return r; } catch (e) { this.d.exec('ROLLBACK'); throw e; } }
  getVersion() { return (this.d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; }
  setVersion(v: number) { this.d.exec(`PRAGMA user_version=${Number(v) | 0}`); }
  close() { this.d.close(); }
}
/** Convenience for Node: a Store on a SQLite file (or ':memory:'). */
export const openStore = (path = ':memory:', now: () => number = Date.now) => new Store(new NodeDb(path), now);
