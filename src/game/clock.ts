// Mode compétition : pendule de tournoi (règlement international du Scrabble classique, FISF/FFSc).
// Chaque joueur dispose d'un crédit-temps pour toute la partie. La pendule de celui qui doit agir tourne :
// le joueur au trait, ou, quand un coup vient d'être posé, son adversaire (qui accepte ou conteste puis joue).
// Temps épuisé : le joueur passe systématiquement son tour ; si les deux temps sont épuisés, la partie
// s'arrête et chacun défalque la valeur de ses lettres.
import { accept, pass, type GameState } from './game';
import { rackValue } from './rules';

export interface Clock {
  /** Crédit-temps de chaque joueur (ms). */
  limit: number;
  /** Temps déjà consommé par chaque joueur (ms), arrêté à `since`. */
  used: [number, number];
  /** Joueur dont la pendule tourne depuis `since` (horodatage en ms). */
  runner: 0 | 1 | null;
  since: number;
}

/** Durées proposées (minutes par joueur) ; le règlement laisse ce choix à l'organisateur. */
export const CLOCK_MINUTES = [15, 20, 25, 30] as const;
export const DEFAULT_MINUTES = 20;
/** Pénalité par mot contesté à tort (règlement, § 3.5.3). */
export const WRONG_CHALLENGE_PENALTY = 5;

export function newClock(minutes: number, current: 0 | 1, now: number): Clock {
  return { limit: minutes * 60_000, used: [0, 0], runner: current, since: now };
}

/** Joueur dont la pendule doit tourner. */
export function clockRunner(s: GameState): 0 | 1 | null {
  if (s.over) return null;
  if (s.proposal) return s.proposal.player === 0 ? 1 : 0;
  return s.current;
}

/** À appeler après chaque changement de la partie : le temps écoulé est imputé à celui dont la pendule tournait. */
export function clockUpdate(s: GameState, now: number) {
  const c = s.clock;
  if (!c) return;
  if (c.runner !== null) c.used[c.runner] += Math.max(0, now - c.since);
  c.runner = clockRunner(s);
  c.since = now;
}

/** Temps restant du joueur `p` (ms, jamais négatif). */
export function timeLeft(s: GameState, p: 0 | 1, now: number): number {
  const c = s.clock;
  if (!c) return Infinity;
  const used = c.used[p] + (c.runner === p ? Math.max(0, now - c.since) : 0);
  return Math.max(0, c.limit - used);
}
export const timedOut = (s: GameState, p: 0 | 1, now: number) => !!s.clock && timeLeft(s, p, now) <= 0;

/** Délai avant le prochain dépassement possible (ms), ou null si aucune pendule ne tourne. */
export function nextTimeout(s: GameState, now: number): number | null {
  const r = s.clock && !s.over ? s.clock.runner : null;
  return r === null ? null : timeLeft(s, r, now);
}

/**
 * Applique les règles du temps épuisé : le joueur concerné passe (ou, s'il devait juger un coup, l'accepte),
 * et si les deux temps sont épuisés la partie s'arrête. Renvoie vrai si la partie a changé.
 */
export function settleTime(s: GameState, now: number): boolean {
  if (!s.clock || s.over) return false;
  clockUpdate(s, now);
  let changed = false;
  for (let guard = 0; guard < 6 && !s.over; guard++) {
    if (timedOut(s, 0, now) && timedOut(s, 1, now)) {
      for (const p of s.players) p.score -= rackValue(p.rack);
      s.history.push({ player: s.current, kind: 'end', score: 0, text: 'Fin de partie : temps écoulé pour les deux joueurs' });
      s.over = true;
      s.proposal = null;
      changed = true;
      break;
    }
    const r = clockRunner(s);
    if (r === null || !timedOut(s, r, now)) break;
    if (s.proposal) accept(s); else pass(s, 'Temps écoulé : passe');
    clockUpdate(s, now);
    changed = true;
  }
  if (s.over && s.clock) clockUpdate(s, now);
  return changed;
}
