// E2E smoke test. Start the app first:  npm run build && npm start   (serves on :8787)
// Needs Chromium: $CHROMIUM or /opt/pw-browsers/chromium. Set SHOTS=dir to save screenshots.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const URL_ = process.env.URL ?? 'http://localhost:8787';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
// CSS px approximations of a foldable: cover screen, unfolded (near-square), unfolded portrait.
const VPS = { cover: { width: 360, height: 800 }, inner: { width: 780, height: 700 }, 'inner-portrait': { width: 600, height: 900 } };
const mk = (vp) => b.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const same = (p) => p.getByRole('button', { name: '친구와 하기 (같은 기기)' });
const noOverflow = async (p, label) => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no horizontal scroll`);
const fits = async (p, sel, vp, label) => { const r = await p.getByRole('grid', { name: sel }).boundingBox(); assert(r.x >= 0 && r.x + r.width <= vp.width + 0.5, `${label}: board fits width`); assert(r.height > 250, `${label}: board big enough`); return r; };
const shot = async (p, n) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${n}.png` }); };

for (const [name, vp] of Object.entries(VPS)) {
  const ctx = await mk(vp); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL_); await noOverflow(p, `${name} home`); await shot(p, `${name}-home`);
  await same(p).first().click(); await p.getByRole('button', { name: '시작' }).click();
  await p.getByLabel(/^e2 /).tap(); await p.getByLabel(/^e4/).tap();
  assert((await p.getByRole('status').textContent()).includes('흑 차례'), `${name}: chess turn passes`);
  await fits(p, '체스판', vp, `${name} chess`); await noOverflow(p, `${name} chess`); await shot(p, `${name}-chess`);
  // rotate/resize like folding: state must survive
  await p.setViewportSize({ width: vp.height, height: vp.width });
  assert((await p.getByRole('status').textContent()).includes('흑 차례'), `${name}: state survives resize`);
  await p.setViewportSize(vp);
  await p.getByRole('button', { name: '나가기' }).click();
  await same(p).nth(1).click(); await p.getByRole('button', { name: '시작' }).click();
  await fits(p, '오목판', vp, `${name} gomoku`); await noOverflow(p, `${name} gomoku`);
  // touch mode: first tap previews, second confirms
  const pt = p.locator('[data-x="0"][data-y="0"]');
  await pt.tap(); assert((await p.getByRole('status').textContent()).includes('흑 차례'), `${name}: preview does not place`);
  await pt.tap(); assert((await p.getByRole('status').textContent()).includes('백 차례'), `${name}: confirm places`);
  await shot(p, `${name}-gomoku`);
  assert.equal(errs.length, 0, errs.join()); await ctx.close(); console.log(name, 'local ok');
}

// Online: two phones, create/join by code, server-validated play, resign, reconnect.
{
  const c1 = await mk(VPS.cover), c2 = await mk(VPS.inner); const a = await c1.newPage(), z = await c2.newPage();
  await a.goto(URL_); await a.getByRole('button', { name: '온라인으로 하기' }).click();
  await a.getByLabel('닉네임').fill('민수'); await a.getByRole('radio', { name: '오목' }).check(); await a.getByRole('radio', { name: '흑(선공)' }).check();
  await a.getByRole('button', { name: '방 만들기' }).click();
  const code = (await a.locator('.code').textContent()).trim(); assert.match(code, /^[A-Z2-9]{5}$/);
  await z.goto(`${URL_}/?room=${code}`); await z.getByLabel('닉네임').fill('지아'); await z.getByRole('button', { name: '입장' }).click();
  await a.getByText('내 차례').waitFor(); await z.getByText('민수 차례').waitFor();
  await a.getByLabel('1열 1행 빈 칸', { exact: true }).tap(); await a.getByRole('button', { name: '착수', exact: true }).tap();
  await z.getByText('내 차례').waitFor();
  await a.reload(); await a.getByText('지아 차례').waitFor(); // resumes saved session after reload
  await z.getByRole('button', { name: '기권' }).click();
  await a.getByRole('alertdialog').getByText('승리!').waitFor(); await z.getByRole('alertdialog').getByText('패배').waitFor();
  await shot(a, 'online-over');
  await c1.close(); await c2.close(); console.log('online ok');
}
const r = await (await b.newContext()).newPage(); const res = await r.request.get(`${URL_}/manifest.webmanifest`); assert(res.ok()); assert((await res.json()).icons.length >= 2);
await b.close(); console.log('all ok');
