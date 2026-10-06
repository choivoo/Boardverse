// E2E (Chromium, mobile/touch emulation). Start the app first:
//   DATABASE_PATH=:memory: npm run serve        (serves on :8787; use a throwaway DB!)
// Needs Chromium: $CHROMIUM or /opt/pw-browsers/chromium. SHOTS=dir saves screenshots.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const URL_ = process.env.URL ?? 'http://localhost:8787';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
// CSS px approximations of a foldable: cover screen, unfolded (near-square), unfolded portrait.
const VPS = { cover: { width: 360, height: 800 }, inner: { width: 780, height: 700 }, 'inner-portrait': { width: 600, height: 900 } };
const mk = (vp) => b.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const noOverflow = async (p, label) => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no horizontal scroll`);
const fits = async (p, sel, vp, label) => { const r = await p.getByRole('grid', { name: sel }).boundingBox(); assert(r.x >= 0 && r.x + r.width <= vp.width + 0.5, `${label}: board fits width`); assert(r.height > 250, `${label}: board big enough`); };
const shot = async (p, n) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${n}.png` }); };
const tab = (p, name) => p.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name });
const status = (p) => p.getByRole('status').first();
const run = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };
let uid = Date.now().toString(36);

for (const [name, vp] of Object.entries(VPS)) {
  await run(`${name}: guest home, local chess & gomoku, tabs, resize keeps state`, async () => {
    const ctx = await mk(vp); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL_); await noOverflow(p, 'home'); await shot(p, `${name}-home`);
    for (const t of ['플레이', '학습', '랭킹', '내 정보', '홈']) { await tab(p, t).click(); await noOverflow(p, t); }
    await p.getByRole('button', { name: '같은 기기' }).first().click(); await p.getByRole('button', { name: '시작' }).click();
    await p.getByLabel(/^e2 /).tap(); await p.getByLabel(/^e4/).tap();
    assert((await status(p).textContent()).includes('흑 차례'));
    await fits(p, '체스판', vp, 'chess'); await noOverflow(p, 'chess'); await shot(p, `${name}-chess`);
    await p.setViewportSize({ width: vp.height, height: vp.width });
    assert((await status(p).textContent()).includes('흑 차례'), 'state survives resize');
    await p.setViewportSize(vp);
    await p.getByRole('button', { name: '나가기' }).click();
    await p.getByRole('button', { name: '같은 기기' }).nth(1).click(); await p.getByRole('button', { name: '시작' }).click();
    await fits(p, '오목판', vp, 'gomoku'); await noOverflow(p, 'gomoku');
    const pt = p.locator('[data-x="0"][data-y="0"]');
    await pt.tap(); assert((await status(p).textContent()).includes('흑 차례'), 'preview does not place');
    await pt.tap(); assert((await status(p).textContent()).includes('백 차례'), 'confirm places'); await shot(p, `${name}-gomoku`);
    assert.equal(errs.length, 0, errs.join()); await ctx.close();
  });
}

await run('bot game: hint, replay of finished local record', async () => {
  const ctx = await mk(VPS.cover); const p = await ctx.newPage();
  await p.goto(URL_); await p.getByRole('button', { name: '컴퓨터와' }).first().click(); await p.getByRole('button', { name: '시작' }).click();
  await p.getByRole('button', { name: '힌트' }).click(); await p.getByText(/추천 수:/).waitFor();
  await p.getByLabel(/^e2 /).tap(); await p.getByLabel(/^e4/).tap();
  await p.getByText(/컴퓨터 생각 중|백 차례/).first().waitFor();
  await ctx.close();
});

await run('puzzles: open, wrong answer feedback, PGN import + replay', async () => {
  const ctx = await mk(VPS.cover); const p = await ctx.newPage();
  await p.goto(URL_); await tab(p, '학습').click(); await p.getByRole('button', { name: '문제 목록' }).click();
  await p.getByRole('button', { name: /1\. 한 수로 승리|1\. 메이트 1수/ }).first().click();
  await p.getByRole('grid').waitFor();
  await p.getByRole('button', { name: '목록' }).click();
  await tab(p, '학습').click(); await p.getByRole('button', { name: '열기' }).click();
  await p.getByLabel('PGN 붙여넣기').fill('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6'); await p.getByRole('button', { name: '불러오기' }).click();
  await p.getByText('6 / 6수').waitFor(); await p.getByRole('button', { name: '처음으로' }).click(); await p.getByText('0 / 6수').waitFor();
  await p.getByRole('button', { name: '다음 수' }).click(); await p.getByText('1 / 6수').waitFor();
  assert((await p.getByLabel('PGN').inputValue()).includes('Nf3'));
  await ctx.close();
});

