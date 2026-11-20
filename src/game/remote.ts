import { BLANK, RACK_SIZE, SIZE } from './constants';
import { evaluatePlacement } from './rules';
import { exchange, pass, playMove, type GameState } from './game';
import type { Placement } from './types';

/** Action envoyée par un joueur distant. L'hôte la vérifie entièrement avant de l'appliquer. */
export type Action =
  | { type: 'play'; placements: Placement[] }
  | { type: 'exchange'; letters: string[] }
  | { type: 'pass' };

const isLetter = (l: unknown): l is string => typeof l === 'string' && /^[A-Z]$/.test(l);
const isRackLetter = (l: unknown): l is string => l === BLANK || isLetter(l);
const isCoord = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < SIZE;

/** Valide la forme d'un message reçu du réseau ; renvoie null s'il est mal formé. */
export function parseAction(x: unknown): Action | null {
  if (!x || typeof x !== 'object') return null;
  const a = x as Record<string, unknown>;
  if (a.type === 'pass') return { type: 'pass' };
  if (a.type === 'exchange') {
    const ls = a.letters;
    if (!Array.isArray(ls) || ls.length < 1 || ls.length > RACK_SIZE || !ls.every(isRackLetter)) return null;
    return { type: 'exchange', letters: [...ls] };
  }
  if (a.type === 'play') {
    const ps = a.placements;
    if (!Array.isArray(ps) || ps.length < 1 || ps.length > RACK_SIZE) return null;
    const out: Placement[] = [];
    for (const p of ps) {
      if (!p || typeof p !== 'object') return null;
      const { r, c, letter, blank } = p as Record<string, unknown>;
      if (!isCoord(r) || !isCoord(c) || !isLetter(letter) || typeof blank !== 'boolean') return null;
      out.push({ r, c, letter, blank });
    }
    return { type: 'play', placements: out };
  }
  return null;
}

/** Vrai si `letters` peut être prélevé dans `rack` (multiensemble). */
function rackHas(rack: string[], letters: string[]): boolean {
  const left = [...rack];
  for (const l of letters) {
    const i = left.indexOf(l);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/**
 * Applique l'action du joueur `player` si elle est légale.
 * Renvoie null en cas de succès, sinon un message d'erreur (l'état n'est alors pas modifié).
 */
export async function applyAction(
  s: GameState, player: 0 | 1, action: Action,
  invalidWords: (words: string[]) => Promise<string[]>,
): Promise<string | null> {
  if (s.over) return 'La partie est terminée.';
  if (s.current !== player) return 'Ce n’est pas votre tour.';
  const rack = s.players[player].rack;

  if (action.type === 'pass') { pass(s); return null; }

  if (action.type === 'exchange') {
    if (s.bag.length < RACK_SIZE) return 'Échange impossible : moins de 7 jetons dans le sac.';
    if (!rackHas(rack, action.letters)) return 'Ces lettres ne sont pas sur votre chevalet.';
    exchange(s, action.letters);
    return null;
  }

  const ps = action.placements;
  if (!rackHas(rack, ps.map((p) => (p.blank ? BLANK : p.letter)))) return 'Ces lettres ne sont pas sur votre chevalet.';
  const res = evaluatePlacement(s.board, ps);
  if (!res.ok) return res.error;
  const turn = s.history.length;
  const invalid = await invalidWords(res.words.map((w) => w.word));
  if (invalid.length) return `Mot${invalid.length > 1 ? 's' : ''} refusé${invalid.length > 1 ? 's' : ''} par le dictionnaire de l’hôte : ${invalid.join(', ')}`;
  if (s.history.length !== turn || s.current !== player || s.over) return 'La partie a changé entre-temps.';
  playMove(s, { placements: ps, words: res.words, score: res.score });
  return null;
}

/** Copie de l'état visible par `player` : chevalet adverse et ordre du sac masqués tant que la partie dure. */
export function viewFor(s: GameState, player: 0 | 1): GameState {
  const v: GameState = structuredClone(s);
  if (s.over) return v;
  const other = v.players[player === 0 ? 1 : 0];
  other.rack = other.rack.map(() => '');
  v.bag = v.bag.map(() => '');
  return v;
}
