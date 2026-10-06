import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';
import { createApp, type App } from './app';
import { openStore } from './nodedb';
import { createMailer } from './mail';
import type { ClientMsg, ServerMsg, RoomView } from '../src/protocol';

export interface Harness { app: App; base: string; port: number; clock: { t: number }; close(): Promise<void> }
export async function harness(env: Record<string, string | undefined> = {}, start = Date.parse('2026-11-01T00:00:00Z'), mailer = createMailer({ ADMIN_EMAILS: 'boss@x.com', ...env }), dbPath = ':memory:', clockRef?: { t: number }): Promise<Harness> {
  const clock = clockRef ?? { t: start }; const now = () => clock.t;
  const e = { ADMIN_EMAILS: 'boss@x.com', ...env };
  const app = createApp(openStore(dbPath, now), { dist: '/nonexistent', now, env: e, mailer });
  await new Promise<void>((r) => app.server.listen(0, r));
  const port = (app.server.address() as AddressInfo).port;
  return { app, port, base: `http://localhost:${port}`, clock, close: () => app.close() };
}
export async function account(h: Harness, name: string, email = `${name}@x.com`) {
  let r = await fetch(`${h.base}/api/register`, { method: 'POST', body: JSON.stringify({ email, name, password: 'password1' }) });
  if (r.status === 409) r = await fetch(`${h.base}/api/login`, { method: 'POST', body: JSON.stringify({ email, password: 'password1' }) }); // existing account (restart tests reuse a DB)
  expect(r.status).toBe(200);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const call = (path: string, method = 'GET', body?: unknown) => fetch(h.base + path, { method, headers: { cookie }, body: body ? JSON.stringify(body) : undefined }).then(async (x) => ({ status: x.status, json: await x.json().catch(() => null) as any }));
  return { name, email, cookie, call, id: h.app.store.userByName(name)!.id as number };
}
export function ws(h: Harness, cookie?: string) {
  const s = new WebSocket(`ws://localhost:${h.port}/ws`, { headers: cookie ? { cookie } : {} });
  const msgs: ServerMsg[] = [];
  s.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const open = new Promise<void>((r) => s.on('open', () => r()));
  const send = (m: ClientMsg) => s.send(JSON.stringify(m));
  const until = async <T extends ServerMsg>(pred: (m: ServerMsg) => boolean, ms = 2500): Promise<T> => { const t0 = Date.now(); for (;;) { const m = msgs.find(pred); if (m) return m as T; if (Date.now() - t0 > ms) throw new Error('timeout; last: ' + JSON.stringify(msgs.slice(-3))); await new Promise((r) => setTimeout(r, 10)); } };
  const view = () => [...msgs].reverse().map((m) => ('view' in m ? m.view : null)).find(Boolean) as RoomView;
  const quiet = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  return { s, open, send, until, view, msgs, quiet, close: () => s.close() };
}
export async function wsReady(h: Harness, cookie?: string) { const c = ws(h, cookie); await c.open; return c; }
