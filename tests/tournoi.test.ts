import { describe, expect, test } from 'vitest';
import { exchange, newGame, pass } from '../src/game/game';
import { applyAction } from '../src/game/remote';
import { clockUpdate, settleTime, timeLeft } from '../src/game/clock';

const dict = (bad: string[]) => async (w: string[]) => w.filter((x) => bad.includes(x));
const T0 = 1_000_000;
const setup = () => {
  const g = newGame('moyen', { names: ['Alice', 'Bob'] }, { variant: 'tournoi', minutes: 20, now: T0 });
  g.current = 0;
  g.clock!.runner = 0;
  g.players[0].rack = ['C', 'H', 'A', 'T', 'E', 'S', 'R'];
  return g;
};
// CHAT au centre, puis un S en bas du T : forme CHATS ? non — on forme deux mots avec un coup en croix plus loin.
const chat = [..."CHAT"].map((letter, i) => ({ r: 7, c: 6 + i, letter, blank: false }));

describe('mode compétition (règlement FISF)', () => {
  test('contestation à tort : 5 points de pénalité par mot, et c’est au contestataire de jouer', async () => {
    const g = setup();
    await applyAction(g, 0, { type: 'play', placements: chat }, dict([]));
    expect(g.proposal?.player).toBe(0);
    expect(await applyAction(g, 1, { type: 'challenge', words: ['CHAT'] }, dict([]))).toBeNull();
    expect(g.board[7][7]?.letter).toBe('H');
    expect(g.players[0].score).toBeGreaterThan(0);
    expect(g.players[1].score).toBe(-5);
    expect(g.current).toBe(1); // Bob joue : il ne perd pas son tour
    expect(g.history.at(-1)).toMatchObject({ kind: 'challenge', player: 1, score: -5 });
  });

  test('contestation réussie : l’auteur reprend ses lettres et passe, sans pénalité pour le contestataire', async () => {
    const g = setup();
    await applyAction(g, 0, { type: 'play', placements: chat }, dict([]));
    expect(await applyAction(g, 1, { type: 'challenge' }, dict(['CHAT']))).toBeNull();
    expect(g.board[7][7]).toBeNull();
    expect(g.players[0].rack).toHaveLength(7);
    expect(g.players.map((p) => p.score)).toEqual([0, 0]);
    expect(g.current).toBe(1);
  });

  test('on ne peut contester que des mots du coup', async () => {
    const g = setup();
    await applyAction(g, 0, { type: 'play', placements: chat }, dict([]));
    expect(await applyAction(g, 1, { type: 'challenge', words: ['ZEBRE'] }, dict([]))).toMatch(/ne font pas partie/);
  });

  test('pendule : seul le joueur au trait consomme son temps ; après un coup, c’est l’adversaire', async () => {
    const g = setup();
    expect(timeLeft(g, 0, T0 + 60_000)).toBe(19 * 60_000);
    expect(timeLeft(g, 1, T0 + 60_000)).toBe(20 * 60_000);
    await applyAction(g, 0, { type: 'play', placements: chat }, dict([]));
    clockUpdate(g, T0 + 60_000);
    expect(g.clock!.runner).toBe(1); // Bob décide d'accepter ou de contester : sa pendule tourne
    expect(timeLeft(g, 1, T0 + 90_000)).toBe(20 * 60_000 - 30_000);
  });

  test('temps épuisé : le joueur passe automatiquement ; les deux épuisés : fin de partie', () => {
    const g = setup();
    expect(settleTime(g, T0 + 20 * 60_000 + 1)).toBe(true);
    expect(g.history.at(-1)).toMatchObject({ kind: 'pass', player: 0, text: 'Temps écoulé : passe' });
    expect(g.current).toBe(1);
    expect(g.over).toBe(false);
    expect(settleTime(g, T0 + 40 * 60_000 + 2)).toBe(true);
    expect(g.over).toBe(true);
    expect(g.history.at(-1)?.text).toMatch(/temps écoulé/);
  });

  test('changer des lettres n’est pas passer (refus de jeu : 6 « je passe » consécutifs)', () => {
    const g = setup();
    pass(g); pass(g); pass(g); pass(g); pass(g);
    exchange(g, [g.players[g.current].rack[0]]);
    expect(g.over).toBe(false);
    for (let i = 0; i < 5; i++) pass(g);
    expect(g.over).toBe(false);
    pass(g);
    expect(g.over).toBe(true);
  });

  test('pas d’échange quand le temps de l’adversaire est écoulé', async () => {
    const g = setup();
    g.clock!.used[1] = g.clock!.limit; // Bob n'a plus de temps
    expect(await applyAction(g, 0, { type: 'exchange', letters: ['C'] }, dict([]))).toMatch(/temps de votre adversaire/);
  });
});
