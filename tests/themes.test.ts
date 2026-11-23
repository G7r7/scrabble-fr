import { describe, expect, test } from 'vitest';
import { newGame, playMove } from '../src/game/game';
import { evaluatePlacement } from '../src/game/rules';
import { THEMES, applyTheme, isThemeWord, themeWords } from '../src/game/themes';
import { Games } from '../server/games';

describe('mode fantasy', () => {
  test('chaque thème a une liste de mots conséquente', () => {
    for (const t of THEMES) expect(themeWords(t.id).size).toBeGreaterThan(300);
    expect(isThemeWord('nature', 'RENARD')).toBe(true);
    expect(isThemeWord('nature', 'RENARDS')).toBe(true);
    expect(isThemeWord('medecine', 'RENARD')).toBe(false);
  });

  test('sports : noms de sports, jargon (même hors liste libre) et verbes conjugués', () => {
    for (const w of ['BADMINTON', 'CURLING', 'TACLE', 'STRIKE', 'GOAL', 'BORDER', 'CROCHET', 'CARTON', 'BIRDIE', 'SCHUSS'])
      expect(isThemeWord('sports', w), w).toBe(true);
    for (const w of ['BOXONS', 'LANCAIT', 'NAGEONS', 'SAUTERA', 'SURFE', 'COURONS', 'COURRAIT', 'BATTU', 'TACLEE'])
      expect(isThemeWord('sports', w), w).toBe(true);
    // tous les temps simples, mais pas d'homographes tirés de radicaux irréguliers
    for (const w of ['TACLAT', 'SMASHAMES', 'NAGEASSENT', 'BONDIRENT']) expect(isThemeWord('sports', w), w).toBe(true);
    for (const w of ['COUT', 'BONS']) expect(isThemeWord('sports', w), w).toBe(false);
  });

  test('jargon hors des listes du jeu : accepté dans le thème, conjugaisons comprises', () => {
    for (const w of ['LOLOTTE', 'LOLOTTES', 'LOLOTTAIT', 'OLLIE', 'OLLIES', 'DUNK', 'DUNKERA', 'DUNKASSE', 'PANENKA', 'KICKFLIP'])
      expect(isThemeWord('sports', w), w).toBe(true);
    expect(isThemeWord('jeux', 'LOOTER')).toBe(true);
    expect(isThemeWord('nature', 'DUNK')).toBe(false);
  });

  test('les verbes des autres thèmes comptent aussi conjugués', () => {
    expect(isThemeWord('culture', 'CHANTONS')).toBe(true);
    expect(isThemeWord('nature', 'FLEURISSAIT')).toBe(true);
    expect(isThemeWord('medecine', 'SOIGNERA')).toBe(true);
    expect(isThemeWord('jeux', 'TRICHAIT')).toBe(true);
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

  test('en ligne, le serveur accepte les mots du thème absents de la liste', async () => {
    const asked: string[][] = [];
    const games = new Games({ send: () => {}, changed: () => {}, invalidWords: (w) => { asked.push(w); return w; } });
    const a = games.join('ABC234', 'a'.repeat(32), true);
    if ('close' in a) throw new Error();
    await games.message(a.room, 0, { type: 'hello', name: 'A', options: { variant: null, theme: 'sports' } });
    const b = games.join('ABC234', 'b'.repeat(32), false);
    if ('close' in b) throw new Error();
    await games.message(b.room, 1, { type: 'hello', name: 'B' });
    const s = a.room.state!;
    s.players[s.current].rack = ['D', 'U', 'N', 'K', 'E', 'S', 'R'];
    const dunk = [..."DUNK"].map((letter, i) => ({ r: 7, c: 6 + i, letter, blank: false }));
    await games.message(a.room, s.current, { type: 'action', action: { type: 'play', placements: dunk } });
    expect(asked).toEqual([]);
    expect(s.history[0].text).toContain('DUNK');
  });
});
