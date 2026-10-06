import { useEffect, useRef, useState } from 'react';
import type { Analysis, Label } from './analysis/analyze';
import { LABEL_MARK, LABEL_TEXT, PRESETS, winPercent } from './analysis/analyze';

export const fmtEval = (cp: number) => `${cp >= 0 ? '+' : '−'}${(Math.abs(cp) / 100).toFixed(2)}`;
/** evaluation text for the position after a ply: mates are shown as mates, never as huge pawn values */
export const fmtPly = (p: { san: string; evalWhiteCp: number; mateAfter?: number }) => (p.san.endsWith('#') ? '체크메이트' : p.mateAfter !== undefined ? `${p.evalWhiteCp > 0 ? '백' : '흑'} M${Math.abs(p.mateAfter)}` : fmtEval(p.evalWhiteCp));
type State = { s: 'idle' } | { s: 'loading' } | { s: 'running'; done: number; total: number } | { s: 'done'; a: Analysis } | { s: 'error'; msg: string } | { s: 'cancelled' };

/** Engine analysis of a FINISHED game, on the viewer's own device (Web Worker). Loaded only when the user presses the button. */
export function AnalysisPanel({ moves, k, onResult }: { moves: string[]; k: number; onResult: (a: Analysis | null) => void }) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['id']>('fast');
  const [st, setSt] = useState<State>({ s: 'idle' });
  const abort = useRef<AbortController | null>(null); const engineRef = useRef<{ terminate(): void } | null>(null);
  useEffect(() => () => { abort.current?.abort(); engineRef.current?.terminate(); }, []);
  useEffect(() => { abort.current?.abort(); setSt({ s: 'idle' }); onResult(null); }, [moves]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setSt({ s: 'loading' }); onResult(null);
    const ac = new AbortController(); abort.current = ac;
    try {
      const [{ analyzeGame, analysisBusy }, { createBrowserEngine }] = await Promise.all([import('./analysis/analyze'), import('./analysis/browserEngine')]);
      if (analysisBusy()) throw new Error('이미 분석이 진행 중입니다.');
      const engine = createBrowserEngine(); engineRef.current = engine;
      const p = PRESETS.find((x) => x.id === preset)!;
      const a = await analyzeGame(engine, moves, p, { signal: ac.signal, onProgress: (done, total) => setSt({ s: 'running', done, total }) });
      engine.terminate(); engineRef.current = null; setSt({ s: 'done', a }); onResult(a);
    } catch (e) {
      engineRef.current?.terminate(); engineRef.current = null;
      if ((e as Error).name === 'AbortError') setSt({ s: 'cancelled' });
      else setSt({ s: 'error', msg: /Failed to|NetworkError|load/i.test((e as Error).message) ? '엔진 파일을 불러오지 못했습니다. 네트워크를 확인하세요.' : (e as Error).message });
    }
  };
  const busy = st.s === 'loading' || st.s === 'running';
  const cur = st.s === 'done' && k > 0 ? st.a.plies[k - 1] : null;
  const next = st.s === 'done' && k < st.a.plies.length ? st.a.plies[k] : null;
  const pct = cur ? winPercent(cur.evalWhiteCp) : 50;
  return (
    <details className="card analysis" open>
      <summary><strong>엔진 분석</strong> <span className="note">(끝난 대국 전용)</span></summary>
      <p className="note">이 기기에서 Stockfish(GPL-3.0)가 직접 계산하며 기보는 서버로 보내지 않습니다. 진행 중인 대국에서는 사용할 수 없습니다.</p>
      <div className="row">
        {PRESETS.map((p) => <label key={p.id}><input type="radio" name="preset" disabled={busy} checked={preset === p.id} onChange={() => setPreset(p.id)} /> {p.label}</label>)}
      </div>
      <p className="note">제한: 수마다 깊이 {PRESETS.find((p) => p.id === preset)!.depth} 또는 {PRESETS.find((p) => p.id === preset)!.movetimeMs}ms 중 먼저 도달한 쪽 · 최대 160수 · 예상 {Math.ceil((moves.length + 1) * PRESETS.find((p) => p.id === preset)!.movetimeMs / 1000)}초 이내</p>
      <div className="row">
        <button className="primary" onClick={start} disabled={busy || moves.length === 0}>{st.s === 'done' ? '다시 분석' : '분석 시작'}</button>
        {busy && <button onClick={() => abort.current?.abort()}>취소</button>}
      </div>
      <div aria-live="polite">
        {st.s === 'loading' && <p role="status">엔진을 불러오는 중… (약 2MB)</p>}
        {st.s === 'running' && <><p role="status">분석 중 {st.done}/{st.total}</p><div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={st.total} aria-valuenow={st.done} aria-label="분석 진행"><i style={{ width: `${(100 * st.done) / st.total}%` }} /></div></>}
        {st.s === 'error' && <p role="alert" className="err">분석 실패: {st.msg}</p>}
        {st.s === 'cancelled' && <p role="status">분석을 취소했습니다.</p>}
      </div>
      {st.s === 'done' && (
        <>
          <p className="note">{st.a.engine.name} · 깊이 ≤{st.a.engine.depth} · 수당 ≤{st.a.engine.movetimeMs}ms{st.a.truncated ? ' · 160수까지만 분석' : ''}</p>
          <div className="evalbar" role="img" aria-label={`현재 평가 ${cur ? fmtPly(cur) : '0.00'} (백 기준)`}><i style={{ width: `${pct}%` }} /><span>{cur ? fmtPly(cur) : '0.00'}</span></div>
          {next?.bestSan && <p>이 위치의 엔진 추천: <strong>{next.bestSan}</strong>{next.san !== next.bestSan ? ` (실제: ${next.san} ${LABEL_MARK[next.label]})` : ' (실제와 같음)'}</p>}
          <table className="table"><caption className="sr">분석 요약</caption><thead><tr><th></th><th>백</th><th>흑</th></tr></thead><tbody>
            <tr><th scope="row">평균 손실(승률 %p)</th><td>{st.a.summary.w.avgLossPct}</td><td>{st.a.summary.b.avgLossPct}</td></tr>
            {(['best', 'inaccuracy', 'mistake', 'blunder'] as Label[]).map((l) => <tr key={l}><th scope="row">{LABEL_MARK[l]} {LABEL_TEXT[l]}</th><td>{st.a.summary.w.counts[l]}</td><td>{st.a.summary.b.counts[l]}</td></tr>)}
          </tbody></table>
        </>
      )}
    </details>
  );
}
