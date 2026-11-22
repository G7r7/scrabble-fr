import { BLANK, RACK_SIZE, SIZE } from './constants';
import { applyPlacements, emptyBoard } from './board';
import { draw, newBag, shuffle } from './bag';
import { rackValue } from './rules';
import type { Board, FormedWord, Move } from './types';
import type { Level } from '../ai/player';
import { applyTheme, type ThemeId } from './themes';
import type { GameDict, Lexicon } from './dicts';
import { newClock, WRONG_CHALLENGE_PENALTY, type Clock } from './clock';

export type Variant = 'challenge' | 'hardcore' | 'tournoi';
export const VARIANTS: { id: Variant | 'normal'; label: string; help: string }[] = [
  { id: 'normal', label: 'Normal', help: 'Les mots sont vérifiés avant d’être joués.' },
  { id: 'challenge', label: 'Challenge', help: 'Aucune vérification avant de jouer : l’adversaire accepte le coup ou le conteste.' },
  { id: 'hardcore', label: 'Hardcore', help: 'Chaque coup est contrôlé d’office : un mot refusé coûte 10 points et le tour.' },
  { id: 'tournoi', label: 'Compétition', help: 'Règles de tournoi (FISF) : pendule pour chaque joueur, contestation des mots, 5 points de pénalité par mot contesté à tort.' },
];
export const HARDCORE_PENALTY = 10;

export interface Player { name: string; rack: string[]; score: number; isAi: boolean }

export interface HistoryEntry {
  player: number;
  kind: 'play' | 'exchange' | 'pass' | 'invalid' | 'challenge' | 'end';
  text: string;
  score: number;
  /** Coup soumis au jugement de l'adversaire qui l'a contesté (mode challenge). */
  challenged?: boolean;
}

/** Mode challenge : coup posé, en attente de la décision de l'adversaire. */
export interface Proposal { player: 0 | 1; move: Move }

export interface GameState {
  board: Board;
  bag: string[];
  players: [Player, Player];
  current: 0 | 1;
  scorelessTurns: number;
  over: boolean;
  history: HistoryEntry[];
  level: Level;
  lastMove: [number, number][];
  /** Mots formés par le dernier coup, avec leur score (pour l'animation du décompte). */
  lastWords?: FormedWord[];
  /** Partie en ligne entre deux humains (pas d'ordinateur, pas de sauvegarde locale). */
  online?: boolean;
  /**
   * Variante (absente = normale : un mot refusé est simplement rejeté, on rejoue).
   * - challenge : on ne sait pas si un mot est valide avant de le jouer ; l'adversaire accepte ou conteste.
   * - hardcore : chaque coup est contrôlé d'office ; un mot refusé coûte 10 points et le tour.
   */
  variant?: Variant;
  /** Mode compétition : pendule de tournoi. */
  clock?: Clock;
  /** Liste de mots de la partie (absente = liste libre). */
  dict?: GameDict;
  /** Liste perso : le modèle (`dict`) plus les mots ajoutés et retirés, figés au début de la partie. */
  lexicon?: Lexicon;
  /** Mode fantasy : thème de la partie (ses mots rapportent double). */
  theme?: ThemeId;
  /** Mode fantasy : cases des mots du thème déjà joués (elles chatoient). */
  themeCells?: number[];
  /** Mode challenge : coup posé que l'adversaire doit accepter ou contester. */
  proposal?: Proposal | null;
}

export const HUMAN = 0, AI = 1;
const MAX_SCORELESS = 6;

