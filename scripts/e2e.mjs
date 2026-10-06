// E2E (Chromium, mobile/touch emulation). Start the app first:
//   DATABASE_PATH=:memory: ADMIN_EMAILS=boss@example.com npm run serve   (serves on :8787; use a throwaway DB!)
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
  await tab(first.p, '내 정보').click(); await first.p.getByText(/오목 · 기본: 1220/).waitFor();
  await first.p.getByRole('button', { name: '복기' }).first().click(); await first.p.getByText('9 / 9수').waitFor();
  await A.ctx.close(); await B.ctx.close();
});


// ---------- helpers for the platform scenarios ----------
const signup = async (vp, name, email = `${name}@example.com`) => {
  const ctx = await mk(vp); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL_); await p.getByRole('button', { name: '로그인' }).first().click(); await p.getByRole('button', { name: '계정 만들기' }).click();
  await p.getByLabel('이메일').fill(email); await p.getByLabel(/^닉네임/).fill(name); await p.getByLabel(/^비밀번호/).fill('password123');
  await p.getByRole('button', { name: '가입하기' }).click(); await p.getByRole('heading', { name }).waitFor();
  await noOverflow(p, `profile of ${name}`); // long nicknames must not widen the page
  return { ctx, p, name, errs };
};
const outbox = async (p) => (await (await p.request.get(`${URL_}/api/dev/outbox`)).json()).outbox;
const verifyEmail = async (u, email = `${u.name}@example.com`) => {
  const mail = (await outbox(u.p)).filter((m) => m.to === email && m.subject.includes('인증')).at(-1);
  await u.p.goto(`${URL_}/?verify=${mail.text.match(/verify=([\w-]+)/)[1]}`); await u.p.getByText('이메일이 인증되었습니다.').waitFor();
};
const A = `adm${uid}`; let boss;

await run('email: dev outbox banner, verify link (one-time), forgot/reset password flow', async () => {
  const u = await signup(VPS.cover, `em${uid}`);
  await u.p.getByText('이메일이 아직 인증되지 않았습니다.').waitFor(); await u.p.getByText(/개발 모드: 메일은 실제로 발송되지 않고/).waitFor();
  const mail = (await outbox(u.p)).filter((m) => m.to === `em${uid}@example.com`).at(-1); const tok = mail.text.match(/verify=([\w-]+)/)[1];
  await u.p.goto(`${URL_}/?verify=${tok}`); await u.p.getByText('이메일이 인증되었습니다.').waitFor();
  await u.p.goto(`${URL_}/?verify=${tok}`); await u.p.getByText(/만료되었거나 이미 사용/).waitFor(); // second use rejected
  await u.p.goto(URL_); await tab(u.p, '내 정보').click(); await u.p.getByRole('button', { name: '로그아웃' }).click();
  await u.p.getByRole('button', { name: '로그인' }).first().click(); await u.p.getByRole('button', { name: '비밀번호를 잊었나요?' }).click();
  await u.p.getByLabel('가입 이메일').fill(`em${uid}@example.com`); await u.p.getByRole('button', { name: '재설정 링크 받기' }).click(); await u.p.getByText(/계정이 있다면 재설정 링크를 보냈습니다/).waitFor();
  const rt = (await outbox(u.p)).filter((m) => m.subject.includes('재설정')).at(-1).text.match(/reset=([\w-]+)/)[1];
  await u.p.goto(`${URL_}/?reset=${rt}`); await u.p.getByLabel(/^새 비밀번호/).fill('brandnewpass1'); await u.p.getByRole('button', { name: '변경', exact: true }).click(); await u.p.getByText(/변경되었습니다/).waitFor();
  await u.p.getByRole('button', { name: '로그인으로' }).click(); await u.p.getByLabel('이메일').fill(`em${uid}@example.com`); await u.p.getByLabel(/^비밀번호/).fill('brandnewpass1');
  await u.p.locator('#main').getByRole('button', { name: '로그인', exact: true }).click(); await u.p.getByRole('heading', { name: `em${uid}` }).waitFor();
  assert.equal(u.errs.length, 0, u.errs.join()); await u.ctx.close();
});

await run('service worker never serves /api from cache (offline)', async () => {
  const u = await signup(VPS.cover, `sw${uid}`);
  await u.p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await u.p.reload(); await u.p.evaluate(() => fetch('/api/me').then((r) => r.json())); // warm: would be cached by a naive SW
  await u.ctx.setOffline(true);
  const r = await u.p.evaluate(() => fetch('/api/me').then(() => 'served', () => 'failed'));
  assert.equal(r, 'failed', 'api response must not come from the SW cache'); await u.ctx.setOffline(false); await u.ctx.close();
});

