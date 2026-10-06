// Single source of truth for rating categories. Chess uses the common "estimated duration" convention
// (base seconds + 40 × increment seconds): < 180 s bullet, < 480 s blitz, otherwise rapid.
import type { GameKind } from './protocol';
export const BULLET_MAX = 180, BLITZ_MAX = 480, INC_MOVES = 40;
export const CAT_LABEL: Record<string, string> = { bullet: '불릿', blitz: '블리츠', rapid: '래피드', untimed: '무제한', legacy: '기존(동결)', std: '기본' };
export const CATS: Record<GameKind, string[]> = { chess: ['bullet', 'blitz', 'rapid', 'untimed', 'legacy'], gomoku: ['std'] };
/** Categories that new games can be rated in (legacy is a frozen pre-migration chess rating). */
export const ACTIVE_CATS: Record<GameKind, string[]> = { chess: ['bullet', 'blitz', 'rapid', 'untimed'], gomoku: ['std'] };
export function ratingCat(game: GameKind, base: number, inc: number): string {
  if (game === 'gomoku') return 'std';
  if (!base) return 'untimed';
  const est = base + INC_MOVES * inc;
  return est < BULLET_MAX ? 'bullet' : est < BLITZ_MAX ? 'blitz' : 'rapid';
}
