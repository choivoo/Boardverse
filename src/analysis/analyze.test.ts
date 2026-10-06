import { describe, it, expect } from 'vitest';
import { analyzeGame, analysisBusy, parseInfo, parseBestmove, scoreToCp, winPercent, labelFor, PRESETS, MAX_PLIES, type UciEngine } from './analyze';
import { createNodeEngine } from './nodeEngine';

const FAST = { ...PRESETS[0], depth: 8, movetimeMs: 120 };

describe('uci parsing and scoring', () => {
  it('parses settled info lines only', () => {
    expect(parseInfo('info depth 12 seldepth 18 multipv 1 score cp 34 nodes 1000 pv e2e4 e7e5')).toEqual({ depth: 12, score: { cp: 34 }, pv: ['e2e4', 'e7e5'] });
    expect(parseInfo('info depth 3 score mate -2 pv a1a2')).toMatchObject({ score: { mate: -2 } });
    expect(parseInfo('info depth 9 score cp 50 lowerbound pv e2e4')).toBeNull();
    expect(parseInfo('info depth 9 multipv 2 score cp 50 pv e2e4')).toBeNull();
    expect(parseInfo('info string NNUE evaluation using nn.bin')).toBeNull();
    expect(parseInfo('info depth x score cp 5')).toBeNull();
    expect(parseBestmove('bestmove e2e4 ponder e7e5')).toBe('e2e4'); expect(parseBestmove('uciok')).toBeNull();
  });
  it('win chance is monotonic, symmetric and labels use thresholds on real loss', () => {
    expect(winPercent(0)).toBeCloseTo(50, 5); expect(winPercent(300) + winPercent(-300)).toBeCloseTo(100, 5); expect(winPercent(900)).toBeGreaterThan(winPercent(300));
    expect(scoreToCp({ mate: 1 })).toBeGreaterThan(scoreToCp({ mate: 5 })); expect(scoreToCp({ mate: -1 })).toBeLessThan(0);
    expect([labelFor(0, true), labelFor(2, false), labelFor(7, false), labelFor(12, false), labelFor(40, false), labelFor(40, true)]).toEqual(['best', 'ok', 'inaccuracy', 'mistake', 'blunder', 'best']);
  });
});

