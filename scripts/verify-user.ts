// Operator tool: mark an account's email as verified directly in the database (for servers without SMTP).
// Usage: DATABASE_PATH=/data/boardverse.db npx tsx scripts/verify-user.ts someone@example.com
import { openStore } from '../server/nodedb';
const email = process.argv[2];
if (!email) { console.error('usage: verify-user.ts <email>'); process.exit(2); }
const s = openStore(process.env.DATABASE_PATH ?? 'data/boardverse.db');
const u = s.userByEmail(email);
if (!u) { console.error('no such user'); process.exit(1); }
s.markVerified(u.id as number); s.audit(null, 'operator_verify_email', String(u.id));
console.log(`verified ${u.name}`);
