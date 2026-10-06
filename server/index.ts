import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app';
import { Store } from './store';

if (process.env.SMTP_URL && !process.env.PUBLIC_URL) { console.error('SMTP_URL is set but PUBLIC_URL is not: email links would be unusable. Set PUBLIC_URL=https://your.domain'); process.exit(1); }
const PORT = Number(process.env.PORT ?? 8787);
const DB = process.env.DATABASE_PATH ?? join(process.cwd(), 'data', 'boardverse.db');
if (DB !== ':memory:') mkdirSync(dirname(DB), { recursive: true });
const app = createApp(new Store(DB), { dist: join(process.cwd(), 'dist') });
setInterval(() => app.tick(), 500).unref();
setInterval(() => app.store.purgeExpired(), 3600_000).unref();
let closing = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { if (closing) return; closing = true; console.log(`${sig}: shutting down (in-progress games are not persisted)`); app.close().then(() => process.exit(0), () => process.exit(1)); });
app.server.listen(PORT, () => console.log(`Boardverse listening on :${PORT} (db: ${DB})`));
