import { describe, expect, test } from 'vitest';
import { newGame, playMove } from '../src/game/game';
import { evaluatePlacement } from '../src/game/rules';
import { THEMES, applyTheme, isThemeWord, themeWords } from '../src/game/themes';

describe('mode fantasy', () => {
  test('chaque thème a une liste de mots conséquente', () => {
    for (const t of THEMES) expect(themeWords(t.id).size).toBeGreaterThan(300);
    expect(isThemeWord('nature', 'RENARD')).toBe(true);
    expect(isThemeWord('nature', 'RENARDS')).toBe(true);
    expect(isThemeWord('medecine', 'RENARD')).toBe(false);
  });

  test('les mots du thème rapportent double', () => {
    const g = newGame('moyen', null, { theme: 'nature' });
    g.current = 0;
    g.players[0].rack = ['C', 'H', 'A', 'T', 'E', 'S', 'R'];
    const ps = [..."CHAT"].map((letter, i) => ({ r: 7, c: 6 + i, letter, blank: false }));
    const res = evaluatePlacement(g.board, ps);
    if (!res.ok) throw new Error(res.error);
    expect(applyTheme('nature', { placements: ps, words: res.words, score: res.score }).score).toBe(res.score * 2);
    expect(applyTheme('sports', { placements: ps, words: res.words, score: res.score }).score).toBe(res.score);
    playMove(g, { placements: ps, words: res.words, score: res.score });
    expect(g.players[0].score).toBe(res.score * 2);
    expect(g.history[0].text).toBe('CHAT ✦');
    expect(g.themeCells).toHaveLength(4);
    expect(g.lastWords?.[0].themed).toBe(true);
  });
});
