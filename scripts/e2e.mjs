// Smoke test: needs `npm run preview` (port 4173) and a Chromium at $CHROMIUM or /opt/pw-browsers/chromium.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
for (const [name, vp] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 375, height: 700 }]]) {
  const p = await b.newPage({ viewport: vp });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/');
  await p.getByRole('button', { name: '친구와 하기 (같은 기기)' }).first().click();
  await p.getByRole('button', { name: '시작' }).click();
  await p.getByLabel(/^e2 /).click(); await p.getByLabel(/^e4/).click();
  assert(await p.getByRole('status').textContent().then((t) => t.includes('흑 차례')), `${name}: turn passes`);
  const box = await p.getByRole('grid', { name: '체스판' }).boundingBox();
  assert(box.x >= 0 && box.x + box.width <= vp.width, `${name}: chess board fits`);
  await p.getByRole('button', { name: '나가기' }).click();
  await p.getByRole('button', { name: '친구와 하기 (같은 기기)' }).nth(1).click();
  await p.getByRole('button', { name: '시작' }).click();
  const g = await p.getByRole('grid', { name: '오목판' }).boundingBox();
  assert(g.x >= 0 && g.x + g.width <= vp.width, `${name}: gomoku board fits`);
  // black wins on row 1, white plays row 3
  for (let i = 1; i <= 5; i++) { await p.getByLabel(`${i}열 1행 빈 칸`, { exact: true }).click(); if (i < 5) await p.getByLabel(`${i}열 3행 빈 칸`, { exact: true }).click(); }
  await p.getByRole('alertdialog').waitFor();
  assert((await p.getByRole('alertdialog').textContent()).includes('흑 승리'));
  await p.getByRole('button', { name: '홈으로' }).click();
  assert((await p.content()).includes('오목 · 2인'), `${name}: history saved`);
  assert.equal(errs.length, 0, errs.join());
  console.log(name, 'ok');
}
await b.close();
