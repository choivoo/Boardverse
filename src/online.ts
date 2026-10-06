import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClientMsg, RoomView, ServerMsg } from './protocol';

const KEY = 'boardverse.v1.session';
type Sess = { code: string; token: string };
const read = (): Sess | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const write = (s: Sess | null) => { try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

export type Conn = 'connecting' | 'open' | 'closed';
export interface Invite { from: string; code: string }
interface OnlineCtx {
  view: RoomView | null; chat: { name: string; side: 'w' | 'b'; text: string; at: number }[]; conn: Conn; error: string | null; info: string | null; at: number; queued: boolean; invites: Invite[];
  send(m: ClientMsg): void; leave(): void; setError(e: string | null): void; dismissInvite(code: string): void;
}
const Ctx = createContext<OnlineCtx | null>(null);

/** One WebSocket for the whole app while `enabled`; re-created when `identity` (logged-in user id) changes so the server sees the right cookie. */
export function OnlineProvider({ enabled, identity, children }: { enabled: boolean; identity: number | null; children: ReactNode }) {
  const [view, setView] = useState<RoomView | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [chat, setChat] = useState<{ name: string; side: 'w' | 'b'; text: string; at: number }[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [at, setAt] = useState(Date.now());
  const ws = useRef<WebSocket | null>(null);
  const sess = useRef<Sess | null>(read());

  useEffect(() => {
    if (!enabled) return;
    let closed = false, retry = 0, timer: ReturnType<typeof setTimeout>;
    const open = () => {
      setConn('connecting');
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.current = s;
      s.onopen = () => { retry = 0; setConn('open'); if (sess.current) s.send(JSON.stringify({ t: 'resume', ...sess.current })); };
      s.onmessage = (ev) => {
        let m: ServerMsg; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'joined') { setChat(m.view.chat ?? []); sess.current = { code: m.view.code, token: m.token }; write(sess.current); setView(m.view); setAt(Date.now()); setError(null); setQueued(false); }
        else if (m.t === 'view') { setView(m.view); setAt(Date.now()); }
        else if (m.t === 'chat') setChat((l) => [...l, { name: m.name, side: m.side, text: m.text, at: m.at }].slice(-50));
        else if (m.t === 'queued') setQueued(true);
        else if (m.t === 'unqueued') setQueued(false);
        else if (m.t === 'invited') setInvites((l) => [...l.filter((i) => i.code !== m.code), { from: m.from, code: m.code }].slice(-3));
        else if (m.t === 'info') { setInfo(m.msg); setTimeout(() => setInfo(null), 3000); }
        else { setError(m.msg); if (m.fatal) { sess.current = null; write(null); setView(null); } }
      };
      s.onclose = () => { if (closed) return; setConn('closed'); setQueued(false); timer = setTimeout(open, Math.min(1000 * 2 ** retry++, 8000)); };
    };
    open();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); };
  }, [enabled, identity]);

  const send = useCallback((m: ClientMsg) => {
    setError(null);
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m)); else setError('서버에 연결 중입니다. 잠시 후 다시 시도하세요.');
  }, []);
  const leave = useCallback(() => { sess.current = null; write(null); setView(null); }, []);
  const dismissInvite = useCallback((code: string) => setInvites((l) => l.filter((i) => i.code !== code)), []);
  const value = useMemo(() => ({ view, chat, conn, error, info, at, queued, invites, send, leave, setError, dismissInvite }), [view, chat, conn, error, info, at, queued, invites, send, leave, dismissInvite]);
  return createElement(Ctx.Provider, { value }, children);
}
export function useOnline(): OnlineCtx { const c = useContext(Ctx); if (!c) throw new Error('OnlineProvider missing'); return c; }
export const hasSavedRoom = () => !!read();
