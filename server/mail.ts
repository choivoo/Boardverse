import nodemailer, { type Transporter } from 'nodemailer';

export interface Mailer { enabled: boolean; /** true = no SMTP, messages only land in the in-memory dev outbox */ dev: boolean; from: string; outbox: { to: string; subject: string; text: string; at: number }[]; send(to: string, subject: string, text: string): Promise<void> }

/** SMTP_URL (e.g. smtps://user:pass@host:465) enables real delivery. Without it: development builds get an in-memory outbox
 *  (never persisted, only exposed when NODE_ENV!=production); production gets email features switched OFF. */
/** Fails fast on half-configured mail settings instead of silently running with broken email. */
export function validateMailEnv(env: Record<string, string | undefined>): string | null {
  if (!env.SMTP_URL) return null;
  let u: URL; try { u = new URL(env.SMTP_URL); } catch { return 'SMTP_URL is not a valid URL (expected smtp[s]://user:pass@host:port)'; }
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') return 'SMTP_URL must start with smtp:// or smtps://';
  if (!u.hostname) return 'SMTP_URL has no host';
  if (!env.PUBLIC_URL) return 'SMTP_URL is set but PUBLIC_URL is not: links in emails would be unusable';
  try { new URL(env.PUBLIC_URL); } catch { return 'PUBLIC_URL is not a valid URL'; }
  return null;
}

export function createMailer(env: Record<string, string | undefined> = process.env, transport?: Transporter): Mailer {
  const from = env.MAIL_FROM ?? 'Boardverse <no-reply@localhost>';
  const outbox: Mailer['outbox'] = [];
  const bad = transport ? null : validateMailEnv(env); if (bad) throw new Error(bad);
  if (transport || env.SMTP_URL) {
    const t = transport ?? nodemailer.createTransport(env.SMTP_URL!);
    return { enabled: true, dev: false, from, outbox, async send(to, subject, text) { try { await t.sendMail({ from, to, subject, text }); } catch (e) { throw new Error(`mail delivery failed (${(e as { code?: string }).code ?? 'unknown'})`); } } }; // never forward transport details: they can contain host/credentials
  }
  if (env.NODE_ENV !== 'production') {
    return { enabled: true, dev: true, from, outbox, async send(to, subject, text) { outbox.push({ to, subject, text, at: Date.now() }); if (outbox.length > 50) outbox.shift(); } };
  }
  return { enabled: false, dev: false, from, outbox, async send() { throw new Error('email disabled'); } };
}
