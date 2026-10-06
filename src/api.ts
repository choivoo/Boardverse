import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULTS, type Slot } from './catalog';

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('서버에 연결할 수 없습니다.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `요청 실패 (${res.status})`);
  return data as T;
}

export interface Me {
  id: number; name: string; coins: number; public: boolean;
}
export interface AccountState {
  status: 'loading' | 'guest' | 'user' | 'offline';
  user: Me | null; ratings: { game: string; rating: number; games: number }[]; stats: Record<string, { w: number; l: number; d: number }>;
  inventory: string[]; equipped: Record<string, string>;
}
interface Ctx extends AccountState {
  refresh(): Promise<void>; login(email: string, password: string): Promise<void>; register(email: string, name: string, password: string): Promise<void>; logout(): Promise<void>;
  preview: Partial<Record<Slot, string>>; setPreview(p: Partial<Record<Slot, string>>): void;
  look: Record<Slot, string>;
}
const empty: AccountState = { status: 'loading', user: null, ratings: [], stats: {}, inventory: [], equipped: {} };
const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<AccountState>(empty);
  const [preview, setPreview] = useState<Partial<Record<Slot, string>>>({});
  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: Me | null } & Partial<AccountState>>('/api/me');
      setS(r.user ? { status: 'user', user: r.user, ratings: r.ratings ?? [], stats: r.stats ?? {}, inventory: r.inventory ?? [], equipped: r.equipped ?? {} } : { ...empty, status: 'guest' });
    } catch { setS((p) => ({ ...p, status: p.user ? 'user' : 'offline' })); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const login = useCallback(async (email: string, password: string) => { await api('/api/login', 'POST', { email, password }); await refresh(); }, [refresh]);
  const register = useCallback(async (email: string, name: string, password: string) => { await api('/api/register', 'POST', { email, name, password }); await refresh(); }, [refresh]);
  const logout = useCallback(async () => { await api('/api/logout', 'POST', {}); await refresh(); }, [refresh]);
  const look = useMemo(() => ({ ...DEFAULTS, ...s.equipped, ...preview }) as Record<Slot, string>, [s.equipped, preview]);
  useEffect(() => {
    const d = document.documentElement.dataset;
    d.board = look.boardTheme; d.pieces = look.chessSet; d.stones = look.stoneSet;
  }, [look]);
  const value = useMemo(() => ({ ...s, refresh, login, register, logout, preview, setPreview, look }), [s, refresh, login, register, logout, preview, look]);
  return createElement(AccountCtx.Provider, { value }, children);
}
export function useAccount(): Ctx { const c = useContext(AccountCtx); if (!c) throw new Error('AccountProvider missing'); return c; }
