// Restart-recovery E2E: starts its OWN server (file DB in a temp dir, port 8799), plays a game in two browsers,
// kills the server (SIGTERM) and starts it again on the same DB, and checks both clients resume the same game.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const PORT = 8799, URL_ = `http://localhost:${PORT}`, DB = join(mkdtempSync(join(tmpdir(), 'bv-e2e-')), 'e2e.db');
let srv;
const start = async () => {
  srv = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${URL_}/healthz`)).ok) return () => out; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('server did not start: ' + out);
};
const stop = () => new Promise((r) => { srv.once('exit', r); srv.kill('SIGTERM'); });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const vp = { width: 780, height: 700 }; let ok = false;
try {
  let log = await start();
  const uid = Date.now().toString(36);
  const mkUser = async (n) => {
    const ctx = await b.newContext({ viewport: vp, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
    await p.goto(URL_); await p.getByRole('button', { name: '로그인' }).first().click(); await p.getByRole('button', { name: '계정 만들기' }).click();
    await p.getByLabel('이메일').fill(`${n}${uid}@example.com`); await p.getByLabel(/^닉네임/).fill(`${n}${uid}`); await p.getByLabel(/^비밀번호/).fill('password123');
    await p.getByRole('button', { name: '가입하기' }).click(); await p.getByRole('heading', { name: `${n}${uid}` }).waitFor();
    await p.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '플레이' }).click(); await p.getByRole('button', { name: '온라인으로 하기' }).click();
    return { ctx, p };
  };
  const A = await mkUser('ra'), B = await mkUser('rb');
  await A.p.getByRole('radio', { name: '오목' }).check(); await A.p.getByRole('radio', { name: '15×15' }).check(); await A.p.getByRole('radio', { name: '흑(선공)' }).check();
  await A.p.getByRole('button', { name: '방 만들기' }).click(); const code = (await A.p.locator('.code').textContent()).trim();
  await B.p.getByLabel(/^방 코드로 입장/).fill(code); await B.p.getByRole('button', { name: '입장' }).click();
  await A.p.getByText('내 차례').waitFor(); await B.p.getByText('rb' + uid).first().waitFor();
  const tapMove = async (u, x, y) => { await u.p.locator(`[data-x="${x}"][data-y="${y}"]`).tap(); await u.p.getByRole('button', { name: '착수', exact: true }).tap(); };
  await tapMove(A, 7, 7); await B.p.getByText('내 차례').waitFor();
  await tapMove(B, 8, 8); await A.p.getByText('내 차례').waitFor();

  // ---- offline blip: the banner appears, then the client comes back by itself ----
  await B.ctx.setOffline(true); await B.p.getByText(/연결이 끊겼습니다/).waitFor({ timeout: 20000 }); await B.ctx.setOffline(false);
  await B.p.getByText(/연결이 끊겼습니다/).waitFor({ state: 'detached', timeout: 30000 });
  console.log('ok   offline blip -> auto reconnect');

  // ---- server restart in the middle of the game ----
  await stop(); console.log('     server stopped:', log().includes('SIGTERM') ? 'graceful' : 'unknown');
  await A.p.getByText(/연결이 끊겼습니다/).waitFor({ timeout: 20000 });
  log = await start();
  await A.p.getByText(/서버가 재시작되었습니다/).waitFor({ timeout: 40000 }); await B.p.getByText(/서버가 재시작되었습니다/).waitFor({ timeout: 40000 });
  assert.equal(await A.p.locator('.stone').count(), 2, 'both stones are still on the board after the restart'); assert.ok(log().includes('restored 1 unfinished room'));
  await A.p.getByText('내 차례').waitFor(); // black (A) is to move again, same as before the restart
  await tapMove(A, 6, 6); await B.p.getByText('내 차례').waitFor(); assert.equal(await B.p.locator('.stone').count(), 3);
  console.log('ok   server restart -> both clients resumed the same game and can keep playing');

  // ---- a finished game is NOT resurrected by a later restart ----
  await B.p.once('dialog', (d) => d.accept()); await B.p.getByRole('button', { name: '기권' }).click(); await A.p.getByText('승리!').waitFor();
  await stop(); log = await start();
  const r = await (await fetch(`${URL_}/healthz`)).text(); assert.equal(r, 'ok'); assert.ok(!log().includes('restored'), 'nothing to restore after a finished game');
  console.log('ok   finished game stays finished across a restart');
  ok = true; await A.ctx.close(); await B.ctx.close();
} catch (e) { console.log('FAIL', e.message); process.exitCode = 1; }
finally { try { await stop(); } catch { /* already down */ } await b.close(); }
console.log(ok ? 'restart e2e ok' : 'restart e2e FAILED');
