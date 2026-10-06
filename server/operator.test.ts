import { describe, it, expect } from 'vitest';
import { harness, account, wsReady } from './testkit';

const TOKEN = 'operator-secret-0123456789abcdef';
const post = (h: { base: string }, body: unknown, auth?: string) => fetch(`${h.base}/api/operator/verify-email`, { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });

describe('operator verify-email endpoint', () => {
  it('does not exist unless a long OPERATOR_TOKEN is configured', async () => {
    const h = await harness({}); expect((await post(h, { email: 'a@x.com' }, 'Bearer anything')).status).toBe(404);
    const short = await harness({ OPERATOR_TOKEN: 'short' }); expect((await post(short, { email: 'a@x.com' }, 'Bearer short')).status).toBe(404);
    await h.close(); await short.close();
  });
  it('requires the exact secret, verifies the account, enables admin and leaves an audit entry', async () => {
    const h = await harness({ OPERATOR_TOKEN: TOKEN });
    const boss = await account(h, 'bosso', 'boss@x.com');
    expect((await boss.call('/api/admin/audit')).status).toBe(403); // admin email but not verified
    expect((await post(h, { email: 'boss@x.com' })).status).toBe(401);
    expect((await post(h, { email: 'boss@x.com' }, 'Bearer ' + TOKEN.slice(0, -1) + 'X')).status).toBe(401);
    expect((await post(h, { email: 'nobody@x.com' }, 'Bearer ' + TOKEN)).status).toBe(404);
    expect((await post(h, { email: 'boss@x.com' }, 'Bearer ' + TOKEN)).status).toBe(200);
    expect((await boss.call('/api/me')).json.user.emailVerified).toBe(true);
    const log = (await boss.call('/api/admin/audit')).json.log; expect(log.map((l: any) => l.action)).toContain('operator_verify_email');
    expect((await fetch(`${h.base}/api/operator/verify-email`, { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, origin: 'https://evil.example' }, body: '{}' })).status).toBe(403); // browsers can't be driven cross-site
    await h.close();
  });
  it('keep-alive ping is accepted silently', async () => {
    const h = await harness({}); const c = await wsReady(h); c.send({ t: 'ping' }); await c.quiet(); expect(c.msgs).toHaveLength(0); c.close(); await h.close();
  });
});
