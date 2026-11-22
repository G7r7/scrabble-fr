import { describe, expect, test } from 'vitest';
import { applyLexicon, cleanLexicon, lexiconKey } from '../src/game/dicts';
import { newGame } from '../src/game/game';
import { Games } from '../server/games';

describe('listes perso (modèle + différences)', () => {
  test('appliquer les mots ajoutés et retirés au modèle', () => {
    const l = { name: 'Ma liste', base: 'courant' as const, add: ['ZOUK'], remove: ['CHAT'] };
    expect(applyLexicon(['ABRI', 'CHAT', 'DENT'], l)).toEqual(['ABRI', 'DENT', 'ZOUK']);
    expect(lexiconKey(l)).not.toBe(lexiconKey({ ...l, add: ['ZOUKS'] }));
  });

  test('nettoyage : mots normalisés, doublons, modèle connu, limite', () => {
    expect(cleanLexicon({ name: 'x', base: 'libre', add: ['ZOUK', 'ZOUK', 'zouk', '<b>'], remove: [] })).toEqual({ name: 'x', base: 'libre', add: ['ZOUK'], remove: [] });
    expect(cleanLexicon({ name: 'x', base: 'ods', add: [], remove: [] })).toBeNull();
    expect(cleanLexicon({ name: 'x', base: 'libre', add: ['ABRI', 'DENT'], remove: [] }, 1)).toBeNull();
  });

  test('la partie garde seulement le modèle et les différences', () => {
    const g = newGame('moyen', null, { lexicon: { name: 'Ma liste', base: 'etendu', add: ['ZOUK'], remove: [] } });
    expect(g.dict).toBe('etendu');
    expect(g.lexicon).toEqual({ name: 'Ma liste', base: 'etendu', add: ['ZOUK'], remove: [] });
  });

  test('en ligne, le serveur arbitre avec le modèle corrigé par la liste perso', async () => {
    const calls: unknown[] = [];
    const games = new Games({ send: () => {}, changed: () => {}, invalidWords: (w, dict, lex) => { calls.push([dict, lex]); return []; } });
    const a = games.join('ABC234', 'a'.repeat(32), true);
    if ('close' in a) throw new Error();
    await games.message(a.room, 0, { type: 'hello', name: 'A', options: { variant: null, dict: 'libre', lexicon: { name: 'Perso', base: 'complet', add: ['ZOUK'], remove: ['CHAT'] } } });
    const b = games.join('ABC234', 'b'.repeat(32), false);
    if ('close' in b) throw new Error();
    await games.message(b.room, 1, { type: 'hello', name: 'B' });
    const s = a.room.state!;
    expect(s.dict).toBe('complet');
    expect(s.lexicon?.add).toEqual(['ZOUK']);
    s.players[s.current].rack = ['C', 'H', 'A', 'T', 'E', 'S', 'R'];
    const chat = [..."CHAT"].map((letter, i) => ({ r: 7, c: 6 + i, letter, blank: false }));
    await games.message(a.room, s.current, { type: 'action', action: { type: 'play', placements: chat } });
    expect(calls[0]).toEqual(['complet', { name: 'Perso', base: 'complet', add: ['ZOUK'], remove: ['CHAT'] }]);
  });
});