export function newGame(level: Level, online?: { names: [string, string] } | null, opts: { variant?: Variant | null; theme?: ThemeId | null; dict?: GameDict | null; lexicon?: Lexicon | null; minutes?: number; now?: number } = {}): GameState {
  const bag = newBag();
  const [n0, n1] = online?.names ?? ['Vous', 'Ordinateur'];
  const players: [Player, Player] = [
    { name: n0, rack: draw(bag, RACK_SIZE), score: 0, isAi: false },
    { name: n1, rack: draw(bag, RACK_SIZE), score: 0, isAi: !online },
  ];
  const current: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
  return {
    board: emptyBoard(), bag, players,
    current,
    scorelessTurns: 0, over: false, history: [], level, lastMove: [],
    ...(online ? { online: true } : {}),
    ...(opts.variant ? { variant: opts.variant } : {}),
    ...(opts.theme ? { theme: opts.theme } : {}),
    ...(opts.lexicon ? { dict: opts.lexicon.base, lexicon: opts.lexicon }
      : opts.dict && opts.dict !== 'libre' ? { dict: opts.dict } : {}),
    ...(opts.variant === 'tournoi' ? { clock: newClock(opts.minutes ?? 20, current, opts.now ?? Date.now()) } : {}),
  };
}

function removeFromRack(rack: string[], letters: string[]) {
  for (const l of letters) {
    const i = rack.indexOf(l);
    if (i < 0) throw new Error(`Lettre absente du chevalet : ${l}`);
    rack.splice(i, 1);
  }
}

function nextTurn(s: GameState) {
  s.current = s.current === 0 ? 1 : 0;
}

export function playMove(s: GameState, move: Move) {
  move = applyTheme(s.theme, move);
  const p = s.players[s.current];
  removeFromRack(p.rack, move.placements.map((x) => (x.blank ? BLANK : x.letter)));
  applyPlacements(s.board, move.placements);
  p.score += move.score;
  p.rack.push(...draw(s.bag, RACK_SIZE - p.rack.length));
  s.scorelessTurns = 0;
  s.lastMove = move.placements.map((x) => [x.r, x.c]);
  s.lastWords = move.words;
  const words = move.words.map((w) => (w.themed ? `${w.word} ✦` : w.word)).join(', ');
  if (s.theme) {
    const cells = new Set(s.themeCells ?? []);
    for (const w of move.words) if (w.themed) for (const [r, c] of w.cells) cells.add(r * SIZE + c);
    s.themeCells = [...cells];
  }
  s.history.push({
    player: s.current, kind: 'play', score: move.score,
    text: move.placements.length === RACK_SIZE ? `${words} — Scrabble !` : words,
  });

  if (p.rack.length === 0 && s.bag.length === 0) {
    // Le joueur qui termine gagne la valeur des lettres de l'adversaire.
    const other = s.players[s.current === 0 ? 1 : 0];
    const v = rackValue(other.rack);
    other.score -= v;
    p.score += v;
    s.history.push({ player: s.current, kind: 'end', score: v, text: `Fin de partie : +${v} (lettres restantes de ${s.online ? other.name : other.name.toLowerCase()})` });
    s.over = true;
    return;
  }
  nextTurn(s);
}

export function exchange(s: GameState, letters: string[]) {
  if (s.bag.length < RACK_SIZE) throw new Error('Échange impossible : moins de 7 jetons dans le sac.');
  const p = s.players[s.current];
  removeFromRack(p.rack, letters);
  p.rack.push(...draw(s.bag, letters.length));
  s.bag.push(...letters);
  shuffle(s.bag);
  s.history.push({ player: s.current, kind: 'exchange', score: 0, text: `Échange de ${letters.length} lettre${letters.length > 1 ? 's' : ''}` });
  // En compétition, seuls les « je passe » comptent pour le refus de jeu : changer des lettres n'est pas passer.
  if (s.variant === 'tournoi') s.scorelessTurns = -1;
  scoreless(s);
}

/**
 * Le coup contenait des mots refusés : les lettres reviennent sur le chevalet et le tour est perdu
 * (après un challenge réussi, ou en mode hardcore avec une pénalité).
 */
export function refuse(s: GameState, invalid: string[], penalty = 0) {
  const n = invalid.length;
  s.players[s.current].score -= penalty;
  s.history.push({
    player: s.current, kind: 'invalid', score: -penalty, ...(penalty ? {} : { challenged: true }),
    text: `Mot${n > 1 ? 's' : ''} refusé${n > 1 ? 's' : ''} : ${invalid.join(', ')} — ${penalty ? `−${penalty} points, ` : ''}tour perdu`,
  });
  scoreless(s);
}

