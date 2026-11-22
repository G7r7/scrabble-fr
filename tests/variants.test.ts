import { describe, expect, test } from 'vitest';
import { newGame } from '../src/game/game';
import { applyAction } from '../src/game/remote';

const dict = (bad: string[]) => async (w: string[]) => w.filter((x) => bad.includes(x));
const chat = [
  { r: 7, c: 6, letter: 'C', blank: false }, { r: 7, c: 7, letter: 'H', blank: false },
  { r: 7, c: 8, letter: 'A', blank: false }, { r: 7, c: 9, letter: 'T', blank: false },
];
const setup = (variant: 'challenge' | 'hardcore' | null) => {
  const g = newGame('moyen', { names: ['Alice', 'Bob'] }, { variant });
  g.current = 0;
  g.players[0].rack = ['C', 'H', 'A', 'T', 'E', 'S', '?'];
  return g;
};

describe('mode challenge', () => {
  test('le coup est proposé sans vérification', async () => {
    const g = setup('challenge');
    expect(await applyAction(g, 0, { type: 'play', placements: chat }, dict(['CHAT']))).toBeNull();
    expect(g.proposal?.player).toBe(0);
    expect(g.board[7][7]).toBeNull();
    expect(g.current).toBe(0);
    // Ni l'auteur, ni d'autres actions tant que l'adversaire n'a pas tranché.
    expect(await applyAction(g, 0, { type: 'accept' }, dict([]))).toMatch(/adversaire/);
    expect(await applyAction(g, 1, { type: 'pass' }, dict([]))).toMatch(/accepté ou contesté/);
  });

  test('accepté : le coup compte', async () => {
    const g = setup('challenge');
    await applyAction(g, 0, { type: 'play', placements: chat }, dict(['CHAT']));
    expect(await applyAction(g, 1, { type: 'accept' }, dict(['CHAT']))).toBeNull();
    expect(g.board[7][7]?.letter).toBe('H');
    expect(g.players[0].score).toBeGreaterThan(0);
    expect(g.current).toBe(1);
    expect(g.proposal).toBeNull();
  });

  test('challenge réussi : coup annulé, son auteur perd le tour', async () => {
    const g = setup('challenge');
    await applyAction(g, 0, { type: 'play', placements: chat }, dict([]));
    expect(await applyAction(g, 1, { type: 'challenge' }, dict(['CHAT']))).toBeNull();
    expect(g.board[7][7]).toBeNull();
    expect(g.players[0].score).toBe(0);
    expect(g.players[0].rack).toHaveLength(7);
    expect(g.current).toBe(1);
    expect(g.history.at(-1)).toMatchObject({ kind: 'invalid', player: 0, challenged: true });
  });

  test('challenge raté : le coup compte, le contestataire perd son tour', async () => {
    const g = setup('challenge');
    await applyAction(g, 0, { type: 'play', placements: chat }, dict([]));
    expect(await applyAction(g, 1, { type: 'challenge' }, dict([]))).toBeNull();
    expect(g.board[7][7]?.letter).toBe('H');
    expect(g.players[0].score).toBeGreaterThan(0);
    expect(g.current).toBe(0);
    expect(g.history.map((e) => e.kind)).toEqual(['play', 'challenge']);
  });
});

describe('mode hardcore', () => {
  test('mot refusé : −10 points, lettres rendues, tour perdu', async () => {
    const g = setup('hardcore');
    expect(await applyAction(g, 0, { type: 'play', placements: chat }, dict(['CHAT']))).toBeNull();
    expect(g.board[7][7]).toBeNull();
    expect(g.players[0].score).toBe(-10);
    expect(g.players[0].rack).toHaveLength(7);
    expect(g.current).toBe(1);
    expect(g.history.at(-1)).toMatchObject({ kind: 'invalid', score: -10 });
  });

  test('mot valide : joué normalement', async () => {
    const g = setup('hardcore');
    expect(await applyAction(g, 0, { type: 'play', placements: chat }, dict([]))).toBeNull();
    expect(g.board[7][7]?.letter).toBe('H');
  });
});

describe('mode normal', () => {
  test('mot refusé : simplement rejeté, on rejoue', async () => {
    const g = setup(null);
    expect(await applyAction(g, 0, { type: 'play', placements: chat }, dict(['CHAT']))).toMatch(/CHAT/);
    expect(g.current).toBe(0);
    expect(g.players[0].score).toBe(0);
  });
});

describe('mots restés sur le plateau (révélés en fin de partie)', () => {
  test('retenus en mode challenge, avec leurs cases, points et auteur ; pas en mode normal', async () => {
    const g = setup('challenge');
    await applyAction(g, 0, { type: 'play', placements: chat }, dict(['CHAT']));
    await applyAction(g, 1, { type: 'accept' }, dict(['CHAT']));
    expect(g.played).toEqual([{ word: 'CHAT', cells: [[7, 6], [7, 7], [7, 8], [7, 9]], score: g.players[0].score, player: 0 }]);
    const n = setup(null);
    await applyAction(n, 0, { type: 'play', placements: chat }, dict([]));
    expect(n.played).toBeUndefined();
  });
});

describe('relecture du plateau', () => {
  test('boardWords trouve les suites de deux lettres ou plus, en ligne et en colonne', async () => {
    const { boardWords, newGame: ng } = await import('../src/game/game');
    const g = ng('moyen');
    for (const [i, l] of [...'CHAT'].entries()) g.board[7][6 + i] = { letter: l, blank: false };
    g.board[8][9] = { letter: 'U', blank: false }; // forme TU en colonne
    expect(boardWords(g.board).map((w) => w.word).sort()).toEqual(['CHAT', 'TU']);
  });
});
