import { describe, expect, test } from 'vitest';
import { newGame } from '../src/game/game';
import { applyAction, parseAction, viewFor } from '../src/game/remote';

const allValid = async () => [] as string[];
const setup = () => {
  const g = newGame('moyen', { names: ['Alice', 'Bob'] });
  g.current = 1;
  g.players[1].rack = ['C', 'H', 'A', 'T', 'E', 'S', '?'];
  return g;
};
const chat = [
  { r: 7, c: 6, letter: 'C', blank: false }, { r: 7, c: 7, letter: 'H', blank: false },
  { r: 7, c: 8, letter: 'A', blank: false }, { r: 7, c: 9, letter: 'T', blank: false },
];

describe('jeu en ligne', () => {
  test('partie à deux humains', () => {
    const g = newGame('moyen', { names: ['Alice', 'Bob'] });
    expect(g.online).toBe(true);
    expect(g.players.map((p) => [p.name, p.isAi])).toEqual([['Alice', false], ['Bob', false]]);
  });

  test('parseAction rejette les messages mal formés', () => {
    expect(parseAction({ type: 'pass' })).toEqual({ type: 'pass' });
    expect(parseAction({ type: 'play', placements: [{ r: 7, c: 7, letter: 'A', blank: false }] })).not.toBeNull();
    expect(parseAction({ type: 'play', placements: [{ r: 15, c: 7, letter: 'A', blank: false }] })).toBeNull();
    expect(parseAction({ type: 'play', placements: [{ r: 7, c: 7, letter: '<b>', blank: false }] })).toBeNull();
    expect(parseAction({ type: 'exchange', letters: [] })).toBeNull();
    expect(parseAction({ type: 'exchange', letters: ['?', 'A'] })).not.toBeNull();
    expect(parseAction(null)).toBeNull();
    expect(parseAction({ type: 'hack' })).toBeNull();
  });

  test("l'hôte applique un coup légal de l'invité", async () => {
    const g = setup();
    expect(await applyAction(g, 1, { type: 'play', placements: chat }, allValid)).toBeNull();
    expect(g.board[7][7]?.letter).toBe('H');
    expect(g.players[1].score).toBeGreaterThan(0);
    expect(g.players[1].rack).toHaveLength(7);
    expect(g.current).toBe(0);
  });

  test("l'hôte refuse : hors tour, lettres absentes, mot inconnu", async () => {
    const g = setup();
    expect(await applyAction(g, 0, { type: 'pass' }, allValid)).toMatch(/tour/);
    const bad = chat.map((p) => ({ ...p, letter: 'Z' }));
    expect(await applyAction(g, 1, { type: 'play', placements: bad }, allValid)).toMatch(/chevalet/);
    expect(await applyAction(g, 1, { type: 'play', placements: chat }, async (w) => w)).toMatch(/CHAT/);
    expect(g.board[7][7]).toBeNull();
    expect(g.current).toBe(1);
  });

  test('vue de l’invité : chevalet adverse et sac masqués', () => {
    const g = setup();
    const v = viewFor(g, 1);
    expect(v.players[1].rack).toEqual(g.players[1].rack);
    expect(v.players[0].rack.every((l) => l === '')).toBe(true);
    expect(v.bag).toHaveLength(g.bag.length);
    expect(v.bag.every((l) => l === '')).toBe(true);
    expect(g.players[0].rack.some((l) => l !== '')).toBe(true); // l'original est intact
  });
});
