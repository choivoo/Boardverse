import { useCallback, useEffect, useState, type ReactNode } from 'react';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => { setLoading(true); setError(null); fn().then(setData).catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(run, [run]);
  return { data, error, loading, reload: run };
}

export function State({ loading, error, retry, children }: { loading: boolean; error: string | null; retry: () => void; children: ReactNode }) {
  if (loading) return <p role="status" className="note">불러오는 중…</p>;
  if (error) return <div className="banner err" role="alert"><p>{error}</p><button onClick={retry}>다시 시도</button></div>;
  return <>{children}</>;
}

export function Avatar({ name, frame }: { name: string; frame?: string }) {
  return <span className={`avatar ${frame ?? ''}`} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}
export const GAME_NAME = { chess: '체스', gomoku: '오목' } as const;
export const fmtDate = (t: number) => new Date(t).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
