import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app';
import { openStore } from './nodedb';
import { validateMailEnv } from './mail';

{ const bad = validateMailEnv(process.env); if (bad) { console.error(`Mail configuration error: ${bad}`); process.exit(1); } }
const PORT = Number(process.env.PORT ?? 8787);
const DB = process.env.DATABASE_PATH ?? join(process.cwd(), 'data', 'boardverse.db');
if (DB !== ':memory:') mkdirSync(dirname(DB), { recursive: true });
const app = createApp(openStore(DB), { dist: join(process.cwd(), 'dist') });
setInterval(() => app.tick(), 500).unref();
setInterval(() => app.store.purgeExpired(), 3600_000).unref();
let closing = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { if (closing) return; closing = true; console.log(`${sig}: shutting down (unfinished games are saved and restored on the next start)`); app.close().then(() => process.exit(0), () => process.exit(1)); });
app.server.listen(PORT, () => console.log(`Boardverse listening on :${PORT} (db: ${DB})`));
