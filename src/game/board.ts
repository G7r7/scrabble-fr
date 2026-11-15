import { SIZE } from './constants';
import type { Board, Placement } from './types';

export const emptyBoard = (): Board => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
export const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
export const isBoardEmpty = (b: Board) => b.every((row) => row.every((t) => t === null));

export function applyPlacements(b: Board, ps: Placement[]): void {
  for (const p of ps) b[p.r][p.c] = { letter: p.letter, blank: p.blank };
}
