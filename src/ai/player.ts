import { BLANK, VOWELS, letterValue } from '../game/constants';
import type { Board, Move } from '../game/types';
import type { Dawg } from '../dict/dawg';
import { generateMoves } from './movegen';

export type Level = 'facile' | 'moyen' | 'difficile';

export type AiDecision =
  | { kind: 'play'; move: Move }
  | { kind: 'exchange'; letters: string[] }
  | { kind: 'pass' };

/** Valeur approximative des lettres gardées sur le chevalet. */
export function leaveValue(leave: string[]): number {
  let v = 0;
  const seen = new Map<string, number>();
  let vowels = 0, cons = 0;
  for (const l of leave) {
    seen.set(l, (seen.get(l) ?? 0) + 1);
    if (l === BLANK) { v += 12; continue; }
    if (l === 'S') v += seen.get('S') === 1 ? 6 : 1;
    if (VOWELS.has(l)) vowels++; else cons++;
    if (letterValue(l) >= 8) v -= 3;
  }
  for (const [l, n] of seen) if (l !== BLANK && n > 1) v -= 3 * (n - 1);
  if (leave.length) v -= 2 * Math.abs(vowels - cons);
  return v;
}

function leaveAfter(rack: string[], move: Move): string[] {
  const left = [...rack];
  for (const p of move.placements) {
    const i = left.indexOf(p.blank ? BLANK : p.letter);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

export function chooseMove(
  dawg: Dawg, board: Board, rack: string[], bagSize: number, level: Level, rng = Math.random,
): AiDecision {
  const moves = generateMoves(dawg, board, rack).sort((a, b) => b.score - a.score);
  if (moves.length === 0) {
    if (bagSize >= 7) {
      // On rejette les lettres qui gênent : doublons, lettres chères, excès de voyelles.
      const keep = [...rack].sort((a, b) => leaveValue([b]) - leaveValue([a]));
      const letters = keep.slice(Math.min(2, keep.length));
      return { kind: 'exchange', letters };
    }
    return { kind: 'pass' };
  }

  let move: Move;
  if (level === 'difficile') {
    const w = bagSize > 0 ? 1 : 0; // en fin de partie, seul le score compte
    move = moves
      .slice(0, 200)
      .reduce((best, m) =>
        m.score + w * leaveValue(leaveAfter(rack, m)) > best.score + w * leaveValue(leaveAfter(rack, best)) ? m : best);
  } else if (level === 'moyen') {
    const top = moves.slice(0, Math.max(1, Math.min(8, Math.ceil(moves.length * 0.2))));
    move = top[Math.floor(rng() * top.length)];
  } else {
    // Facile : un coup modeste, pris dans la moitié basse, plutôt court.
    const pool = moves.slice(Math.floor(moves.length / 2)).filter((m) => m.placements.length <= 4);
    const src = pool.length ? pool : moves;
    move = src[Math.floor(rng() * src.length)];
  }
  return { kind: 'play', move };
}
