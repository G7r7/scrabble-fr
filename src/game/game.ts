import { BLANK, RACK_SIZE } from './constants';
import { applyPlacements, emptyBoard } from './board';
import { draw, newBag, shuffle } from './bag';
import { rackValue } from './rules';
import type { Board, Move } from './types';
import type { Level } from '../ai/player';

export interface Player { name: string; rack: string[]; score: number; isAi: boolean }

export interface HistoryEntry {
  player: number;
  kind: 'play' | 'exchange' | 'pass' | 'end';
  text: string;
  score: number;
}

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
}

export const HUMAN = 0, AI = 1;
const MAX_SCORELESS = 6;

export function newGame(level: Level): GameState {
  const bag = newBag();
  const players: [Player, Player] = [
    { name: 'Vous', rack: draw(bag, RACK_SIZE), score: 0, isAi: false },
    { name: 'Ordinateur', rack: draw(bag, RACK_SIZE), score: 0, isAi: true },
  ];
  return {
    board: emptyBoard(), bag, players,
    current: Math.random() < 0.5 ? 0 : 1,
    scorelessTurns: 0, over: false, history: [], level, lastMove: [],
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
  const p = s.players[s.current];
  removeFromRack(p.rack, move.placements.map((x) => (x.blank ? BLANK : x.letter)));
  applyPlacements(s.board, move.placements);
  p.score += move.score;
  p.rack.push(...draw(s.bag, RACK_SIZE - p.rack.length));
  s.scorelessTurns = 0;
  s.lastMove = move.placements.map((x) => [x.r, x.c]);
  const words = move.words.map((w) => w.word).join(', ');
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
    s.history.push({ player: s.current, kind: 'end', score: v, text: `Fin de partie : +${v} (lettres restantes de ${other.name.toLowerCase()})` });
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
  scoreless(s);
}

export function pass(s: GameState) {
  s.history.push({ player: s.current, kind: 'pass', score: 0, text: 'Passe' });
  scoreless(s);
}

function scoreless(s: GameState) {
  s.scorelessTurns++;
  s.lastMove = [];
  if (s.scorelessTurns >= MAX_SCORELESS) {
    for (const p of s.players) p.score -= rackValue(p.rack);
    s.history.push({ player: s.current, kind: 'end', score: 0, text: 'Fin de partie : 6 tours sans point' });
    s.over = true;
    return;
  }
  nextTurn(s);
}

export function winnerText(s: GameState): string {
  const [h, a] = s.players;
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