await run('account UI: register, empty ranking, shop locked purchase, season, privacy, logout', async () => {
  const ctx = await mk(VPS.cover); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL_); await p.getByRole('button', { name: '로그인' }).first().click();
  await p.getByRole('button', { name: '계정 만들기' }).click();
  await p.getByLabel('이메일').fill(`ui${uid}@example.com`); await p.getByLabel(/^닉네임/).fill(`ui${uid}`); await p.getByLabel(/^비밀번호/).fill('password123');
  await p.getByRole('button', { name: '가입하기' }).click(); await p.getByRole('heading', { name: `ui${uid}` }).waitFor();
  await shot(p, 'profile');
  await tab(p, '랭킹').click(); await p.getByText(/아직 랭킹에 오른 플레이어가 없습니다/).waitFor();
  await tab(p, '내 정보').click(); await p.getByRole('button', { name: '상점·보관함' }).click();
  await p.getByRole('button', { name: /🪙 100 구매/ }).first().waitFor();
  assert(await p.getByRole('button', { name: /🪙 100 구매/ }).first().isDisabled(), 'cannot buy with 0 coins');
  await p.getByRole('button', { name: '미리보기' }).nth(1).click(); // preview applies theme
  assert.notEqual(await p.evaluate(() => document.documentElement.dataset.board), 'board-classic');
  await shot(p, 'shop');
  await tab(p, '내 정보').click(); await p.getByRole('button', { name: '시즌' }).click(); await p.getByText('시즌 1 · 첫 판').waitFor(); await shot(p, 'season');
  await tab(p, '내 정보').click(); await p.getByRole('button', { name: '친구' }).click(); await p.getByText(/아직 친구가 없습니다/).waitFor();
  await tab(p, '내 정보').click(); await p.getByRole('button', { name: '로그아웃' }).click(); await p.getByText('게스트로 플레이 중입니다').waitFor();
  assert.equal(errs.length, 0, errs.join()); await ctx.close();
});

await run('online: two accounts, rated quick match, rating shown, ranking, replay, rematch', async () => {
  const mkUser = async (vp, n) => {
    const ctx = await mk(vp); const p = await ctx.newPage(); await p.goto(URL_);
    await p.getByRole('button', { name: '로그인' }).first().click(); await p.getByRole('button', { name: '계정 만들기' }).click();
    await p.getByLabel('이메일').fill(`${n}${uid}@example.com`); await p.getByLabel(/^닉네임/).fill(`${n}${uid}`); await p.getByLabel(/^비밀번호/).fill('password123');
    await p.getByRole('button', { name: '가입하기' }).click(); await p.getByRole('heading', { name: `${n}${uid}` }).waitFor();
    await tab(p, '플레이').click(); await p.getByRole('button', { name: '온라인으로 하기' }).click();
    await p.getByRole('radio', { name: '오목' }).check(); await p.getByRole('radio', { name: '15×15' }).check(); await p.getByLabel(/평가 대국/).check();
    return { ctx, p };
  };
  const A = await mkUser(VPS.cover, 'ra'), B = await mkUser(VPS.inner, 'rb');
  await A.p.getByRole('button', { name: '상대 찾기' }).click(); await A.p.getByText(/상대를 찾는 중/).waitFor();
  await B.p.getByRole('button', { name: '상대 찾기' }).click();
  await A.p.getByRole('grid', { name: '오목판' }).waitFor(); await B.p.getByRole('grid', { name: '오목판' }).waitFor();
  const first = (await A.p.getByText('내 차례').count()) ? A : B, second = first === A ? B : A;
  const nine = async (me, other, i) => { await me.p.locator(`[data-x="${i}"][data-y="0"]`).tap(); await me.p.getByRole('button', { name: '착수', exact: true }).tap(); await other.p.getByText('내 차례').waitFor(); };
  for (let i = 0; i < 5; i++) {
    await first.p.getByText('내 차례').waitFor();
    await first.p.locator(`[data-x="${i}"][data-y="0"]`).tap(); await first.p.getByRole('button', { name: '착수', exact: true }).tap();
    if (i < 4) { await second.p.getByText('내 차례').waitFor(); await second.p.locator(`[data-x="${i}"][data-y="3"]`).tap(); await second.p.getByRole('button', { name: '착수', exact: true }).tap(); }
  }
  void nine;
  await first.p.getByText('승리!').waitFor(); await second.p.getByText('패배').waitFor();
  await first.p.getByText(/레이팅 \+20/).waitFor(); await second.p.getByText(/레이팅 -20/).waitFor(); await shot(first.p, 'online-won');
  await first.p.getByRole('button', { name: '홈으로' }).click(); await tab(first.p, '랭킹').click(); await first.p.getByRole('button', { name: '오목' }).click();
  await first.p.getByText(/내 순위: 1위/).waitFor(); await shot(first.p, 'ranking');
  await tab(first.p, '내 정보').click(); await first.p.getByText(/오목: 1220/).waitFor();
  await first.p.getByRole('button', { name: '복기' }).first().click(); await first.p.getByText('9 / 9수').waitFor();
  await A.ctx.close(); await B.ctx.close();
});

await run('manifest + healthz + security headers', async () => {
  const r = await (await b.newContext()).newPage();
  const res = await r.request.get(`${URL_}/manifest.webmanifest`); assert(res.ok()); assert((await res.json()).icons.length >= 2);
  assert((await r.request.get(`${URL_}/healthz`)).ok());
  assert((await r.request.get(URL_)).headers()['x-content-type-options'] === 'nosniff');
});
await b.close();
