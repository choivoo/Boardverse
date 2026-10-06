import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, RoomView, ServerMsg } from './protocol';

const KEY = 'boardverse.v1.session';
type Sess = { code: string; token: string };
const read = (): Sess | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const write = (s: Sess | null) => { try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

export type Conn = 'connecting' | 'open' | 'closed';

/** One WebSocket per hook instance; reconnects with backoff and resumes the saved room. */
export function useRoom(enabled: boolean) {
  const [view, setView] = useState<RoomView | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(Date.now());
  const ws = useRef<WebSocket | null>(null);
  const sess = useRef<Sess | null>(read());
  const queue = useRef<ClientMsg | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let closed = false, retry = 0, timer: ReturnType<typeof setTimeout>;
    const open = () => {
      setConn('connecting');
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.current = s;
      s.onopen = () => {
        retry = 0; setConn('open');
        if (queue.current) { s.send(JSON.stringify(queue.current)); queue.current = null; }
        else if (sess.current) s.send(JSON.stringify({ t: 'resume', ...sess.current }));
      };
      s.onmessage = (ev) => {
        let m: ServerMsg; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'joined') { sess.current = { code: m.view.code, token: m.token }; write(sess.current); setView(m.view); setAt(Date.now()); setError(null); }
        else if (m.t === 'view') { setView(m.view); setAt(Date.now()); }
        else { setError(m.msg); if (m.fatal) { sess.current = null; write(null); setView(null); } }
      };
      s.onclose = () => {
        if (closed) return;
        setConn('closed');
        timer = setTimeout(open, Math.min(1000 * 2 ** retry++, 8000));
      };
    };
    open();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); };
  }, [enabled]);

  const send = useCallback((m: ClientMsg) => {
    setError(null);
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
    else setError('서버에 연결 중입니다. 잠시 후 다시 시도하세요.');
  }, []);
  const leave = useCallback(() => { sess.current = null; write(null); setView(null); }, []);
  return { view, conn, error, at, send, leave, setError };
}
