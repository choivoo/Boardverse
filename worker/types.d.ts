// Minimal ambient types for the Cloudflare runtime (we avoid @cloudflare/workers-types so it cannot clash with the DOM/Node typings used elsewhere).
declare module 'cloudflare:workers' {
  export class DurableObject<E = unknown> { constructor(ctx: DurableObjectState, env: E); ctx: DurableObjectState; env: E }
}
interface SqlCursor { toArray(): any[]; one(): any; readonly rowsWritten: number }
interface DurableObjectState {
  storage: { sql: { exec(query: string, ...bindings: unknown[]): SqlCursor }; transactionSync<T>(fn: () => T): T; setAlarm(t: number): Promise<void> };
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}
interface DurableObjectNamespace { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }
interface Fetcher { fetch(r: Request): Promise<Response> }
declare class WebSocketPair { 0: WebSocket & { accept(): void }; 1: WebSocket }
