import { describe, expect, test } from 'vitest';
import { emptyBoard, applyPlacements } from '../src/game/board';
import { evaluatePlacement } from '../src/game/rules';
import { newBag } from '../src/game/bag';
import type { Placement } from '../src/game/types';

const word = (w: string, r: number, c: number, vertical = false, blanks: number[] = []): Placement[] =>
  [...w].map((letter, i) => ({ r: vertical ? r + i : r, c: vertical ? c : c + i, letter, blank: blanks.includes(i) }));

describe('règles', () => {
  test('sac français de 102 jetons', () => {
    const bag = newBag();
    expect(bag.length).toBe(102);
    expect(bag.filter((l) => l === 'E').length).toBe(15);
    expect(bag.filter((l) => l === '?').length).toBe(2);
  });

  test('premier coup : case centrale obligatoire, mot compte double', () => {
    expect(evaluatePlacement(emptyBoard(), word('CHAT', 0, 0)).ok).toBe(false);
    const r = evaluatePlacement(emptyBoard(), word('CHAT', 7, 4)); // C(7,4) H(7,5) A(7,6) T(7,7 = MD)
    expect(r.ok && r.score).toBe((3 + 4 + 1 + 1) * 2);
  });

  test('lettre compte double et joker à 0', () => {
    // KIWI en 7,3 : K sur LD (7,3) => 20, I, W, I(7,6). Ligne 7 : centre en 7,7 non couvert -> on pose jusqu'au centre.
    const r = evaluatePlacement(emptyBoard(), word('KIWIS', 7, 3, false, [4]));
    expect(r.ok && r.score).toBe((20 + 1 + 10 + 1 + 0) * 2);
  });

  test('scrabble : +50', () => {
    const r = evaluatePlacement(emptyBoard(), word('MAISONS', 7, 7));
    // M A I S O N S : 7,7 MD ; 7,11 LD (N? index 4 = O)
    expect(r.ok && r.score).toBe((2 + 1 + 1 + 1 + 1 * 2 + 1 + 1) * 2 + 50);
  });

  test('mots croisés comptés', () => {
    const b = emptyBoard();
    applyPlacements(b, word('CHAT', 7, 7));
    // Pose « S » sous le T ? Non : on pose « AS » verticalement depuis le A de CHAT -> forme ASx.
    const r = evaluatePlacement(b, [{ r: 8, c: 9, letter: 'S', blank: false }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.words.map((w) => w.word)).toEqual(['AS']);
    const r2 = evaluatePlacement(b, [{ r: 7, c: 11, letter: 'S', blank: false }]);
    expect(r2.ok && r2.words.map((w) => w.word)).toEqual(['CHATS']);
  });

  test('coups invalides', () => {
    const b = emptyBoard();
    applyPlacements(b, word('CHAT', 7, 7));
    expect(evaluatePlacement(b, word('OU', 0, 0)).ok).toBe(false); // non connecté
    expect(evaluatePlacement(b, [{ r: 6, c: 6, letter: 'A', blank: false }, { r: 8, c: 8, letter: 'A', blank: false }]).ok).toBe(false);
    expect(evaluatePlacement(b, [{ r: 8, c: 7, letter: 'A', blank: false }, { r: 10, c: 7, letter: 'A', blank: false }]).ok).toBe(false); // trou
    expect(evaluatePlacement(b, [{ r: 7, c: 7, letter: 'A', blank: false }]).ok).toBe(false); // occupé
  });
});
