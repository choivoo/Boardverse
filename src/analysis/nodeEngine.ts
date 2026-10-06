// TEST-ONLY transport: runs the same Stockfish build as a child process (never imported by the browser bundle).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { UciEngine } from './analyze';
export function createNodeEngine(): UciEngine {
  const p = spawn(process.execPath, [join('node_modules', 'stockfish', 'bin', 'stockfish-19-lite-single.js')], { stdio: ['pipe', 'pipe', 'ignore'] });
  const subs: ((l: string) => void)[] = []; let buf = '';
  p.stdout.on('data', (d: Buffer) => { buf += d.toString(); const parts = buf.split('\n'); buf = parts.pop() ?? ''; for (const l of parts) subs.forEach((f) => f(l.trim())); });
  p.on('error', (e) => subs.forEach((f) => f(`__worker_error__ ${e.message}`)));
  return { send: (c) => { p.stdin.write(c + '\n'); }, onLine: (cb) => { subs.push(cb); }, terminate: () => { p.kill(); } };
}
