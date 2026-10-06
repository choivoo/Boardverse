// Post-deploy / local smoke test for the Cloudflare build (production behaviour).
//   node scripts/cf-smoke.mjs <base-url>            e.g. http://localhost:8788 (wrangler dev) or https://boardverse.<you>.workers.dev
// Optional env: OPERATOR_TOKEN (also tests the operator endpoint).  Creates ONE throw-away guest-style account named smoke<random>.
import assert from 'node:assert/strict';
import WebSocketLib from 'ws';
const base = (process.argv[2] ?? '').replace(/\/$/, ''); if (!base) { console.error('usage: cf-smoke.mjs <base-url>'); process.exit(2); }
const ws = base.replace(/^http/, 'ws'); const results = []; let failed = 0;
const check = async (name, fn) => { try { await fn(); results.push(`ok   ${name}`); } catch (e) { failed++; results.push(`FAIL ${name}: ${e.message}`); } };
const get = (p, h = {}) => fetch(base + p, { headers: h, redirect: 'manual' });

await check('healthz returns exactly "ok" and leaks nothing', async () => { const r = await get('/healthz'); assert.equal(r.status, 200); assert.equal(await r.text(), 'ok'); });
await check('static app + SPA fallback (deep link and ?room=)', async () => {
  for (const p of ['/', '/?room=ABCDE', '/some/deep/link']) { const r = await get(p, { 'sec-fetch-mode': 'navigate', accept: 'text/html' }); assert.equal(r.status, 200, p); assert.match(await r.text(), /<div id="root">/, p); }
});
await check('security headers on pages and API', async () => {
  for (const p of ['/', '/api/config']) { const r = await get(p); assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p); assert.match(r.headers.get('content-security-policy') ?? '', /script-src 'self' 'wasm-unsafe-eval'/, p); assert.equal(r.headers.get('referrer-policy'), 'no-referrer', p); }
});
await check('engine files + licence notices are served', async () => {
  const w = await get('/engine/stockfish-19-lite-single.wasm'); assert.equal(w.status, 200); assert.match(w.headers.get('content-type') ?? '', /wasm/); assert.ok((await w.arrayBuffer()).byteLength > 1_000_000);
  for (const f of ['COPYING.txt', 'NOTICES.md', 'SOURCE.txt']) assert.equal((await get('/engine/' + f)).status, 200, f);
});
await check('production mode: email features honestly OFF, dev outbox absent', async () => {
  const c = await (await get('/api/config')).json(); assert.deepEqual(c, { email: false, emailDev: false, emailRequiredForRated: false });
  assert.equal((await get('/api/dev/outbox')).status, 404);
  assert.equal((await fetch(base + '/api/password/forgot', { method: 'POST', body: '{"email":"a@b.co"}' })).status, 503);
});
await check('guests are anonymous; protected routes refuse; admin routes refuse', async () => {
  assert.equal((await (await get('/api/me')).json()).user, null);
  for (const p of ['/api/friends', '/api/admin/reports', '/api/admin/audit']) assert.ok([401, 403].includes((await get(p)).status), p);
});
await check('cross-site POST and cross-site WebSocket are refused', async () => {
  assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const status = await new Promise((res) => { const c = new WebSocketLib(ws + '/ws', { headers: { origin: 'https://evil.example' } }); c.on('unexpected-response', (_q, r) => res(r.statusCode)); c.on('open', () => res('opened')); c.on('error', () => {}); setTimeout(() => res('timeout'), 8000); });
  assert.equal(status, 403, 'cross-site WebSocket must be refused'); // the real site origin is allowed (see the realtime check)
});
await check('account lifecycle: register -> me -> rating list -> logout (cookie flags)', async () => {
  const n = 'smoke' + Math.random().toString(36).slice(2, 8);
  const r = await fetch(base + '/api/register', { method: 'POST', body: JSON.stringify({ email: `${n}@example.com`, name: n, password: 'smoke-password-1' }) }); assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie') ?? ''; assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); if (base.startsWith('https')) assert.match(sc, /Secure/);
  const cookie = sc.split(';')[0]; const me = await (await get('/api/me', { cookie })).json(); assert.equal(me.user.name, n);
  assert.equal((await fetch(base + '/api/logout', { method: 'POST', headers: { cookie }, body: '{}' })).status, 200); assert.equal((await (await get('/api/me', { cookie })).json()).user, null);
});
await check('realtime: create a room over WebSocket (guest), receive a room code, second socket joins, a legal move is accepted and an illegal one refused', async () => {
  const open = () => new Promise((res, rej) => { const s = new WebSocket(ws + '/ws'); const msgs = []; s.onmessage = (e) => msgs.push(JSON.parse(e.data)); s.onopen = () => res({ s, msgs }); s.onerror = () => rej(new Error('websocket failed')); });
  const until = async (c, f) => { for (let i = 0; i < 100; i++) { const m = c.msgs.find(f); if (m) return m; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };
  const a = await open(), b = await open();
  a.s.send(JSON.stringify({ t: 'create', game: 'chess', name: 'smokeA', side: 'w' })); const j = await until(a, (m) => m.t === 'joined'); assert.match(j.view.code, /^[A-Z2-9]{5}$/);
  b.s.send(JSON.stringify({ t: 'join', code: j.view.code, name: 'smokeB' })); await until(b, (m) => m.t === 'joined');
  b.s.send(JSON.stringify({ t: 'move', n: 0, from: 'e7', to: 'e5' })); await until(b, (m) => m.t === 'error'); // not black's turn
  a.s.send(JSON.stringify({ t: 'move', n: 0, from: 'e2', to: 'e5' })); await until(a, (m) => m.t === 'error'); // illegal
  a.s.send(JSON.stringify({ t: 'move', n: 0, from: 'e2', to: 'e4' })); await until(b, (m) => m.t === 'view' && m.view.n === 1);
  a.s.send(JSON.stringify({ t: 'resign' })); await until(b, (m) => m.t === 'view' && m.view.status === 'over'); a.s.close(); b.s.close();
});
if (process.env.OPERATOR_TOKEN) await check('operator endpoint: wrong token 401, unknown user 404', async () => {
  const call = (tok, email) => fetch(base + '/api/operator/verify-email', { method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: JSON.stringify({ email }) });
  assert.equal((await call('wrong-' + process.env.OPERATOR_TOKEN, 'x@y.zz')).status, 401); assert.equal((await call(process.env.OPERATOR_TOKEN, 'nobody-' + Date.now() + '@example.com')).status, 404);
});
console.log(results.join('\n')); console.log(failed ? `\n${failed} check(s) FAILED` : '\nall smoke checks passed'); process.exit(failed ? 1 : 0);
