import { describe, it, expect, vi } from 'vitest';
import { createMailer, validateMailEnv } from './mail';
import { harness, account } from './testkit';

describe('mail configuration', () => {
  it('half-configured SMTP is rejected at startup', () => {
    expect(validateMailEnv({})).toBeNull();
    expect(validateMailEnv({ SMTP_URL: 'not a url', PUBLIC_URL: 'https://x.io' })).toMatch(/not a valid URL/);
    expect(validateMailEnv({ SMTP_URL: 'http://smtp.x.io', PUBLIC_URL: 'https://x.io' })).toMatch(/smtp/);
    expect(validateMailEnv({ SMTP_URL: 'smtps://u:p@smtp.x.io:465' })).toMatch(/PUBLIC_URL/);
    expect(validateMailEnv({ SMTP_URL: 'smtps://u:p@smtp.x.io:465', PUBLIC_URL: 'nope' })).toMatch(/PUBLIC_URL/);
    expect(validateMailEnv({ SMTP_URL: 'smtps://u:p@smtp.x.io:465', PUBLIC_URL: 'https://x.io' })).toBeNull();
    expect(() => createMailer({ SMTP_URL: 'smtps://u:p@smtp.x.io:465' })).toThrow(/PUBLIC_URL/);
  });
  it('modes are distinct: dev outbox only without SMTP and outside production; production without SMTP is OFF', () => {
    expect(createMailer({})).toMatchObject({ enabled: true, dev: true });
    expect(createMailer({ NODE_ENV: 'production' })).toMatchObject({ enabled: false, dev: false });
    const fake = { sendMail: async () => {} } as any;
    const real = createMailer({}, fake); expect(real).toMatchObject({ enabled: true, dev: false }); expect(real.outbox).toHaveLength(0);
  });
  it('transport errors are reduced to a code so credentials cannot leak into logs', async () => {
    const m = createMailer({}, { sendMail: async () => { throw Object.assign(new Error('connect failed smtps://user:SECRETPASS@host'), { code: 'ECONNECTION' }); } } as any);
    const err = (await m.send('a@x.com', 's', 't').catch((e) => e)) as Error;
    expect(err.message).toBe('mail delivery failed (ECONNECTION)'); expect(err.message).not.toContain('SECRETPASS');
  });
});

describe('mail failures leave no usable state and leak nothing', () => {
  it('failed verification/reset mail revokes the token, keeps responses uniform, logs no secrets', async () => {
    const logs: string[] = [];
    const spies = (['log', 'error', 'warn'] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); }));
    const failing = createMailer({}, { sendMail: async () => { throw Object.assign(new Error('boom smtps://u:SECRETPASS@h'), { code: 'EAUTH' }); } } as any);
    const h = await harness({}, undefined, failing);
    const u = await account(h, 'mailfail'); // registration itself must still work
    await new Promise((r) => setTimeout(r, 30));
    expect(h.app.store.all('SELECT * FROM tokens')).toHaveLength(0); // registration mail failed -> token revoked
    const r = await u.call('/api/email/send-verification', 'POST', {}); expect(r.status).toBe(502);
    expect(h.app.store.all('SELECT * FROM tokens')).toHaveLength(0);
    expect((await u.call('/api/me')).json.user.emailVerified).toBe(false); // account state untouched
    const known = await fetch(`${h.base}/api/password/forgot`, { method: 'POST', body: JSON.stringify({ email: 'mailfail@x.com' }) });
    const unknown = await fetch(`${h.base}/api/password/forgot`, { method: 'POST', body: JSON.stringify({ email: 'ghost@x.com' }) });
    expect([known.status, await known.json()]).toEqual([unknown.status, await unknown.json()]);
    expect(h.app.store.all('SELECT * FROM tokens')).toHaveLength(0);
    const all = logs.join('\n'); expect(all).not.toContain('SECRETPASS'); expect(all).not.toMatch(/(verify|reset)=/); expect(all).not.toContain('mailfail@x.com');
    spies.forEach((s) => s.mockRestore()); await h.close();
  });
  it('successful mails are handed to the transport and never written to logs', async () => {
    const sent: any[] = []; const logs: string[] = [];
    const spies = (['log', 'error', 'warn'] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); }));
    const h = await harness({}, undefined, createMailer({}, { sendMail: async (o: any) => { sent.push(o); } } as any));
    const u = await account(h, 'mailok'); await new Promise((r) => setTimeout(r, 30));
    expect(sent.some((m) => m.to === 'mailok@x.com' && /verify=/.test(m.text))).toBe(true);
    await fetch(`${h.base}/api/password/forgot`, { method: 'POST', body: JSON.stringify({ email: 'mailok@x.com' }) });
    expect(sent.some((m) => /reset=/.test(m.text))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/(verify|reset)=/); void u;
    spies.forEach((s) => s.mockRestore()); await h.close();
  });
});
