import { BINGO_BONUS, BONUS, CENTER, RACK_SIZE, SIZE, letterValue } from './constants';
import { inBounds, isBoardEmpty } from './board';
import type { Board, FormedWord, Placement } from './types';

export type PlacementResult =
  | { ok: true; words: FormedWord[]; score: number }
  | { ok: false; error: string };

/**
 * Vérifie la géométrie d'un coup (alignement, continuité, connexion, centre)
 * et calcule les mots formés avec leur score. Ne vérifie PAS le dictionnaire.
 */
export function evaluatePlacement(board: Board, ps: Placement[]): PlacementResult {
  if (ps.length === 0) return { ok: false, error: 'Posez au moins une lettre.' };
  const seen = new Set<number>();
  for (const p of ps) {
    if (!inBounds(p.r, p.c)) return { ok: false, error: 'Case hors du plateau.' };
    if (board[p.r][p.c]) return { ok: false, error: 'Case déjà occupée.' };
    const k = p.r * SIZE + p.c;
    if (seen.has(k)) return { ok: false, error: 'Deux lettres sur la même case.' };
    seen.add(k);
  }

  const sameRow = ps.every((p) => p.r === ps[0].r);
  const sameCol = ps.every((p) => p.c === ps[0].c);
  if (!sameRow && !sameCol) return { ok: false, error: 'Les lettres doivent être alignées.' };

  const at = new Map<number, Placement>(ps.map((p) => [p.r * SIZE + p.c, p]));
  const letterAt = (r: number, c: number): string | null =>
    board[r][c]?.letter ?? at.get(r * SIZE + c)?.letter ?? null;
  const filled = (r: number, c: number) => inBounds(r, c) && letterAt(r, c) !== null;

  // Direction principale. Pour une lettre seule, on prend celle qui forme un mot.
  let horizontal: boolean;
  if (ps.length > 1) horizontal = sameRow;
  else {
    const { r, c } = ps[0];
    horizontal = filled(r, c - 1) || filled(r, c + 1) || !(filled(r - 1, c) || filled(r + 1, c));
  }
  const [dr, dc] = horizontal ? [0, 1] : [1, 0];

  // Continuité : pas de trou entre la première et la dernière lettre posée.
  const sorted = [...ps].sort((a, b) => (horizontal ? a.c - b.c : a.r - b.r));
  const first = sorted[0], last = sorted[sorted.length - 1];
  for (let r = first.r, c = first.c; r <= last.r && c <= last.c; r += dr, c += dc) {
    if (!filled(r, c)) return { ok: false, error: 'Les lettres doivent former un mot continu.' };
  }

  const empty = isBoardEmpty(board);
  if (empty) {
    if (!at.has(CENTER * SIZE + CENTER)) return { ok: false, error: 'Le premier mot doit passer par la case centrale ★.' };
    if (ps.length < 2) return { ok: false, error: 'Le premier mot doit faire au moins 2 lettres.' };
  } else {
    const touches = ps.some(({ r, c }) =>
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([rr, cc]) => inBounds(rr, cc) && board[rr][cc]),
    );
    if (!touches) return { ok: false, error: 'Le mot doit toucher une lettre déjà posée.' };
  }

  const words: FormedWord[] = [];
  const readWord = (r0: number, c0: number, wr: number, wc: number): FormedWord | null => {
    let r = r0, c = c0;
    while (filled(r - wr, c - wc)) { r -= wr; c -= wc; }
    const cells: [number, number][] = [];
    let word = '', sum = 0, mult = 1;
    for (; filled(r, c); r += wr, c += wc) {
      cells.push([r, c]);
      const l = letterAt(r, c)!;
      word += l;
      const p = at.get(r * SIZE + c);
      let v = p ? (p.blank ? 0 : letterValue(l)) : board[r][c]!.blank ? 0 : letterValue(l);
      if (p) {
        const b = BONUS[r][c];
        if (b === 'LD') v *= 2;
        else if (b === 'LT') v *= 3;
        else if (b === 'MD') mult *= 2;
        else if (b === 'MT') mult *= 3;
      }
      sum += v;
    }
    return word.length >= 2 ? { word, cells, score: sum * mult } : null;
  };

  const main = readWord(first.r, first.c, dr, dc);
  if (main) words.push(main);
  for (const p of ps) {
    const cross = readWord(p.r, p.c, dc, dr);
    if (cross) words.push(cross);
  }
  if (words.length === 0) return { ok: false, error: 'Le coup doit former un mot d’au moins 2 lettres.' };

  let score = words.reduce((s, w) => s + w.score, 0);
  if (ps.length === RACK_SIZE) score += BINGO_BONUS;
  return { ok: true, words, score };
}

export const rackValue = (rack: string[]) => rack.reduce((s, l) => s + letterValue(l), 0);
