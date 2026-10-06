import { DurableObject } from 'cloudflare:workers';
import { createCore, originOk, type Env } from '../server/core';
import { Store } from '../server/store';
import { DoDb } from './dodb';

/** Cloudflare adapter. ONE Durable Object ("main") runs the whole application — rooms in memory, everything else in its SQLite — which is
 *  exactly the single-instance model the Node server already requires. Static files are served by Workers Static Assets (see wrangler.toml). */
interface WorkerEnv { HUB: DurableObjectNamespace; ASSETS: Fetcher; [k: string]: unknown }
const strings = (env: object): Env => Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string')) as Env;
const READY_MS = 5_000, IDLE_MS = 15_000, QUIET_MS = 10 * 60_000;

export class Hub extends DurableObject<WorkerEnv> {
  private core!: ReturnType<typeof createCore>;
  private sockets = 0;
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.core = createCore(new Store(new DoDb(ctx.storage), Date.now), { env: strings(env) }); // restores unfinished rooms from SQLite
      await this.arm();
    });
    setInterval(() => this.core?.tick(), 500); // precise clocks while the object is awake; alarms wake it for the rest
  }
  private arm() { return this.ctx.storage.setAlarm(Date.now() + (this.sockets > 0 ? READY_MS : this.core.mgr.rooms.size > 0 ? IDLE_MS : QUIET_MS)); }
  async alarm() { this.core.tick(); await this.arm(); }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') return this.upgrade(req);
    const raw = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
    if (raw.length > 4096) return Response.json({ error: '요청이 너무 큽니다.' }, { status: 413 });
    const headers = Object.fromEntries(req.headers) as Record<string, string | undefined>;
    if (url.protocol === 'https:') headers['x-forwarded-proto'] = 'https'; // Cloudflare terminates TLS for us
    const r = await this.core.handle({ method: req.method, path: url.pathname, query: url.searchParams, headers, ip: req.headers.get('cf-connecting-ip') ?? 'unknown', body: raw });
    return new Response(r.body, { status: r.status, headers: r.headers });
  }

  private upgrade(req: Request): Response {
    if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (!originOk(req.headers.get('origin'), req.headers.get('host'))) return new Response('forbidden', { status: 403 }); // no cross-site WebSocket hijacking
    const pair = new WebSocketPair(); const client = pair[1], server = pair[0];
    server.accept();
    const h = this.core.connect(req.headers.get('cookie') ?? undefined, (m) => { try { server.send(JSON.stringify(m)); } catch { /* closed */ } });
    this.sockets++;
    server.addEventListener('message', (ev: MessageEvent) => { const d = typeof ev.data === 'string' ? ev.data : ''; if (d.length > 2048) { server.close(1009, 'too large'); return; } h.message(d); });
    const done = () => { this.sockets = Math.max(0, this.sockets - 1); h.close(); };
    server.addEventListener('close', done); server.addEventListener('error', done);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }
}

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/ws' || pathname === '/healthz' || pathname.startsWith('/api/')) return env.HUB.get(env.HUB.idFromName('main')).fetch(req);
    return env.ASSETS.fetch(req);
  },
};