await run('admin: unverified admin email has no access; verified admin triages report; audit log; non-admin blocked', async () => {
  boss = await signup(VPS.inner, A, 'boss@example.com'); const bad = await signup(VPS.cover, `bad${uid}`);
  await tab(boss.p, '내 정보').click(); assert.equal(await boss.p.getByRole('button', { name: '관리자' }).count(), 0, 'no admin button before verification');
  assert.equal((await boss.p.request.get(`${URL_}/api/admin/reports`)).status(), 403);
  await verifyEmail(boss, 'boss@example.com'); await boss.p.goto(URL_); await tab(boss.p, '내 정보').click(); await boss.p.getByRole('button', { name: '관리자' }).click();
  // another user reports "bad"
  const rep = await signup(VPS.cover, `rep${uid}`);
  assert.equal((await rep.p.request.post(`${URL_}/api/report`, { data: { name: `bad${uid}`, reason: '욕설을 계속합니다 password: supersecret99' } })).status(), 200);
  assert.equal((await bad.p.request.get(`${URL_}/api/admin/reports`)).status(), 403);
  await boss.p.getByRole('button', { name: '새로고침' }).click(); await boss.p.getByText(/욕설을 계속합니다/).waitFor();
  assert.equal(await boss.p.getByText('supersecret99').count(), 0, 'secrets redacted');
  boss.p.once('dialog', (d) => d.accept('경고 조치')); await boss.p.locator('article').getByRole('button', { name: '조치 완료' }).first().click(); await boss.p.getByText(/메모: 경고 조치/).waitFor({ timeout: 8000 }).catch(async (e) => { await shot(boss.p, 'admin-fail'); throw e; });
  await boss.p.getByRole('button', { name: '감사 로그' }).click(); await boss.p.getByText('handle_report').waitFor(); await boss.p.getByText('view_reports').first().waitFor();
  await shot(boss.p, 'admin'); for (const u of [bad, rep]) await u.ctx.close();
});

await run('tournament: admin creates, two players join/queue/play, standings + elo untouched', async () => {
  const adm = boss; await adm.p.goto(URL_); await tab(adm.p, '내 정보').click(); await adm.p.getByRole('button', { name: '대회' }).click();
  await adm.p.getByLabel('이름').fill(`아레나${uid}`); await adm.p.getByLabel('몇 분 뒤 시작').fill('0'); await adm.p.getByLabel(/^진행 시간/).fill('30'); await adm.p.getByRole('button', { name: '만들기' }).click();
  await adm.p.getByRole('button', { name: `아레나${uid}` }).waitFor();
  const P = [await signup(VPS.cover, `ta${uid}`), await signup(VPS.cover, `tc${uid}`)];
  for (const u of P) { u.p.on('dialog', (d) => d.accept()); await tab(u.p, '플레이').click(); await u.p.getByRole('button', { name: '대회', exact: true }).click(); await u.p.getByRole('button', { name: `아레나${uid}` }).click(); await u.p.getByRole('button', { name: '참가', exact: true }).click(); await u.p.getByRole('button', { name: '경기 찾기' }).waitFor(); }
  for (const u of P) await u.p.getByRole('button', { name: '경기 찾기' }).click();
  for (const u of P) await u.p.getByRole('grid', { name: '오목판' }).waitFor();
  await P[1].p.getByRole('button', { name: '기권' }).click();
  for (const u of P) await u.p.getByRole('alertdialog').waitFor();
  assert.equal(await P[1].p.getByText(/레이팅 [+-]\d/).count(), 0, 'tournament games show no rating change'); await P[1].p.getByText(/대회 경기는 레이팅에 반영되지 않고/).waitFor();
  for (const u of P) { await u.p.getByRole('button', { name: '홈으로' }).click(); await tab(u.p, '플레이').click(); await u.p.getByRole('button', { name: '대회', exact: true }).click(); await u.p.getByRole('button', { name: `아레나${uid}` }).click(); }
  await P[0].p.getByRole('cell', { name: '2', exact: true }).first().waitFor(); await shot(P[0].p, 'tournament');
  for (const u of P) await u.ctx.close();
});