/** scripted engine: answers every `go` from a queue of [score line, bestmove] */
function fake(script: { info: string; best: string }[], opts: { silent?: boolean } = {}): UciEngine & { sent: string[] } {
  let cb: (l: string) => void = () => {}; let i = 0; const sent: string[] = [];
  return { sent, onLine: (f) => { cb = f; }, terminate() {},
    send(c) { sent.push(c); if (opts.silent) return;
      if (c === 'uci') { cb('id name FakeFish 1'); cb('uciok'); } else if (c === 'isready') cb('readyok');
      else if (c.startsWith('go')) { const s = script[i++]; cb(s.info); cb(`bestmove ${s.best}`); } } };
}
describe('analysis from engine output (scripted engine)', () => {
  it('labels come only from the engine numbers; best move is recognised; evals are white-pov', async () => {
    // 1.e4 e5: position0 best e2e4 (+30), after e4: black to move, best e7e5 (cp +20 for black), after e5: white to move +25
    const eng = fake([{ info: 'info depth 8 score cp 30 pv e2e4', best: 'e2e4' }, { info: 'info depth 8 score cp 20 pv e7e5', best: 'e7e5' }, { info: 'info depth 8 score cp 25 pv g1f3', best: 'g1f3' }]);
    const a = await analyzeGame(eng, ['e4', 'e5'], FAST);
    expect(a.engine).toEqual({ name: 'FakeFish 1', depth: 8, movetimeMs: 120 });
    expect(a.plies.map((p) => p.label)).toEqual(['best', 'best']);
    expect(a.plies[0].evalWhiteCp).toBe(-20); // after e4 black is to move with +20 => white's point of view is -20
    expect(a.plies[1].evalWhiteCp).toBe(25);
    expect(a.plies[0].bestSan).toBe('e4');
  });
  it('a move that the engine scores far below the best becomes a blunder', async () => {
    const eng = fake([{ info: 'info depth 8 score cp 20 pv e2e4', best: 'e2e4' }, { info: 'info depth 8 score cp 900 pv e7e5', best: 'e7e5' }]); // after 1.f3 the scripted engine says black is +900
    const a = await analyzeGame(eng, ['f3'], FAST);
    expect(a.plies[0]).toMatchObject({ label: 'blunder', bestSan: 'e4' }); expect(a.plies[0].lossPct).toBeGreaterThan(15); expect(a.summary.w.counts.blunder).toBe(1);
  });
  it('rejects garbage: illegal best move, silent engine, crash, second concurrent run, cancellation', async () => {
    await expect(analyzeGame(fake([{ info: 'info depth 8 score cp 0 pv a1a1', best: 'a1a1' }]), ['e4'], FAST)).rejects.toThrow(/illegal/);
    await expect(analyzeGame(fake([{ info: 'info string hi', best: 'e2e4' }]), ['e4'], FAST)).rejects.toThrow(/usable/);
    expect(analysisBusy()).toBe(false); // lock is always released
    let emit: (l: string) => void = () => {}; const crash: UciEngine = { send(c) { if (c === 'uci') setTimeout(() => emit('__worker_error__ boom'), 0); }, onLine(f) { emit = f; }, terminate() {} };
    await expect(analyzeGame(crash, ['e4'], FAST)).rejects.toThrow(/crashed: boom/); expect(analysisBusy()).toBe(false);
    const ac = new AbortController(); const slow = fake([], { silent: true });
    const p = analyzeGame(slow, ['e4'], FAST, { signal: ac.signal }); expect(analysisBusy()).toBe(true);
    await expect(analyzeGame(fake([]), ['e4'], FAST)).rejects.toThrow(/already running/);
    ac.abort(); await expect(p).rejects.toThrow(/cancel/); expect(analysisBusy()).toBe(false);
  });
  it('terminal positions need no search and long games are truncated', async () => {
    const mate = ['f3', 'e5', 'g4', 'Qh4#']; // fool's mate
    const eng = fake([{ info: 'info depth 8 score cp 20 pv e2e4', best: 'e2e4' }, { info: 'info depth 8 score cp 10 pv e7e5', best: 'e7e5' }, { info: 'info depth 8 score cp 60 pv d2d4', best: 'd2d4' }, { info: 'info depth 8 score mate 1 pv d8h4', best: 'd8h4' }]);
    const a = await analyzeGame(eng, mate, FAST);
    expect(eng.sent.filter((c) => c.startsWith('go'))).toHaveLength(4); // 5 positions, the final checkmate position is not searched
    expect(a.plies[3]).toMatchObject({ san: 'Qh4#', evalWhiteCp: -10000 });
    expect(MAX_PLIES).toBe(160);
  });
});

describe('real Stockfish 19 Lite (child process, same build as the browser worker)', () => {
  it('finds mate in one and punishes a blunder in the Scholar\'s mate game', async () => {
    const eng = createNodeEngine();
    try {
      // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
      const a = await analyzeGame(eng, ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'], FAST);
      expect(a.engine.name).toMatch(/^Stockfish 19/);
      expect(a.plies).toHaveLength(7);
      expect(a.plies[5]).toMatchObject({ san: 'Nf6', label: 'blunder', bestSan: expect.any(String) }); // allows mate in one
      expect(a.plies[6]).toMatchObject({ san: 'Qxf7#', label: 'best', evalWhiteCp: 10000 });
      expect(a.plies[0].label).not.toBe('blunder'); expect(a.summary.b.counts.blunder).toBeGreaterThanOrEqual(1);
    } finally { eng.terminate(); }
  }, 60_000);
  it('recognises a legal best move from a known mating position', async () => {
    const eng = createNodeEngine();
    try {
      const lines: string[] = []; eng.onLine((l) => lines.push(l));
      eng.send('uci'); eng.send('position fen 6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1'); eng.send('go depth 8');
      for (let i = 0; i < 100 && !lines.some((l) => l.startsWith('bestmove')); i++) await new Promise((r) => setTimeout(r, 100));
      expect(lines.find((l) => l.startsWith('bestmove'))).toBe('bestmove a1a8');
    } finally { eng.terminate(); }
  }, 30_000);
});

import { fmtPly } from '../AnalysisPanel';
describe('evaluation text', () => {
  it('mates are not shown as pawn values', () => {
    expect(fmtPly({ san: 'Qxf7#', evalWhiteCp: 10000 })).toBe('체크메이트');
    expect(fmtPly({ san: 'Nf6', evalWhiteCp: 9700, mateAfter: 3 })).toBe('백 M3'); expect(fmtPly({ san: 'e4', evalWhiteCp: -35 })).toBe('−0.35');
  });
});
