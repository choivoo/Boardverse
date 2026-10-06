// Shared data (client display + server validation). Cosmetics never affect rules or ratings.
export type Slot = 'boardTheme' | 'chessSet' | 'stoneSet' | 'frame';
export interface Item { id: string; slot: Slot; name: string; desc: string; rarity: 'common' | 'rare' | 'epic'; price: number | null; season?: string }

export const DEFAULTS: Record<Slot, string> = { boardTheme: 'board-classic', chessSet: 'chess-bv', stoneSet: 'stone-classic', frame: 'frame-none' };
export const SLOT_LABEL: Record<Slot, string> = { boardTheme: '보드 테마', chessSet: '체스 말', stoneSet: '오목 돌', frame: '프로필 테두리' };

export const ITEMS: Item[] = [
  { id: 'board-classic', slot: 'boardTheme', name: '클래식 우드', desc: '기본 나무 보드', rarity: 'common', price: 0 },
  { id: 'board-ice', slot: 'boardTheme', name: '아이스', desc: '차가운 푸른 보드', rarity: 'common', price: 100 },
  { id: 'board-mint', slot: 'boardTheme', name: '민트 그린', desc: '산뜻한 초록 보드', rarity: 'common', price: 100 },
  { id: 'board-night', slot: 'boardTheme', name: '나이트', desc: '어두운 보드', rarity: 'rare', price: 160 },
  { id: 'board-s1', slot: 'boardTheme', name: '시즌 1 골드', desc: '시즌 1 보상 보드', rarity: 'epic', price: null, season: 's1' },
  { id: 'chess-bv', slot: 'chessSet', name: '보드버스 기하', desc: '기본 SVG 기물', rarity: 'common', price: 0 },
  { id: 'chess-glyph', slot: 'chessSet', name: '유니코드 클래식', desc: '글리프 기물', rarity: 'common', price: 0 },
  { id: 'chess-neon', slot: 'chessSet', name: '네온', desc: '밝은 형광 기물', rarity: 'rare', price: 200 },
  { id: 'stone-classic', slot: 'stoneSet', name: '클래식 돌', desc: '흑백 돌', rarity: 'common', price: 0 },
  { id: 'stone-gold', slot: 'stoneSet', name: '금과 은', desc: '금색·은색 돌', rarity: 'rare', price: 150 },
  { id: 'stone-jade', slot: 'stoneSet', name: '비취', desc: '녹색·백색 돌', rarity: 'rare', price: 150 },
  { id: 'frame-none', slot: 'frame', name: '없음', desc: '테두리 없음', rarity: 'common', price: 0 },
  { id: 'frame-bronze', slot: 'frame', name: '브론즈', desc: '청동 테두리', rarity: 'common', price: 80 },
  { id: 'frame-s1', slot: 'frame', name: '시즌 1 참가', desc: '시즌 1 평가전 20판 보상', rarity: 'rare', price: null, season: 's1' },
  { id: 'frame-s1-top', slot: 'frame', name: '시즌 1 TOP 3', desc: '시즌 1 최종 상위 3위', rarity: 'epic', price: null, season: 's1' },
];
export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const FREE_ITEMS = ITEMS.filter((i) => i.price === 0).map((i) => i.id);
