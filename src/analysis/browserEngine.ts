import type { UciEngine } from './analyze';

/** Runs Stockfish (GPL-3.0, single-threaded WASM, see THIRD_PARTY_NOTICES.md) in a dedicated Web Worker on this device. */
export const ENGINE_URL = '/engine/stockfish-19-lite-single.js';
export function createBrowserEngine(url = ENGINE_URL): UciEngine {
  const w = new Worker(url); const subs: ((l: string) => void)[] = [];
  const emit = (l: string) => subs.forEach((f) => f(l));
  w.onmessage = (e) => { if (typeof e.data === 'string') for (const l of e.data.split('\n')) if (l) emit(l.trim()); };
  w.onerror = (e) => emit(`__worker_error__ ${e.message || 'worker failed to start'}`);
  return { send: (c) => w.postMessage(c), onLine: (cb) => { subs.push(cb); }, terminate: () => { w.terminate(); subs.length = 0; } };
}
