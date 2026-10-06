import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app';
import { Store } from './store';

const PORT = Number(process.env.PORT ?? 8787);
const DB = process.env.DATABASE_PATH ?? join(process.cwd(), 'data', 'boardverse.db');
if (DB !== ':memory:') mkdirSync(dirname(DB), { recursive: true });
const app = createApp(new Store(DB), { dist: join(process.cwd(), 'dist') });
setInterval(() => app.tick(), 500).unref();
app.server.listen(PORT, () => console.log(`Boardverse listening on :${PORT} (db: ${DB})`));