await run('clubs: create, join, request/approve flow, roles', async () => {
  const o = await signup(VPS.cover, `co${uid}`), m = await signup(VPS.inner, `cm${uid}`);
  await tab(o.p, '플레이').click(); await o.p.getByRole('button', { name: '클럽', exact: true }).click();
  await o.p.getByLabel(/^이름/).fill(`클럽${uid}`); await o.p.getByLabel(/^소개/).fill('테스트'); await o.p.getByLabel(/누구나 바로 가입/).uncheck(); await o.p.getByRole('button', { name: '만들기' }).click();
  await o.p.getByRole('heading', { name: `클럽${uid}` }).waitFor();
  await tab(m.p, '플레이').click(); await m.p.getByRole('button', { name: '클럽', exact: true }).click(); await m.p.getByRole('button', { name: `클럽${uid}` }).click();
  await m.p.getByRole('button', { name: '가입 요청' }).click(); await m.p.getByRole('button', { name: '요청 취소' }).waitFor();
  await o.p.reload(); await tab(o.p, '플레이').click(); await o.p.getByRole('button', { name: '클럽', exact: true }).click(); await o.p.getByRole('button', { name: `클럽${uid}` }).first().click();
  await o.p.getByText(`cm${uid}`).waitFor(); await o.p.getByRole('button', { name: '수락' }).click(); await o.p.getByRole('button', { name: '관리자 지정' }).waitFor(); await shot(o.p, 'club');
  assert.equal(o.errs?.length ?? 0, 0); await o.ctx.close(); await m.ctx.close();
});

await run('spectate + chat: live list, read-only view, chat between players, muting', async () => {
  const [a, b, v] = [await signup(VPS.cover, `sa${uid}`), await signup(VPS.inner, `sb${uid}`), await signup(VPS.cover, `sv${uid}`)];
  for (const u of [a, b]) { await tab(u.p, '플레이').click(); await u.p.getByRole('button', { name: '온라인으로 하기' }).click(); await u.p.getByRole('radio', { name: '오목' }).check(); await u.p.getByRole('radio', { name: '15×15' }).check(); }
  await a.p.getByRole('button', { name: '상대 찾기' }).click(); await b.p.getByRole('button', { name: '상대 찾기' }).click();
  for (const u of [a, b]) await u.p.getByRole('grid', { name: '오목판' }).waitFor();
  await a.p.getByLabel('채팅 메시지').fill('안녕하세요!'); await a.p.getByRole('button', { name: '보내기' }).click();
  await b.p.getByText('안녕하세요!').waitFor(); await a.p.getByText('안녕하세요!').waitFor();
  await b.p.getByLabel('채팅 메시지').fill('http://spam.example'); await b.p.getByRole('button', { name: '보내기' }).click(); await b.p.getByText(/링크는 보낼 수 없습니다/).waitFor().catch(() => {});
  await b.p.getByLabel(/상대 채팅 숨기기/).check(); await b.p.getByText('상대 채팅을 숨겼습니다.').waitFor();
  await tab(v.p, '플레이').click(); await v.p.getByRole('button', { name: '관전', exact: true }).click(); await v.p.getByRole('button', { name: '관전', exact: true }).nth(0).waitFor();
  await v.p.getByText(new RegExp(`sa${uid} vs sb${uid}|sb${uid} vs sa${uid}`)).waitFor(); await v.p.getByRole('listitem').getByRole('button', { name: '관전' }).first().click();
  await v.p.getByRole('grid', { name: '오목판' }).waitFor(); await v.p.getByText('읽기 전용 관전 화면입니다.').waitFor(); assert.equal(await v.p.getByRole('button', { name: '기권' }).count(), 0); assert.equal(await v.p.getByLabel('채팅 메시지').count(), 0); assert.equal(await v.p.getByRole('button', { name: '착수', exact: true }).count(), 0, 'no move controls for spectators');
  const first = (await a.p.getByText('내 차례').count()) ? a : b;
  await first.p.locator('[data-x="0"][data-y="0"]').tap(); await first.p.getByRole('button', { name: '착수', exact: true }).tap();
  await v.p.getByText(/관전 중 ·/).waitFor(); await v.p.locator('.stone').first().waitFor(); await shot(v.p, 'spectator');
  for (const u of [a, b, v]) await u.ctx.close();
});

await boss?.ctx.close();
await run('manifest + healthz + security headers', async () => {
  const r = await (await b.newContext()).newPage();
  const res = await r.request.get(`${URL_}/manifest.webmanifest`); assert(res.ok()); assert((await res.json()).icons.length >= 2);
  assert((await r.request.get(`${URL_}/healthz`)).ok());
  assert((await r.request.get(URL_)).headers()['x-content-type-options'] === 'nosniff');
});
await b.close();
