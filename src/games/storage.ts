export interface GameRecord { id: string; game: 'chess' | 'gomoku'; mode: string; result: string; moves: number; at: number; list?: string[] }
const KEY = 'boardverse.v1.history';

export function loadHistory(): GameRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((r) => r && typeof r.id === 'string' && typeof r.result === 'string').slice(0, 50) : [];
  } catch { return []; }
}
/** Returns false if saving failed (private mode, quota). */
export function saveRecord(r: GameRecord): boolean {
  try { localStorage.setItem(KEY, JSON.stringify([r, ...loadHistory()].slice(0, 50))); return true; } catch { return false; }
}
export function clearHistory(): void { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
