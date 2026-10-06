/** The tiny SQL surface the app needs. Implemented by node:sqlite (NodeDb, local/Docker) and by Durable Object SQLite (worker/dodb.ts). */
export interface Stmt { get(...p: any[]): any; all(...p: any[]): any[]; run(...p: any[]): { changes: number | bigint; lastInsertRowid: number | bigint } }
export interface Db {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  /** all-or-nothing: an exception rolls everything back and is rethrown */
  tx<T>(fn: () => T): T;
  getVersion(): number;
  setVersion(v: number): void;
  close?(): void;
}
