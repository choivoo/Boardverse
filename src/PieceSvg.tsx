import type { ReactElement } from 'react';
// Original geometric chess set (all pieces share viewBox, stroke weight and proportions).
const SHAPES: Record<string, ReactElement> = {
  p: <><circle cx="22.5" cy="13" r="5" /><path d="M15.5 35c0-9 3-13 7-14.5 4 1.500 7 5.500 7 14.500z" /><rect x="12.500" y="35" width="20" height="4" rx="1.500" /></>,
  r: <><path d="M13 9h5v4h3V9h3v4h3V9h5v10l-4 3v10l4 3v4H13v-4l4-3V22l-4-3z" /></>,
  n: <><path d="M13 39c0-9 3-14 8-19l-6 1-2-6 9-9c5-2 11 1 13 8 2 6 2 15 2 25z" /><circle cx="25" cy="14.500" r="1.600" className="eye" /></>,
  b: <><circle cx="22.500" cy="7" r="2.600" /><path d="M22.500 10c6 4 9 9 6 16h-12c-3-7 0-12 6-16z" /><path d="M18 26h9l2 10H16z" /><rect x="13.500" y="35.500" width="18" height="4" rx="1.500" /><path d="M20 17l5 5" className="slit" /></>,
  q: <><circle cx="9" cy="12" r="2.200" /><circle cx="16" cy="8" r="2.200" /><circle cx="22.500" cy="6.500" r="2.200" /><circle cx="29" cy="8" r="2.200" /><circle cx="36" cy="12" r="2.200" /><path d="M10 14l5 10 3-12 4.500 12L27 12l3 12 5-10-2 22H12z" /><rect x="11.500" y="35" width="22" height="4" rx="1.500" /></>,
  k: <><rect x="20.500" y="2" width="4" height="12" rx="1" /><rect x="16" y="5.500" width="13" height="4" rx="1" /><path d="M19 14h7v6c6 1.500 9 7 9 16H10c0-9 3-14.500 9-16z" /><rect x="9.500" y="35" width="26" height="4.500" rx="1.500" /></>,
};
export function PieceSvg({ type, color }: { type: string; color: 'w' | 'b' }) {
  return <svg className={`pc pc-${color}`} viewBox="0 0 45 45" aria-hidden="true" focusable="false"><g strokeLinejoin="round" strokeWidth="1.800">{SHAPES[type]}</g></svg>;
}
