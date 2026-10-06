import type { Db } from '../server/db';

type Storage = DurableObjectState['storage'];
/** Durable Object SQLite behind the same tiny interface as node:sqlite. Differences handled here:
 *  - BEGIN/COMMIT are forbidden -> storage.transactionSync;  - PRAGMA user_version is forbidden -> a one-row table;
 *  - no lastInsertRowid on results -> last_insert_rowid();   - no `changes` -> rowsWritten (only ever used as a 0/non-0 flag). */
export class DoDb implements Db {
  constructor(private st: Storage) {}
  private q(sql: string, p: unknown[]) { const c = this.st.sql.exec(sql, ...p.map((x) => (x === undefined ? null : x))); return c; }
  exec(sql: string) { this.q(sql, []).toArray(); }
  prepare(sql: string) {
    return {
      get: (...p: any[]) => this.q(sql, p).toArray()[0],
      all: (...p: any[]) => this.q(sql, p).toArray(),
      run: (...p: any[]) => {
        const c = this.q(sql, p); c.toArray();
        const insert = /^\s*(insert|replace)/i.test(sql);
        return { changes: c.rowsWritten, lastInsertRowid: insert ? (this.st.sql.exec('SELECT last_insert_rowid() AS r').one().r as number) : 0 };
      },
    };
  }
  tx<T>(fn: () => T): T { return this.st.transactionSync(fn); }
  getVersion() { this.exec('CREATE TABLE IF NOT EXISTS __schema(k TEXT PRIMARY KEY, v INTEGER NOT NULL)'); return (this.prepare("SELECT v FROM __schema WHERE k='user_version'").get()?.v as number) ?? 0; }
  setVersion(v: number) { this.exec('CREATE TABLE IF NOT EXISTS __schema(k TEXT PRIMARY KEY, v INTEGER NOT NULL)'); this.prepare("INSERT INTO __schema VALUES('user_version', ?) ON CONFLICT(k) DO UPDATE SET v=?").run(v, v); }
}
