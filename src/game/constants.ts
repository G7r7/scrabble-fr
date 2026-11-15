export const SIZE = 15;
export const CENTER = 7;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;
export const BLANK = '?';

/** Distribution et valeurs officielles du Scrabble francophone (102 jetons). */
export const LETTERS: Record<string, { count: number; value: number }> = {
  A: { count: 9, value: 1 }, B: { count: 2, value: 3 }, C: { count: 2, value: 3 },
  D: { count: 3, value: 2 }, E: { count: 15, value: 1 }, F: { count: 2, value: 4 },
  G: { count: 2, value: 2 }, H: { count: 2, value: 4 }, I: { count: 8, value: 1 },
  J: { count: 1, value: 8 }, K: { count: 1, value: 10 }, L: { count: 5, value: 1 },
  M: { count: 3, value: 2 }, N: { count: 6, value: 1 }, O: { count: 6, value: 1 },
  P: { count: 2, value: 3 }, Q: { count: 1, value: 8 }, R: { count: 6, value: 1 },
  S: { count: 6, value: 1 }, T: { count: 6, value: 1 }, U: { count: 6, value: 1 },
  V: { count: 2, value: 4 }, W: { count: 1, value: 10 }, X: { count: 1, value: 10 },
  Y: { count: 1, value: 10 }, Z: { count: 1, value: 10 },
  [BLANK]: { count: 2, value: 0 },
};

export const VOWELS = new Set(['A', 'E', 'I', 'O', 'U', 'Y']);

export type Bonus = '' | 'MT' | 'MD' | 'LT' | 'LD';

const MT: [number, number][] = [[0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14]];
const MD: [number, number][] = [
  [1, 1], [2, 2], [3, 3], [4, 4], [1, 13], [2, 12], [3, 11], [4, 10],
  [13, 1], [12, 2], [11, 3], [10, 4], [13, 13], [12, 12], [11, 11], [10, 10], [7, 7],
];
const LT: [number, number][] = [
  [1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13], [9, 1], [9, 5], [9, 9], [9, 13], [13, 5], [13, 9],
];
const LD: [number, number][] = [
  [0, 3], [0, 11], [2, 6], [2, 8], [3, 0], [3, 7], [3, 14], [6, 2], [6, 6], [6, 8], [6, 12],
  [7, 3], [7, 11], [8, 2], [8, 6], [8, 8], [8, 12], [11, 0], [11, 7], [11, 14], [12, 6], [12, 8],
  [14, 3], [14, 11],
];

export const BONUS: Bonus[][] = (() => {
  const g: Bonus[][] = Array.from({ length: SIZE }, () => Array<Bonus>(SIZE).fill(''));
  for (const [r, c] of MT) g[r][c] = 'MT';
  for (const [r, c] of MD) g[r][c] = 'MD';
  for (const [r, c] of LT) g[r][c] = 'LT';
  for (const [r, c] of LD) g[r][c] = 'LD';
  return g;
})();

export const letterValue = (l: string) => LETTERS[l]?.value ?? 0;