/** Mode challenge : le joueur pose son coup, sans savoir s'il est valide ; l'adversaire va trancher. */
export function propose(s: GameState, move: Move) {
  s.proposal = { player: s.current, move };
}

/** L'adversaire accepte le coup proposé. */
export function accept(s: GameState) {
  const p = s.proposal;
  if (!p) throw new Error('Aucun coup à accepter');
  s.proposal = null;
  playMove(s, p.move);
}

/**
 * L'adversaire conteste le coup proposé. `invalid` : mots refusés par le dictionnaire.
 * Challenge réussi : le coup est annulé et son auteur perd son tour.
 * Challenge raté : le coup compte et c'est celui qui a contesté qui perd son tour.
 */
export function challenge(s: GameState, invalid: string[], contested?: string[]) {
  const p = s.proposal;
  if (!p) throw new Error('Aucun coup à contester');
  if (s.variant === 'tournoi') return challengeTournoi(s, invalid, contested ?? p.move.words.map((w) => w.word));
  s.proposal = null;
  if (invalid.length) return refuse(s, invalid);
  playMove(s, p.move);
  for (let i = s.history.length - 1; i >= 0; i--) {
    if (s.history[i].kind === 'play') { s.history[i].challenged = true; break; }
  }
  if (s.over) return;
  s.history.push({ player: s.current, kind: 'challenge', score: 0, challenged: true, text: 'Challenge raté — tour perdu' });
  nextTurn(s);
}

/**
 * Contestation selon le règlement de tournoi (§ 3.5.3) : si un mot contesté est refusé, l'auteur reprend ses
 * lettres et passe ; chaque mot contesté à tort coûte 5 points au contestataire ; dans tous les cas, c'est
 * ensuite au contestataire de jouer (il ne perd pas son tour).
 */
function challengeTournoi(s: GameState, invalid: string[], contested: string[]) {
  const p = s.proposal!;
  const challenger: 0 | 1 = p.player === 0 ? 1 : 0;
  const wrong = contested.filter((w) => !invalid.includes(w)).length;
  s.proposal = null;
  if (invalid.length) refuse(s, invalid);
  else {
    playMove(s, p.move);
    for (let i = s.history.length - 1; i >= 0; i--) {
      if (s.history[i].kind === 'play') { s.history[i].challenged = true; break; }
    }
  }
  if (wrong) {
    const pen = wrong * WRONG_CHALLENGE_PENALTY;
    s.players[challenger].score -= pen;
    s.history.push({
      player: challenger, kind: 'challenge', score: -pen, challenged: true,
      text: `Contestation à tort (${wrong} mot${wrong > 1 ? 's' : ''}) : −${pen} points`,
    });
  }
}

export function pass(s: GameState, text = 'Passe') {
  s.history.push({ player: s.current, kind: 'pass', score: 0, text });
  scoreless(s);
}

function scoreless(s: GameState) {
  s.scorelessTurns++;
  s.lastMove = [];
  s.lastWords = [];
  if (s.scorelessTurns >= MAX_SCORELESS) {
    for (const p of s.players) p.score -= rackValue(p.rack);
    s.history.push({ player: s.current, kind: 'end', score: 0, text: 'Fin de partie : 6 tours sans point' });
    s.over = true;
    return;
  }
  nextTurn(s);
}

/** Résultat vu par le joueur `me`. */
export function winnerText(s: GameState, me: 0 | 1 = 0): string {
  const h = s.players[me], a = s.players[me === 0 ? 1 : 0];
  if (h.score > a.score) return `Victoire ! ${h.score} à ${a.score}`;
  if (h.score < a.score) return `Défaite… ${h.score} à ${a.score}`;
  return `Égalité : ${h.score} partout`;
}

const SAVE_KEY = 'scrabble-fr-partie';
export function saveGame(s: GameState) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* stockage indisponible */ }
}
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch { return null; }
}
