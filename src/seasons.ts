// Season definitions are data. Times are UTC; the UI shows them in the viewer's locale.
export type Reward = { id: string; label: string; need?: { rated?: number; wins?: number; topRank?: number }; give: { coins?: number; item?: string } };
export interface Season { id: string; name: string; start: string; end: string; rewards: Reward[] }
export const CLAIM_GRACE_MS = 14 * 86400_000;
export const SEASONS: Season[] = [
  { id: 's1', name: '시즌 1 · 첫 판', start: '2026-10-01T00:00:00Z', end: '2026-12-31T23:59:59Z', rewards: [
    { id: 'r5', label: '평가전 5판', need: { rated: 5 }, give: { coins: 100 } },
    { id: 'w10', label: '평가전 10승', need: { wins: 10 }, give: { item: 'board-s1' } },
    { id: 'r20', label: '평가전 20판', need: { rated: 20 }, give: { item: 'frame-s1' } },
    { id: 'top3', label: '최종 순위 TOP 3 (종료 후)', need: { topRank: 3 }, give: { item: 'frame-s1-top' } },
  ] },
];
export const seasonAt = (t: number) => SEASONS.find((s) => Date.parse(s.start) <= t && t <= Date.parse(s.end)) ?? null;
