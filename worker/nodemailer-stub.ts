// nodemailer needs raw TCP sockets, which Workers do not offer through node:net. The bundler aliases it to this stub.
// On Cloudflare the email features stay OFF (production without SMTP) until an HTTP mail provider is wired in.
export default { createTransport(): never { throw new Error('SMTP_URL is not supported on Cloudflare Workers; unset it (email features stay disabled) or add an HTTP mail provider'); } };
