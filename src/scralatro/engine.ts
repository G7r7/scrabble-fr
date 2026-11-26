// SCRALATRO : moteur du mode de jeu (logique pure, sans interface).
// Le plateau et les tuiles du Scrabble, les objectifs de score, les tuiles pouvoir et le magasin d'un jeu de deck-building.
import { BONUS, CENTER, LETTERS, SIZE } from '../game/constants';
import { isThemeWord } from '../game/themes';
import {
  CELL_TEX, CELL_TYPES, EDITIONS, ENGLISH, FONTS, MAX_POWERS, PASTILLES, POWERS, POWER_IDS, POWER_PRICE, PROGRAMS,
  PROGRAM_IDS, PROGRAM_PRICE, RARITY_WEIGHT, SPECIALS, SPECIAL_IDS, STYLES, TEXTURES, UPGRADE_PRICE,
  type CellTex, type CellType, type Edition, type Font, type Mode, type Pastille, type PowerId, type ProgramId,
  type SpecialId, type Style, type Texture,
} from './data';

// ---------- Hasard (remplaçable dans les tests) ----------
let rand: () => number = Math.random;
export function setRandom(f: () => number) { rand = f; }
const ri = (n: number) => Math.floor(rand() * n);
const pick = <T>(a: readonly T[]): T => a[ri(a.length)];
const chance = (p: number) => rand() < p;
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rand() * total;
  for (const [v, w] of items) { if ((x -= w) < 0) return v; }
  return items[items.length - 1][0];
}
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- Types ----------
export interface Cell { t?: CellType; x?: CellTex; o?: 0 | 1; rnd?: 'MD' | 'MT' | 'LD' | 'LT' }
export interface STile {
  id: number;
  /** Lettre ; '?' : joker ; '#' : verrou. */
  l: string;
  bonus: number;
  tex?: Texture; ed?: Edition; font?: Font;
  /** Police infection : joueur qui l'a infectée. */
  inf?: 0 | 1;
  pas: Pastille[]; sty: Style[];
  /** Papier : nombre de fois où la tuile a été posée. */
  wear?: number;
  own: 0 | 1;
  /** Joker posé : lettre choisie. */
  as?: string;
}
export interface PowerInst { uid: number; id: PowerId; price: number; /** compteur (verre détruit, lettres ajoutées…) */ n: number }
export interface LevelState {
  n: number; special: SpecialId | null; target: number; moves: number;
  /** Coups joués (en compétition : tours du joueur dans ce niveau). */
  used: number; score: number;
  /** Gamma : une lettre K, W, X, Y ou Z a été jouée. */
  gamma: boolean;
  /** Nu : un coup avec des tuiles posées n'a pas atteint l'objectif. */
  nuFail?: boolean;
}
export type Offer =
  | { kind: 'tile'; tile: STile }
  | { kind: 'cell'; cell: Cell }
  | { kind: 'power'; id: PowerId }
  | { kind: 'program'; id: ProgramId }
  | { kind: 'upgrade'; letter: string };
export type PackKind = 'tile' | 'cell' | 'power' | 'program' | 'upgrade';
export type ShopItem = (Offer | { kind: 'pack'; of: PackKind; size: 3 | 6 }) & { price: number; sold?: boolean };
export interface Shop { items: ShopItem[]; reroll: number; bought: boolean }
export type Pending =
  | { type: 'choose'; title: string; offers: Offer[] }
  | { type: 'cell'; cell: Cell }
  | { type: 'program'; id: ProgramId; fromReserve: boolean; drawn: STile[] };

export interface SPlayer {
  name: string;
  bag: STile[]; rack: STile[];
  powers: PowerInst[];
  money: number;
  reserve: ProgramId | null; lastProgram: ProgramId | null;
  /** Améliorations de lettre : bonus de valeur de base par lettre. */
  up: Record<string, number>;
  /** Points marqués depuis le début de la partie. */
  total: number;
  /** Compétition : niveau propre au joueur et prochain niveau spécial. */
  lvl?: LevelState; next?: SpecialId;
  /** Par niveau : tours sans tuile posée, lettres défaussées, cancre utilisé, pouvoir vendu, premier coup joué. */
  muet: number; eboueur: number; cancre: boolean; sold: boolean; played: boolean;
  /** Cryptographe : décalage choisi pour ce niveau. */
  crypto: number | null;
  /** Début de tour : tuile imposée (Rhô), pouvoir annulé (Psi), voyelle de l'idole. */
  rho?: number; psi?: number; idole?: string;
  lastPlaced: number[];
  shop?: Shop;
}
export interface LogEntry { p: number; text: string; score?: number; kind?: 'play' | 'info' | 'level' | 'bad' }
export interface SGame {
  v: 1; mode: Mode;
  players: SPlayer[];
  cur: 0 | 1;
  board: (STile | null)[][];
  cells: Cell[][];
  /** Solo et coopération : niveau commun ; prochain niveau spécial. */
  lvl: LevelState; next: SpecialId;
  phase: 'shop' | 'play' | 'over';
  /** Joueurs qui doivent encore passer au magasin. */
  shopQueue: number[];
  pending: Pending | null; pendingFor: 0 | 1;
  /** Compétition : tours consécutifs sans pose, plateaux vidés. */
  idle: number; clears: number;
  won: boolean; continued: boolean; overText?: string;
  log: LogEntry[];
  seq: number;
}

// ---------- Constantes de jeu ----------
export const START_MONEY = 5;
export const REROLL_PRICE = 5;
export const LAST_LEVEL = 15;
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U', 'Y']);
export const isVowel = (l: string) => VOWELS.has(l);
const isConsonant = (l: string) => /^[A-Z]$/.test(l) && !VOWELS.has(l);

/** Objectif de score d'un niveau : progression géométrique, plus forte après le niveau 15. */
export function levelTarget(n: number, special: SpecialId | null): number {
  const base = n <= LAST_LEVEL ? 25 * 1.35 ** (n - 1) : 25 * 1.35 ** (LAST_LEVEL - 1) * 1.5 ** (n - LAST_LEVEL);
  const m = special === 'omega' ? 2.5 : special ? 1.5 : 1;
  const v = base * m;
  return v < 100 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10;
}
export const levelMoves = (n: number) => (n <= 2 ? 3 : 4);
export const isSpecialLevel = (n: number) => n % 3 === 0;
export const baseReward = (l: LevelState) => (l.special ? 6 : 3);

function randomSpecial(level: number): SpecialId {
  return pick(SPECIAL_IDS.filter((s) => s !== 'upsilon' || level >= 10));
}
/** Prochain niveau spécial (à partir de n inclus). */
export const nextSpecialLevel = (n: number) => Math.ceil(n / 3) * 3;

function newLevel(n: number, special: SpecialId | null): LevelState {
  return { n, special, target: levelTarget(n, special), moves: levelMoves(n), used: 0, score: 0, gamma: false };
}

// ---------- Création ----------
const newCells = (): Cell[][] => BONUS.map((row, r) => row.map((b, c) => {
  if (r === CENTER && c === CENTER) return { t: 'DEP' as CellType };
  return b ? { t: b as CellType } : {};
}));
const emptyBoard = () => Array.from({ length: SIZE }, () => Array<STile | null>(SIZE).fill(null));

export function newTile(g: SGame, l: string, own: 0 | 1, extra: Partial<STile> = {}): STile {
  return { id: ++g.seq, l, bonus: 0, pas: [], sty: [], own, ...extra };
}

function newPlayer(g: SGame, name: string, own: 0 | 1): SPlayer {
  const bag: STile[] = [];
  for (const [l, { count }] of Object.entries(LETTERS)) for (let i = 0; i < count; i++) bag.push(newTile(g, l, own));
  return {
    name, bag: shuffle(bag), rack: [], powers: [], money: START_MONEY, reserve: null, lastProgram: null, up: {}, total: 0,
    muet: 0, eboueur: 0, cancre: false, sold: false, played: false, crypto: null, lastPlaced: [],
  };
}

export function newScralatro(mode: Mode, names: string[] = []): SGame {
  const g: SGame = {
    v: 1, mode, players: [], cur: 0, board: emptyBoard(), cells: newCells(),
    lvl: newLevel(1, null), next: randomSpecial(3), phase: 'shop', shopQueue: [], pending: null, pendingFor: 0,
    idle: 0, clears: 0, won: false, continued: false, log: [], seq: 0,
  };
  const n = mode === 'solo' ? 1 : 2;
  for (let i = 0; i < n; i++) g.players.push(newPlayer(g, names[i] || (n === 1 ? 'Vous' : `Joueur ${i + 1}`), i as 0 | 1));
  if (mode === 'compet') for (const p of g.players) { p.lvl = newLevel(1, null); p.next = randomSpecial(3); }
  g.shopQueue = g.players.map((_, i) => i);
  openShop(g, 0);
  log(g, 0, `Nouvelle partie ${mode === 'solo' ? 'solo' : mode === 'coop' ? 'en coopération' : 'en compétition'} : ${START_MONEY} $ pour commencer, direction le magasin !`, 'level');
  return g;
}

export const lvlOf = (g: SGame, pi: number): LevelState => (g.mode === 'compet' ? g.players[pi].lvl! : g.lvl);
export const nextSpecialOf = (g: SGame, pi: number): SpecialId => (g.mode === 'compet' ? g.players[pi].next! : g.next);
export const movesLeft = (g: SGame, pi: number) => { const l = lvlOf(g, pi); return l.moves - l.used; };
/** Compétition : récompense actuelle du niveau (baisse de 1 $ par tour). */
export const competReward = (l: LevelState) => baseReward(l) + l.moves - l.used;

function log(g: SGame, p: number, text: string, kind?: LogEntry['kind'], score?: number) {
  g.log.push({ p, text, kind, ...(score !== undefined ? { score } : {}) });
  if (g.log.length > 300) g.log.splice(0, g.log.length - 300);
}

// ---------- Tuiles et pouvoirs ----------
export const letterOf = (t: STile) => (t.l === '?' ? (t.as ?? '?') : t.l);
export const baseValue = (l: string) => (l === '?' || l === '#' ? 0 : LETTERS[l]?.value ?? 0);
export function tileValue(g: SGame, t: STile): number {
  if (t.l === '?' || t.l === '#') return t.bonus;
  return baseValue(t.l) + (g.players[t.own]?.up[t.l] ?? 0) + t.bonus;
}
/** Pouvoirs actifs d'un joueur (Psi en annule un). */
export function active(g: SGame, pi: number): PowerInst[] {
  const p = g.players[pi];
  const l = lvlOf(g, pi);
  return p.powers.filter((x) => !(l.special === 'psi' && g.phase === 'play' && x.uid === p.psi));
}
export const has = (g: SGame, pi: number, id: PowerId) => active(g, pi).some((x) => x.id === id);
const count = (g: SGame, pi: number, id: PowerId) => active(g, pi).filter((x) => x.id === id).length;
const owns = (g: SGame, pi: number, id: PowerId) => g.players[pi].powers.some((x) => x.id === id);

export function rackSize(g: SGame, pi: number): number {
  const p = g.players[pi];
  const n = 7 + p.powers.filter((x) => x.id === 'jongleur').length - p.powers.filter((x) => x.id === 'gentil').length
    - (lvlOf(g, pi).special === 'kappa' ? 1 : 0);
  return Math.max(1, n);
}

/** Les effets de la tuile s'appliquent-ils (Delta, Alpha, Bêta) pour le joueur pi ? */
function fxOn(g: SGame, pi: number, t: STile): boolean {
  const sp = lvlOf(g, pi).special;
  const mine = g.mode !== 'compet' || t.own === pi;
  if (!mine) return true;
  if (sp === 'delta') return false;
  const l = letterOf(t);
  if (sp === 'alpha' && isVowel(l)) return false;
  if (sp === 'beta' && isConsonant(l)) return false;
  return true;
}
/** Valeur annulée (Alpha, Bêta) ? */
function valueOff(g: SGame, pi: number, t: STile): boolean {
  const sp = lvlOf(g, pi).special;
  if (g.mode === 'compet' && t.own !== pi) return false;
  const l = letterOf(t);
  return (sp === 'alpha' && isVowel(l)) || (sp === 'beta' && isConsonant(l));
}
const acts = (t: STile) => (t.pas.includes('rouge') ? 2 : 1);

/** Case vue par le joueur pi (en compétition, les cases de l'adversaire ne lui profitent pas). */
function cellFor(g: SGame, pi: number, r: number, c: number): Cell {
  const cell = g.cells[r][c];
  if (lvlOf(g, pi).special === 'zeta') return {};
  if (g.mode === 'compet' && cell.o !== undefined && cell.o !== pi) return {};
  return cell;
}
const isBaseCell = (cell: Cell) => !cell.t && !cell.x;

/** Amélioration aléatoire d'une tuile (Zorro). */
export function improveTile(t: STile): string {
  const k = pick(['tex', 'ed', 'font', 'pas', 'sty', 'bonus'] as const);
  if (k === 'tex') { t.tex = pick(['bronze', 'argent', 'or', 'bois', 'verre', 'papier', 'pierre'] as Texture[]); t.wear = 0; return TEXTURES[t.tex].name; }
  if (k === 'ed') { t.ed = pick(['holo', 'poly'] as Edition[]); return EDITIONS[t.ed].name; }
  if (k === 'font') { t.font = pick(['casino', 'console', 'western', 'calli'] as Font[]); delete t.inf; return FONTS[t.font].name; }
  if (k === 'pas') {
    const free = (Object.keys(PASTILLES) as Pastille[]).filter((x) => !t.pas.includes(x));
    if (free.length) { const x = pick(free); t.pas.push(x); return PASTILLES[x].name; }
  }
  if (k === 'sty') {
    const free = (Object.keys(STYLES) as Style[]).filter((x) => !t.sty.includes(x));
    if (free.length) { const x = pick(free); t.sty.push(x); return STYLES[x].name; }
  }
  t.bonus += 5;
  return '+5 de valeur';
}
/** Amélioration aléatoire d'une case (roue, mécano, bombardier, sourcier). */
export function randomCell(): Cell {
  if (chance(0.35)) return { x: pick(Object.keys(CELL_TEX) as CellTex[]) };
  const t = weighted((Object.keys(CELL_TYPES) as CellType[]).filter((x) => x !== 'ROUE').map((x) => [x, CELL_TYPES[x].weight] as [CellType, number]));
  return t === 'RND' ? { t, rnd: pick(['MD', 'MT', 'LD', 'LT'] as const) } : { t };
}
/**
 * Applique une amélioration à une case : seules les caractéristiques fournies changent.
 * Un type remplace le type (texture gardée), une texture remplace la texture (type gardé).
 */
export function mergeCell(cur: Cell, add: Cell, owner?: 0 | 1): Cell {
  const out: Cell = {};
  const t = add.t ?? cur.t;
  if (t) out.t = t;
  if (t === 'RND') out.rnd = add.t ? (add.rnd ?? pick(['MD', 'MT', 'LD', 'LT'] as const)) : cur.rnd;
  const x = add.x ?? cur.x;
  if (x) out.x = x;
  const o = owner ?? cur.o;
  if (o !== undefined) out.o = o;
  return out;
}
function improveCell(g: SGame, r: number, c: number, owner: 0 | 1) {
  g.cells[r][c] = mergeCell(g.cells[r][c], randomCell(), owner);
}
function baseCells(g: SGame): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isBaseCell(g.cells[r][c])) out.push([r, c]);
  return out;
}
function improveBaseCells(g: SGame, n: number, owner: 0 | 1) {
  const base = shuffle(baseCells(g)).slice(0, n);
  for (const [r, c] of base) improveCell(g, r, c, owner);
  return base.length;
}

/** Détruit une tuile (plateau, chevalet, sac) : elle ne reviendra jamais. */
function destroy(g: SGame, t: STile) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (g.board[r][c]?.id === t.id) g.board[r][c] = null;
  for (const p of g.players) {
    p.rack = p.rack.filter((x) => x.id !== t.id);
    p.bag = p.bag.filter((x) => x.id !== t.id);
  }
  const owner = g.players[t.own];
  if (!owner) return;
  for (const pw of owner.powers) {
    if (pw.id === 'maladroit' && t.tex === 'verre') pw.n++;
    if (pw.id === 'pessimiste' && isVowel(letterOf(t))) pw.n++;
  }
}
/** Ajoute des tuiles au sac d'un joueur (collectionneur). */
function addToBag(g: SGame, pi: number, tiles: STile[]) {
  const p = g.players[pi];
  for (const t of tiles) { t.own = pi as 0 | 1; p.bag.splice(ri(p.bag.length + 1), 0, t); }
  for (const pw of p.powers) if (pw.id === 'collectionneur') pw.n += tiles.length;
}

/** Pioche jusqu'à remplir le chevalet (édition holographique). */
export function refill(g: SGame, pi: number): string[] {
  const p = g.players[pi];
  const notes: string[] = [];
  const want = rackSize(g, pi);
  while (p.rack.length < want && p.bag.length) {
    const t = p.bag.splice(ri(p.bag.length), 1)[0];
    p.rack.push(t);
    if (t.ed === 'holo' && fxOn(g, pi, t)) {
      for (let k = 0; k < acts(t); k++) {
        const others = p.rack.filter((x) => x.id !== t.id && x.l !== '#');
        if (others.length) { const o = pick(others); o.bonus += 5; notes.push(`🌈 ${letterOf(t)} holographique : +5 sur ${letterOf(o)}`); }
      }
    }
  }
  return notes;
}

// ---------- Géométrie d'un coup ----------
export interface Req { id: number; r: number; c: number; as?: string }
export interface WordRef { word: string; cells: [number, number][] }
export type Geo = { ok: false; error: string } | { ok: true; words: WordRef[] };

export function geometry(g: SGame, pi: number, reqs: Req[]): Geo {
  const p = g.players[pi];
  const l = lvlOf(g, pi);
  if (!reqs.length) return { ok: false, error: 'Posez au moins une lettre.' };
  const seen = new Set<number>();
  const at = new Map<number, string>();
  for (const q of reqs) {
    const t = p.rack.find((x) => x.id === q.id);
    if (!t) return { ok: false, error: 'Tuile absente du chevalet.' };
    if (t.l === '#') return { ok: false, error: 'Une tuile verrou ne peut pas être jouée.' };
    if (q.r < 0 || q.r >= SIZE || q.c < 0 || q.c >= SIZE) return { ok: false, error: 'Case hors du plateau.' };
    if (g.board[q.r][q.c]) return { ok: false, error: 'Case déjà occupée.' };
    const k = q.r * SIZE + q.c;
    if (seen.has(k)) return { ok: false, error: 'Deux lettres sur la même case.' };
    seen.add(k);
    const letter = t.l === '?' ? q.as ?? '' : t.l;
    if (!/^[A-Z]$/.test(letter)) return { ok: false, error: 'Choisissez la lettre du joker.' };
    if (l.special === 'tau' && 'EAIS'.includes(letter)) return { ok: false, error: 'Tau : vous ne pouvez pas poser E, A, I ni S.' };
    at.set(k, letter);
  }
  if (l.special === 'rho' && p.rho !== undefined && p.rack.some((x) => x.id === p.rho) && !reqs.some((q) => q.id === p.rho)) {
    return { ok: false, error: 'Rhô : vous devez jouer la tuile désignée.' };
  }
  const sameRow = reqs.every((q) => q.r === reqs[0].r);
  const sameCol = reqs.every((q) => q.c === reqs[0].c);
  if (!sameRow && !sameCol) return { ok: false, error: 'Les lettres doivent être alignées.' };
  const letterAt = (r: number, c: number): string | null => {
    const t = g.board[r][c];
    return t ? letterOf(t) : at.get(r * SIZE + c) ?? null;
  };
  const filled = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE && letterAt(r, c) !== null;
  let horizontal: boolean;
  if (reqs.length > 1) horizontal = sameRow;
  else {
    const { r, c } = reqs[0];
    horizontal = filled(r, c - 1) || filled(r, c + 1) || !(filled(r - 1, c) || filled(r + 1, c));
  }
  const [dr, dc] = horizontal ? [0, 1] : [1, 0];
  const sorted = [...reqs].sort((a, b) => (horizontal ? a.c - b.c : a.r - b.r));
  const first = sorted[0], last = sorted[sorted.length - 1];
  for (let r = first.r, c = first.c; r <= last.r && c <= last.c; r += dr, c += dc) {
    if (!filled(r, c)) return { ok: false, error: 'Les lettres doivent former un mot continu.' };
  }
  const empty = g.board.every((row) => row.every((t) => !t));
  if (empty) {
    const starts: number[] = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (g.cells[r][c].t === 'DEP') starts.push(r * SIZE + c);
    if (starts.length && !starts.some((k) => seen.has(k))) return { ok: false, error: 'Le premier mot doit passer par une case départ ★.' };
    if (reqs.length < 2) return { ok: false, error: 'Le premier mot doit faire au moins 2 lettres.' };
  } else {
    const touches = reqs.some(({ r, c }) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      .some(([rr, cc]) => rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && g.board[rr][cc]));
    if (!touches) return { ok: false, error: 'Le mot doit toucher une lettre déjà posée.' };
  }
  const words: WordRef[] = [];
  const read = (r0: number, c0: number, wr: number, wc: number): WordRef | null => {
    let r = r0, c = c0;
    while (filled(r - wr, c - wc)) { r -= wr; c -= wc; }
    const cells: [number, number][] = [];
    let word = '';
    for (; filled(r, c); r += wr, c += wc) { cells.push([r, c]); word += letterAt(r, c); }
    return word.length >= 2 ? { word, cells } : null;
  };
  const main = read(first.r, first.c, dr, dc);
  if (main) words.push(main);
  for (const q of reqs) { const x = read(q.r, q.c, dc, dr); if (x) words.push(x); }
  if (!words.length) return { ok: false, error: 'Le coup doit former un mot d’au moins 2 lettres.' };
  if (l.special === 'pi') {
    const bad = words.find((w) => new Set(w.word).size !== w.word.length);
    if (bad) return { ok: false, error: `Pi : ${bad.word} contient deux fois la même lettre.` };
  }
  return { ok: true, words };
}

// ---------- Validation (dictionnaire et pouvoirs) ----------
export interface Lex {
  /** Mots absents de la liste de la partie. */
  invalid(words: string[]): Promise<string[]>;
}
export interface WordInfo extends WordRef {
  conj: boolean; en: boolean; plural: boolean; fem: boolean; masc: boolean;
  /** Mot accepté grâce à un pouvoir. */
  via?: string;
}
export type Validation = { ok: true; infos: WordInfo[]; cancre: boolean } | { ok: false; invalid: string[] };

const PATTERNS: [PowerId, RegExp][] = [
  ['clown', /^(HA)+$/], ['hurleur', /^A+H$/], ['dormeur', /^Z{2,}$/], ['hesitant', /^E{2,}$/], ['etonne', /^O+H$/],
  ['ninja', /^YA+$/], ['beatboxer', /^[PTKQCSZ]+$/], ['scatman', /^[SKDBPAIOUY]+$/], ['magicien', /^[ABCDR]+$/],
  ['bleu', /^[ABDE]+$/],
];
const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Formes candidates pour reconnaître un mot (conjugaison, pluriel, genre). */
const ER_ENDS = ['E', 'ES', 'ENT', 'ONS', 'EZ', 'AIS', 'AIT', 'IONS', 'IEZ', 'AIENT', 'AI', 'AS', 'A', 'AMES', 'ATES', 'ERENT',
  'ERAI', 'ERAS', 'ERA', 'ERONS', 'EREZ', 'ERONT', 'ERAIS', 'ERAIT', 'ERIONS', 'ERIEZ', 'ERAIENT', 'ASSE', 'ASSES', 'AT',
  'ASSIONS', 'ASSIEZ', 'ASSENT', 'ANT', 'EE', 'EES'];
const IR_ENDS = ['IS', 'IT', 'ISSONS', 'ISSEZ', 'ISSENT', 'ISSAIS', 'ISSAIT', 'ISSIONS', 'ISSIEZ', 'ISSAIENT', 'IMES', 'ITES',
  'IRENT', 'IRAI', 'IRAS', 'IRA', 'IRONS', 'IREZ', 'IRONT', 'IRAIS', 'IRAIT', 'IRIONS', 'IRIEZ', 'IRAIENT', 'ISSE', 'ISSANT'];
const RE_ENDS = ['S', 'T', 'ONS', 'EZ', 'ENT', 'AIS', 'AIT', 'AIENT', 'RAI', 'RA', 'RONT', 'ANT', 'U', 'UE'];
function infinitives(w: string): string[] {
  const out = new Set<string>();
  const add = (ends: string[], inf: string) => {
    for (const e of ends) if (w.endsWith(e) && w.length - e.length >= 2) out.add(w.slice(0, -e.length) + inf);
  };
  add(ER_ENDS, 'ER');
  add(IR_ENDS, 'IR');
  add(RE_ENDS, 'RE');
  out.delete(w);
  return [...out];
}
const singulars = (w: string) => [
  ...(/[SX]$/.test(w) && w.length >= 3 ? [w.slice(0, -1)] : []),
  ...(w.endsWith('AUX') && w.length >= 5 ? [`${w.slice(0, -3)}AL`] : []),
];
const FEM: [string, string][] = [['EUSE', 'EUR'], ['RICE', 'EUR'], ['IVE', 'IF'], ['ENNE', 'EN'], ['ELLE', 'EL'], ['ETTE', 'ET'], ['ERE', 'ER'], ['ESSE', 'E'], ['ONNE', 'ON'], ['E', '']];
/** Masculins candidats d'un mot féminin, et inversement. */
function genderPairs(w: string, toMasc: boolean): string[] {
  const out: string[] = [];
  const base = w.endsWith('S') && w.length > 3 ? [w, w.slice(0, -1)] : [w];
  for (const b of base) {
    for (const [f, m] of FEM) {
      const [from, to] = toMasc ? [f, m] : [m, f];
      if (b.endsWith(from) && b.length - from.length >= 2) out.push(b.slice(0, b.length - from.length) + to);
    }
  }
  return out.filter((x) => x !== w && x.length >= 2);
}

export async function validate(g: SGame, pi: number, words: WordRef[], lex: Lex): Promise<Validation> {
  const pw = active(g, pi);
  const hasP = (id: PowerId) => pw.some((x) => x.id === id);
  const cand = new Set<string>();
  const alts = words.map((w) => {
    const free: [string, PowerId][] = [];
    if (hasP('photographe') && /II/.test(w.word)) free.push([w.word.replace(/I{2,}/g, 'I'), 'photographe']);
    if (hasP('inconnue') && w.word.includes('X')) {
      const xs = [...w.word].map((ch, i) => (ch === 'X' ? i : -1)).filter((i) => i >= 0).slice(0, 2);
      let forms = [w.word];
      for (const i of xs) forms = forms.flatMap((f) => [...AZ].map((ch) => f.slice(0, i) + ch + f.slice(i + 1)));
      for (const f of forms) free.push([f, 'inconnue']);
    }
    if (hasP('dyslexique')) {
      for (let i = 0; i + 1 < w.word.length; i++) {
        free.push([w.word.slice(0, i) + w.word[i + 1] + w.word[i] + w.word.slice(i + 2), 'dyslexique']);
      }
    }
    const cancre: string[] = [];
    if (hasP('cancre') && !g.players[pi].cancre) {
      for (let i = 0; i < w.word.length; i++) for (const ch of AZ) if (ch !== w.word[i]) cancre.push(w.word.slice(0, i) + ch + w.word.slice(i + 1));
    }
    cand.add(w.word);
    for (const [x] of free) cand.add(x);
    for (const x of cancre) cand.add(x);
    return { free, cancre };
  });
  // Formes utiles aux pouvoirs (conjugaison, pluriel, genre).
  const extra = words.map((w) => ({
    inf: hasP('profFr') ? infinitives(w.word) : [],
    sing: hasP('jumelles') ? singulars(w.word) : [],
    masc: hasP('feministe') ? genderPairs(w.word, true) : [],
    fem: hasP('masculiniste') ? genderPairs(w.word, false) : [],
  }));
  for (const e of extra) for (const x of [...e.inf, ...e.sing, ...e.masc, ...e.fem]) cand.add(x);
  const list = [...cand];
  const bad = new Set(list.length ? await lex.invalid(list) : []);
  const ok = (x: string) => cand.has(x) && !bad.has(x);
  const invalid: string[] = [];
  let usedCancre = false;
  const infos: WordInfo[] = words.map((w, i) => {
    const { free, cancre } = alts[i];
    let via: string | undefined;
    const pat = PATTERNS.find(([id, re]) => hasP(id) && re.test(w.word));
    const alt = free.find(([f]) => ok(f));
    if (ok(w.word)) via = undefined;
    else if (pat) via = POWERS[pat[0]].name;
    else if (alt) via = POWERS[alt[1]].name;
    else if (!usedCancre && cancre.some(ok)) { via = POWERS.cancre.name; usedCancre = true; }
    else invalid.push(w.word);
    const e = extra[i];
    return {
      ...w, via,
      conj: e.inf.some(ok),
      en: ENGLISH.has(w.word),
      plural: e.sing.some(ok),
      fem: e.masc.some(ok),
      masc: e.fem.some(ok),
    };
  });
  if (invalid.length) return { ok: false, invalid };
  return { ok: true, infos, cancre: usedCancre };
}

// ---------- Score d'un coup ----------
export interface Line { text: string; cls?: 'word' | 'mult' | 'add' | 'bad' | 'money' | 'total' | 'info' }
export interface MoveResult {
  score: number; lines: Line[];
  words: { word: string; score: number; cells: [number, number][] }[];
  placed: [number, number][]; bingo: boolean;
}
const fmt = (x: number) => (Math.round(x * 100) / 100).toLocaleString('fr-FR');

/** Occurrences d'un motif dans les suites de lettres du plateau (lignes et colonnes). */
function boardCount(g: SGame, re: RegExp): number {
  let n = 0;
  for (const horiz of [true, false]) {
    for (let i = 0; i < SIZE; i++) {
      let s = '';
      for (let j = 0; j <= SIZE; j++) {
        const t = j < SIZE ? (horiz ? g.board[i][j] : g.board[j][i]) : null;
        if (t) { s += letterOf(t); continue; }
        if (s.length >= 2) n += (s.match(re) ?? []).length;
        s = '';
      }
    }
  }
  return n;
}
function boardWordSet(g: SGame): Map<string, number> {
  const m = new Map<string, number>();
  for (const horiz of [true, false]) {
    for (let i = 0; i < SIZE; i++) {
      let s = '';
      for (let j = 0; j <= SIZE; j++) {
        const t = j < SIZE ? (horiz ? g.board[i][j] : g.board[j][i]) : null;
        if (t) { s += letterOf(t); continue; }
        if (s.length >= 2) m.set(s, (m.get(s) ?? 0) + 1);
        s = '';
      }
    }
  }
  return m;
}

export interface ResolveOpts { preview?: boolean; crypto?: number | null; cancre?: boolean }

/**
 * Joue le coup : pose les tuiles, calcule le score avec tous les effets (dans l'ordre des tuiles pouvoir),
 * puis applique les effets secondaires (argent, destructions, améliorations). En aperçu, les effets au hasard
 * (casino, verre) sont ignorés : on joue alors sur une copie de la partie.
 */
export function resolveMove(g: SGame, pi: number, reqs: Req[], infos: WordInfo[], opts: ResolveOpts = {}): MoveResult {
  const p = g.players[pi];
  const lv = lvlOf(g, pi);
  const sp = lv.special;
  const lines: Line[] = [];
  const prev = opts.preview;
  const pw = active(g, pi);
  const hasP = (id: PowerId) => pw.some((x) => x.id === id);
  const wordsBefore = boardWordSet(g);

  // Pose des tuiles.
  const placedIds = new Set<number>();
  const placed: [number, number][] = [];
  for (const q of reqs) {
    const i = p.rack.findIndex((x) => x.id === q.id);
    const t = p.rack.splice(i, 1)[0];
    if (t.l === '?') t.as = q.as;
    if (hasP('maya') && t.l === 'O' && t.own === pi && t.tex !== 'or') { t.tex = 'or'; lines.push({ text: `🗿 Maya : ce O devient en or`, cls: 'info' }); }
    g.board[q.r][q.c] = t;
    placedIds.add(t.id);
    placed.push([q.r, q.c]);
  }
  const placedTiles = reqs.map((q) => g.board[q.r][q.c]!);
  const isNew = (r: number, c: number) => placedIds.has(g.board[r][c]!.id);
  let money = 0;
  const casinoWins = { n: 0 };
  const glassChecks: STile[] = [];

  // Mots.
  const wordScores: MoveResult['words'] = [];
  for (const w of infos) {
    const tiles = w.cells.map(([r, c]) => g.board[r][c]!);
    const letters = tiles.map(letterOf);
    let sum = 0, mult = 1, after = 0;
    const notes: string[] = [];
    const onlyOf = (set: string) => letters.every((l) => set.includes(l));
    const letterAdd = (hasP('beatboxer') && onlyOf('PTKQCSZ') ? 10 : 0) + (hasP('scatman') && onlyOf('SKDBPAIOUY') ? 10 : 0)
      + (hasP('magicien') && onlyOf('ABCDR') ? 15 : 0) + (hasP('bleu') && onlyOf('ABDE') ? 15 : 0);
    tiles.forEach((t, k) => {
      const [r, c] = w.cells[k];
      const fresh = isNew(r, c);
      const l = letters[k];
      let v = tileValue(g, t);
      if (valueOff(g, pi, t)) v = 0;
      if (sp === 'phi' && !fresh) v = 0;
      if (fresh && t.own === pi) {
        if (hasP('voyelliste') && isVowel(l)) v += 10 * count(g, pi, 'voyelliste');
        if (hasP('consonniste') && isConsonant(l)) v += 10 * count(g, pi, 'consonniste');
      }
      if (letterAdd && !(sp === 'phi' && !fresh)) v += letterAdd;
      if (fresh) {
        const cell = cellFor(g, pi, r, c);
        const type = cell.t === 'RND' ? cell.rnd : cell.t;
        if (type === 'LD') v *= 2; else if (type === 'LT') v *= 3; else if (type === 'LQ') v *= 4;
        else if (type === 'MD') mult *= 2; else if (type === 'MT') mult *= 3; else if (type === 'MQ' || type === 'MQM') mult *= 4;
        else if (type === 'P10') sum += 10; else if (type === 'P20') sum += 20; else if (type === 'P30') sum += 30;
        if (cell.x === 'air' && isVowel(l)) v *= 1.5;
        if (cell.x === 'feu' && isConsonant(l)) v *= 1.5;
        if (cell.x === 'eau' && isVowel(l)) mult *= 1.5;
        if (cell.x === 'terre' && isConsonant(l)) mult *= 1.5;
      }
      sum += v;
      if (!fxOn(g, pi, t)) return;
      for (let a = 0; a < acts(t); a++) {
        if (t.tex === 'bronze') { sum += w.word.length; notes.push(`🥉+${w.word.length}`); }
        if (t.tex === 'argent') { mult *= 1.5; notes.push('🥈×1,5'); }
        if (t.tex === 'or') { mult *= 2; notes.push('🥇×2'); }
        if (t.tex === 'papier') { mult *= 2; notes.push('📄×2'); }
        if (t.tex === 'verre') { sum += 10; notes.push('🥃+10'); if (fresh) glassChecks.push(t); }
        if (t.font === 'casino' && !prev) {
          if (chance(0.5)) { mult *= 2; casinoWins.n++; notes.push('🎰×2'); } else { after -= 5; notes.push('🎰−5'); }
        }
        if (t.font === 'calli' && k === 0) { mult *= 2; notes.push('✒️×2'); }
        if (t.pas.includes('jaune')) money += 3;
      }
    });
    if (tiles.every((t) => t.sty.includes('gras'))) { mult *= 2; notes.push('𝐁×2'); }
    if (tiles.every((t) => t.sty.includes('italique'))) { sum += 10; notes.push('𝐼+10'); }
    let score = sum * mult + after;
    // Pouvoirs liés au mot, dans l'ordre de la liste.
    const vals = new Set(tiles.map((t) => tileValue(g, t)));
    const metal = tiles.filter((t) => t.tex === 'bronze' || t.tex === 'argent' || t.tex === 'or').length;
    const vowels = letters.filter(isVowel).length;
    const cons = letters.filter(isConsonant).length;
    const len = w.word.length;
    for (const x of pw) {
      let m = 1;
      switch (x.id) {
        case 'profFr': if (w.conj) m = 4; break;
        case 'profMath': if (vals.size >= 3) m = 2; break;
        case 'profAng': if (w.en) m = 4; break;
        case 'sportif': if (isThemeWord('sports', w.word)) m = 5; break;
        case 'gamer': if (isThemeWord('jeux', w.word)) m = 5; break;
        case 'biologiste': if (isThemeWord('nature', w.word)) m = 5; break;
        case 'medecin': if (isThemeWord('medecine', w.word)) m = 5; break;
        case 'disparu': if (!/[ESARTI]/.test(w.word)) m = 3; break;
        case 'hawaien': if (vowels >= 3) m = 3; break;
        case 'georgien': if (cons >= 4) m = 3; break;
        case 'extraverti': if (len >= 5) m = 3; break;
        case 'introverti': if (len <= 3) m = 3; break;
        case 'jumelles': if (w.plural) m = 4; break;
        case 'feministe': if (w.fem) m = 4; break;
        case 'masculiniste': if (w.masc) m = 3; break;
        case 'bijoutier': if (metal >= 2) m = 4; break;
        case 'bucheron': if (tiles.some((t) => t.tex === 'bois')) m = 4; break;
        case 'verrier': if (tiles.some((t) => t.tex === 'verre')) m = 4; break;
        case 'duo': if (len === 2) m = 2; break;
        case 'trio': if (len === 3) m = 3; break;
        case 'quatuor': if (len === 4) m = 4; break;
        case 'quintet': if (len === 5) m = 5; break;
        case 'sextet': if (len === 6) m = 6; break;
        case 'perroquet': if (wordsBefore.has(w.word)) m = 3; break;
        default: break;
      }
      if (m !== 1) { score *= m; notes.push(`${POWERS[x.id].icon}×${m}`); }
    }
    if (tiles.every((t) => t.sty.includes('souligne'))) { score *= 2; notes.push('U̲ rejoue'); }
    if (sp === 'epsilon' && len < 4) { score = 0; notes.push('Ε : 0'); }
    wordScores.push({ word: w.word, score, cells: w.cells });
    lines.push({ text: `${w.word}${w.via ? ` (${w.via})` : ''} : ${fmt(sum)}${mult !== 1 ? ` × ${fmt(mult)}` : ''}${after ? ` ${after}` : ''}${notes.length ? `  ${notes.join(' ')}` : ''} = ${fmt(score)}`, cls: 'word' });
  }

  // Tour : somme des mots, scrabble, pierre, puis pouvoirs dans l'ordre.
  let total = wordScores.reduce((s, w) => s + w.score, 0);
  const bingo = reqs.length >= (hasP('tricheur') ? 6 : 7);
  if (bingo) { total += 50; lines.push({ text: 'Scrabble ! +50', cls: 'add' }); }
  for (const t of p.rack) {
    if (t.tex === 'pierre' && fxOn(g, pi, t)) for (let a = 0; a < acts(t); a++) { total *= 1.5; lines.push({ text: `🪨 ${letterOf(t)} en pierre sur le chevalet : ×1,5`, cls: 'mult' }); }
  }
  const nWords = wordScores.length;
  const two = wordScores.filter((w) => w.word.length === 2).length;
  const turnMult = (x: PowerInst, m: number) => {
    if (m === 1) return;
    total *= m;
    lines.push({ text: `${POWERS[x.id].icon} ${POWERS[x.id].name} : ×${fmt(m)}`, cls: 'mult' });
  };
  const turnAdd = (x: PowerInst, a: number) => {
    if (!a) return;
    total += a;
    lines.push({ text: `${POWERS[x.id].icon} ${POWERS[x.id].name} : +${fmt(a)}`, cls: 'add' });
  };
  const playedCount = reqs.length;
  for (const x of pw) {
    switch (x.id) {
      case 'clown': turnMult(x, 1 + 2 * boardCount(g, /HA/g)); break;
      case 'hurleur': turnMult(x, 1 + 2 * boardCount(g, /A+H/g)); break;
      case 'dormeur': turnMult(x, 1 + 2 * boardCount(g, /Z{2,}/g)); break;
      case 'hesitant': turnMult(x, 1 + 0.5 * boardCount(g, /E{2,}/g)); break;
      case 'etonne': turnMult(x, 1 + 0.5 * boardCount(g, /O+H/g)); break;
      case 'ninja': turnMult(x, 1 + 2 * boardCount(g, /YA+/g)); break;
      case 'photographe': turnMult(x, 1 + 2 * boardCount(g, /I{2,}/g)); break;
      case 'bavard': if (nWords >= 4) turnMult(x, 3); break;
      case 'muet': turnMult(x, 1 + 2 * p.muet); break;
      case 'begue': if (two >= 3) turnMult(x, 3); break;
      case 'gentil': turnMult(x, 2); break;
      case 'maladroit': turnMult(x, 1 + x.n); break;
      case 'pessimiste': turnMult(x, 1 + x.n); break;
      case 'nain': turnMult(x, 1 + 0.1 * placedTiles.filter((t) => tileValue(g, t) === 1).length); break;
      case 'idole': turnMult(x, 2 ** placedTiles.filter((t) => letterOf(t) === p.idole).length); break;
      case 'eboueur': turnMult(x, 1 + 0.5 * p.eboueur); break;
      case 'optimiste':
        if (g.mode === 'compet' ? competReward(lv) - 1 <= 3 : lv.moves - lv.used === 1) turnMult(x, 5);
        break;
      case 'elitiste': if (total >= 50) turnMult(x, 4); break;
      case 'cupide': if (p.money >= 20) turnMult(x, 3); break;
      case 'collectionneur': turnMult(x, 1 + 0.25 * x.n); break;
      case 'croupier': x.n += casinoWins.n; turnMult(x, 1 + 0.5 * x.n); break;
      case 'vieux': x.n += playedCount; turnMult(x, Math.max(0, 4 - 0.05 * x.n)); break;
      case 'souriant': turnMult(x, 1 + 0.5 * boardCount(g, /I/g)); break;
      case 'paysan': {
        let ld = 0;
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (cellFor(g, pi, r, c).t === 'LD') ld++;
        if (ld >= 28) turnMult(x, 4);
        break;
      }
      case 'desinfecteur': turnMult(x, 1 + 0.5 * x.n); break;
      case 'gagnant': if (bingo) turnAdd(x, 100); break;
      case 'british': turnAdd(x, 50 * p.rack.filter((t) => letterOf(t) === 'T').length); break;
      case 'tailleur': turnAdd(x, 10 * nWords * p.bag.filter((t) => t.tex === 'pierre').length); break;
      default: break;
    }
  }
  if ((sp === 'sigma' && two === 0) || (sp === 'khi' && nWords < 2)) {
    total = 0;
    lines.push({ text: `${SPECIALS[sp].letter} ${SPECIALS[sp].name} : ce tour ne rapporte rien`, cls: 'bad' });
  }
  const score = Math.floor(total);

  // Effets secondaires.
  const gained = (n: number, why: string) => { if (!n) return; p.money += n; lines.push({ text: `${why} : ${n > 0 ? '+' : ''}${n} $`, cls: 'money' }); };
  if (money) { const m = money; money = 0; gained(m, '🟡 Pastilles jaunes'); }
  if (hasP('mineur')) {
    const n = placedTiles.filter((t) => t.tex === 'bronze' || t.tex === 'argent' || t.tex === 'or').length;
    gained(5 * n * count(g, pi, 'mineur'), '⛏️ Le mineur');
  }
  if (sp === 'mu') gained(-playedCount, 'Μ Mu');
  for (const t of placedTiles) {
    if (hasP('erudit') && letterOf(t) === 'A' && t.l !== '?') t.bonus += 15 * count(g, pi, 'erudit');
    if (hasP('entraineur')) t.bonus += 4 * count(g, pi, 'entraineur');
    if (t.tex === 'papier' && fxOn(g, pi, t)) t.wear = (t.wear ?? 0) + 1;
    if ('KWXYZ'.includes(letterOf(t))) lv.gamma = true;
  }
  if (!prev) {
    const destroyed: STile[] = [];
    // Verre : 1 chance sur 3 par activation (une pastille rouge relance le dé, sauf si la tuile est déjà brisée).
    for (const t of glassChecks) {
      if (destroyed.includes(t)) continue;
      if (chance(1 / 3)) { destroyed.push(t); lines.push({ text: `🥃 ${letterOf(t)} en verre se brise !`, cls: 'bad' }); }
    }
    for (const t of placedTiles) {
      if (t.tex === 'papier' && (t.wear ?? 0) >= 3 && !destroyed.includes(t)) { destroyed.push(t); lines.push({ text: `📄 ${letterOf(t)} en papier se déchire`, cls: 'bad' }); }
    }
    if (hasP('assassin') && playedCount === 1 && !destroyed.includes(placedTiles[0])) {
      destroyed.push(placedTiles[0]);
      gained(6, '🔪 L’assassin');
    }
    // Rack restant : améliorations dues aux lettres jouées.
    for (const t of placedTiles) {
      const l = letterOf(t);
      if (l === 'Z' && hasP('zorro')) {
        const opts = p.rack.filter((x) => x.l !== '#');
        if (opts.length) { const o = pick(opts); lines.push({ text: `🗡️ Zorro : ${letterOf(o)} reçoit ${improveTile(o)}`, cls: 'info' }); }
      }
      if (l === 'P' && hasP('gorgone')) {
        const opts = p.rack.filter((x) => x.l !== '#');
        if (opts.length) { const o = pick(opts); o.tex = 'pierre'; lines.push({ text: `🐍 La gorgone change ${letterOf(o)} en pierre`, cls: 'info' }); }
      }
      if (l === 'Y' && hasP('sourcier')) {
        const pos = reqs.find((q) => g.board[q.r][q.c]?.id === t.id);
        if (pos) {
          const free = [[pos.r - 1, pos.c], [pos.r + 1, pos.c], [pos.r, pos.c - 1], [pos.r, pos.c + 1]]
            .filter(([r, c]) => r >= 0 && r < SIZE && c >= 0 && c < SIZE && !g.board[r][c]);
          if (free.length) { const [r, c] = pick(free); improveCell(g, r, c, pi as 0 | 1); lines.push({ text: '🪄 Le sourcier améliore une case voisine', cls: 'info' }); }
        }
      }
    }
    // Roue.
    for (const q of reqs) {
      const raw = g.cells[q.r][q.c];
      if (raw.t === 'ROUE' && lv.special !== 'zeta') {
        const owner = (raw.o ?? pi) as 0 | 1;
        const n = 3 + 5 * (g.players[owner] ? g.players[owner].powers.filter((x) => x.id === 'chanceux').length : 0);
        const done = improveBaseCells(g, n, owner);
        lines.push({ text: `🎡 La roue tourne : ${done} case${done > 1 ? 's' : ''} améliorée${done > 1 ? 's' : ''}`, cls: 'info' });
      }
    }
    // L'*tranger.
    if (hasP('etranger') && !p.played) {
      const w = wordScores.find((x) => x.word.startsWith('E'));
      if (w) {
        const e = g.board[w.cells[0][0]][w.cells[0][1]];
        if (e && !destroyed.includes(e)) destroyed.push(e);
        const opts = p.rack.filter((x) => x.l !== '#');
        if (opts.length) { const o = pick(opts); o.tex = 'or'; lines.push({ text: `🧳 L’*tranger : le E disparaît, ${letterOf(o)} devient en or`, cls: 'info' }); }
      }
    }
    // Cryptographe : décalage des lettres marquantes (après le score).
    if (hasP('cryptographe')) {
      if (p.crypto === null && opts.crypto !== undefined && opts.crypto !== null) p.crypto = opts.crypto;
      const n = p.crypto ?? 0;
      if (n) {
        const seen = new Set<number>();
        for (const w of wordScores) for (const [r, c] of w.cells) {
          const t = g.board[r][c];
          if (!t || seen.has(t.id) || t.l === '?' || t.l === '#') continue;
          seen.add(t.id);
          t.l = AZ[(AZ.indexOf(t.l) + n) % 26];
        }
        lines.push({ text: `🔐 Cryptographe : lettres décalées de ${n}`, cls: 'info' });
      }
    }
    for (const t of destroyed) destroy(g, t);
    if (opts.cancre) p.cancre = true;
  }
  if (sp === 'nu' && lv.score + score < lv.target) lv.nuFail = true;
  lv.score += score;
  lv.used++;
  p.total += score;
  p.played = true;
  p.lastPlaced = placedTiles.map((t) => t.id);
  if (g.mode === 'compet') g.idle = 0;
  lines.push({ text: `Total : ${score} point${score > 1 ? 's' : ''}`, cls: 'total' });
  if (!prev) log(g, pi, `${wordScores.map((w) => w.word).join(', ')}${bingo ? ' — Scrabble !' : ''}`, 'play', score);
  return { score, lines, words: wordScores, placed, bingo };
}

/** Aperçu du score (sans hasard ni effet secondaire). */
export function previewScore(g: SGame, pi: number, reqs: Req[], infos: WordInfo[]): MoveResult {
  return resolveMove(structuredClone(g), pi, reqs, infos, { preview: true });
}

// ---------- Passer, échanger ----------
export function passTurn(g: SGame, pi: number) {
  const p = g.players[pi];
  p.muet++;
  lvlOf(g, pi).used++;
  if (g.mode === 'compet') g.idle++;
  log(g, pi, 'Passe');
}
export type ExchangeResult = { ok: false; error: string } | { ok: true; endsTurn: boolean; lines: string[] };
export function exchangeTiles(g: SGame, pi: number, ids: number[]): ExchangeResult {
  const p = g.players[pi];
  const lv = lvlOf(g, pi);
  if (lv.special === 'lambda') return { ok: false, error: 'Lambda : vous ne pouvez pas échanger vos tuiles.' };
  const tiles = ids.map((id) => p.rack.find((t) => t.id === id)).filter((t): t is STile => !!t);
  if (!tiles.length) return { ok: false, error: 'Sélectionnez au moins une lettre.' };
  if (tiles.some((t) => t.l === '#')) return { ok: false, error: 'Une tuile verrou ne peut pas être échangée.' };
  if (p.bag.length < tiles.length) return { ok: false, error: `Il ne reste que ${p.bag.length} tuile${p.bag.length > 1 ? 's' : ''} dans votre sac.` };
  const lines: string[] = [];
  p.rack = p.rack.filter((t) => !tiles.includes(t));
  for (const t of tiles) {
    if (!fxOn(g, pi, t)) continue;
    for (let a = 0; a < acts(t); a++) {
      if (t.pas.includes('bleue')) { p.money += 8; lines.push(`🔵 ${letterOf(t)} : +8 $`); }
      if (t.ed === 'poly') { t.bonus += 3; lines.push(`🎨 ${letterOf(t)} polychrome : +3 de valeur`); }
    }
  }
  lines.push(...refill(g, pi));
  for (const t of tiles) p.bag.splice(ri(p.bag.length + 1), 0, t);
  p.eboueur += tiles.length;
  const endsTurn = !tiles.every((t) => t.tex === 'bois');
  if (endsTurn) {
    p.muet++;
    lv.used++;
    if (g.mode === 'compet') g.idle++;
  }
  log(g, pi, `Échange de ${tiles.length} lettre${tiles.length > 1 ? 's' : ''}${endsTurn ? '' : ' en bois (le tour continue)'}`);
  return { ok: true, endsTurn, lines };
}

// ---------- Fin de tour ----------
export interface TurnEnd {
  lines: string[];
  /** Points marqués après le coup (western, infection, toxique). */
  extra: number;
  levelDone?: { player: number; reward: number; details: string[] };
  cleared?: boolean;
  over?: boolean;
}

/** Western : les mots formés après son déplacement comptent. */
async function westernMoves(g: SGame, pi: number, placed: Set<number>, lex: Lex, out: TurnEnd) {
  const ws: [number, number, STile][] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const t = g.board[r][c];
    if (t?.font === 'western' && !placed.has(t.id) && fxOn(g, t.own, t)) ws.push([r, c, t]);
  }
  for (const [r, c, t] of ws) {
    const free = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([rr, cc]) => rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && !g.board[rr][cc]);
    if (!free.length) continue;
    const [nr, nc] = pick(free);
    g.board[r][c] = null;
    g.board[nr][nc] = t;
    const words: { word: string; tiles: STile[] }[] = [];
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      let rr = nr, cc = nc;
      while (rr - dr >= 0 && cc - dc >= 0 && g.board[rr - dr][cc - dc]) { rr -= dr; cc -= dc; }
      const tiles: STile[] = [];
      for (; rr < SIZE && cc < SIZE && g.board[rr][cc]; rr += dr, cc += dc) tiles.push(g.board[rr][cc]!);
      if (tiles.length >= 2) words.push({ word: tiles.map(letterOf).join(''), tiles });
    }
    const bad = new Set(words.length ? await lex.invalid(words.map((w) => w.word)) : []);
    let pts = 0;
    for (const w of words) if (!bad.has(w.word)) pts += w.tiles.reduce((s, x) => s + tileValue(g, x), 0);
    out.lines.push(`🤠 ${letterOf(t)} western se déplace${pts ? ` et forme ${words.filter((w) => !bad.has(w.word)).map((w) => w.word).join(', ')} : +${pts}` : ''}`);
    if (pts) addPoints(g, t.own, pts, out, pi);
  }
}
function addPoints(g: SGame, to: number, pts: number, out: TurnEnd, cur: number) {
  const target = g.mode === 'compet' ? to : cur;
  lvlOf(g, target).score += pts;
  g.players[to].total += pts;
  out.extra += pts;
}

function moveSpecialCell(g: SGame, r: number, c: number): boolean {
  const free = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([rr, cc]) => rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && !g.board[rr][cc]);
  if (!free.length) return false;
  const [nr, nc] = pick(free);
  [g.cells[r][c], g.cells[nr][nc]] = [g.cells[nr][nc], g.cells[r][c]];
  return true;
}

/**
 * Fin du tour du joueur pi : effets de fin de tour, pioche, vérification de l'objectif, puis début du tour suivant.
 * `placedIds` : tuiles posées pendant ce tour (vide si passe ou échange).
 */
export async function endTurn(g: SGame, pi: number, placedIds: number[], lex: Lex): Promise<TurnEnd> {
  const out: TurnEnd = { lines: [], extra: 0 };
  const p = g.players[pi];
  const lv = lvlOf(g, pi);
  const sp = lv.special;
  const placed = new Set(placedIds);

  // Chevalet : toxique et pastille violette.
  for (const t of p.rack) {
    if (!fxOn(g, pi, t)) continue;
    for (let a = 0; a < acts(t); a++) {
      if (t.ed === 'toxique') { lv.score -= 10; p.total -= 10; out.extra -= 10; out.lines.push(`☣️ ${letterOf(t)} toxique : −10`); }
      if (t.pas.includes('violette')) { p.money += 6; out.lines.push(`🟣 ${letterOf(t)} : +6 $`); }
    }
  }
  // Infection : seulement les tuiles infectées par ce joueur, présentes au début de cette étape.
  const infected: [number, number, STile][] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const t = g.board[r][c];
    if (t?.font === 'infection' && t.inf === pi && fxOn(g, pi, t)) infected.push([r, c, t]);
  }
  const toInfect: STile[] = [];
  let infPts = 0;
  for (const [r, c, t] of infected) {
    let alive = true;
    for (let a = 0; a < acts(t) && alive; a++) {
      infPts += 5;
      if (chance(0.2)) { alive = false; destroy(g, t); out.lines.push(`🦠 ${letterOf(t)} infectée se désagrège`); break; }
      for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        const n = g.board[rr]?.[cc];
        if (n && !(n.font === 'infection' && n.inf === pi)) toInfect.push(n);
      }
    }
  }
  for (const t of toInfect) { t.font = 'infection'; t.inf = pi as 0 | 1; }
  if (toInfect.length) out.lines.push(`🦠 L’infection se propage (${new Set(toInfect).size} tuile${toInfect.length > 1 ? 's' : ''})`);
  // Western, MQ mouvant, bonus aléatoires.
  await westernMoves(g, pi, placed, lex, out);
  const mq: [number, number][] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (g.cells[r][c].t === 'MQM') mq.push([r, c]);
  for (const [r, c] of mq) moveSpecialCell(g, r, c);
  for (const row of g.cells) for (const cell of row) if (cell.t === 'RND') cell.rnd = pick(['MD', 'MT', 'LD', 'LT'] as const);
  // Niveaux spéciaux.
  if (sp === 'eta') {
    const mine: [number, number][] = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const cell = g.cells[r][c];
      if (!isBaseCell(cell) && (g.mode !== 'compet' || cell.o === undefined || cell.o === pi)) mine.push([r, c]);
    }
    if (mine.length && moveSpecialCell(g, ...pick(mine))) out.lines.push('Η Une case spéciale se déplace');
  }
  const onBoard = (): STile[] => {
    const a: STile[] = [];
    for (const row of g.board) for (const t of row) if (t && t.l !== '#' && (g.mode !== 'compet' || t.own === pi)) a.push(t);
    return a;
  };
  if (sp === 'theta') {
    const a = onBoard();
    if (a.length) { const t = pick(a); t.bonus -= 5; out.lines.push(`Θ ${letterOf(t)} perd 5 points de valeur`); }
  }
  if (sp === 'iota') {
    const a = onBoard().filter((t) => t.l !== '?');
    if (a.length) {
      const t = pick(a);
      if (t.l === 'A') { destroy(g, t); out.lines.push('Ι Un A est détruit'); }
      else { const before = t.l; t.l = AZ[AZ.indexOf(t.l) - 1]; out.lines.push(`Ι ${before} devient ${t.l}`); }
    }
  }
  if (sp === 'xi') { addToBag(g, pi, [newTile(g, '#', pi as 0 | 1)]); out.lines.push('Ξ Une tuile verrou 🔒 rejoint votre sac'); }
  if (sp === 'omicron') {
    const a = p.rack.filter((t) => t.l !== '#' && t.ed !== 'toxique');
    if (a.length) { const t = pick(a); t.ed = 'toxique'; out.lines.push(`Ο ${letterOf(t)} devient toxique`); }
  }
  if (infPts) { addPoints(g, pi, infPts, out, pi); out.lines.push(`🦠 Infection : +${infPts}`); }

  out.lines.push(...refill(g, pi));
  if (out.lines.length) log(g, pi, out.lines.join(' · '), 'info');

  // Objectif.
  if (g.mode === 'compet') {
    if (g.idle >= 2) {
      g.idle = 0;
      if (g.clears >= 2) {
        g.clears++;
        finishCompet(g, 'Troisième blocage du plateau : fin de la partie.');
        out.over = true;
        return out;
      }
      clearBoard(g);
      g.clears++;
      out.cleared = true;
      log(g, pi, `Les deux joueurs ont passé : le plateau est vidé (${g.clears}/2 avant la fin).`, 'bad');
    }
    const done = checkCompet(g, pi);
    if (done) { out.levelDone = done; return out; }
  } else {
    if (lv.nuFail) return lose(g, out, 'Nu : votre coup n’a pas atteint l’objectif.');
    if (levelComplete(g)) { out.levelDone = completeLevel(g); return out; }
    if (lv.used >= lv.moves) {
      const who = g.players.findIndex((x) => x.powers.some((y) => y.id === 'sauveteur'));
      if (who >= 0 && lv.score >= 0) {
        const s = g.players[who];
        s.powers.splice(s.powers.findIndex((y) => y.id === 'sauveteur'), 1);
        log(g, who, '🛟 Le sauveteur se sacrifie et valide le niveau !', 'level');
        out.levelDone = completeLevel(g);
        return out;
      }
      return lose(g, out, `Plus de coup : ${lv.score} points sur ${lv.target}.`);
    }
  }
  g.cur = (g.players.length === 2 ? 1 - pi : 0) as 0 | 1;
  out.lines.push(...beginTurn(g));
  return out;
}

function lose(g: SGame, out: TurnEnd, why: string): TurnEnd {
  g.phase = 'over';
  g.overText = `Défaite au niveau ${g.lvl.n}. ${why}`;
  log(g, g.cur, g.overText, 'bad');
  out.over = true;
  return out;
}

const upsilonOk = (g: SGame, pis: number[]) => lvlOf(g, pis[0]).special !== 'upsilon' || pis.every((i) => g.players[i].sold);
function levelComplete(g: SGame): boolean {
  const lv = g.lvl;
  return lv.score >= lv.target && (lv.special !== 'gamma' || lv.gamma) && upsilonOk(g, g.players.map((_, i) => i));
}
/** Après une vente (Upsilon) : le niveau est-il réussi ? */
export function checkAfterSale(g: SGame, pi: number): TurnEnd['levelDone'] | null {
  if (g.phase !== 'play') return null;
  if (g.mode === 'compet') return checkCompet(g, pi);
  return levelComplete(g) ? completeLevel(g) : null;
}

/** Effets de fin de niveau propres à un joueur (pastille verte, mécano, bombardier, nettoyeur). */
function levelEndEffects(g: SGame, pi: number, details: string[]) {
  const p = g.players[pi];
  for (const t of p.rack) {
    if (t.pas.includes('verte') && fxOn(g, pi, t)) for (let a = 0; a < acts(t); a++) { p.money += 12; details.push(`🟢 ${letterOf(t)} : +12 $`); }
  }
  for (const x of p.powers) {
    if (x.id === 'mecano') {
      const r = ri(SIZE), c = ri(SIZE);
      improveCell(g, r, c, pi as 0 | 1);
      details.push('🔧 Le mécano améliore une case');
    }
    if (x.id === 'bombardier' && improveBaseCells(g, 1, pi as 0 | 1)) details.push('💣 Le bombardier améliore une case');
    if (x.id === 'nettoyeur') {
      let n = 0;
      for (const id of p.lastPlaced) {
        const t = findTile(g, id);
        if (t && t.l !== '?') { t.l = '?'; delete t.as; n++; }
      }
      if (n) details.push(`🧽 Le nettoyeur : ${n} joker${n > 1 ? 's' : ''}`);
    }
  }
}
function findTile(g: SGame, id: number): STile | null {
  for (const row of g.board) for (const t of row) if (t?.id === id) return t;
  for (const p of g.players) for (const t of [...p.rack, ...p.bag]) if (t.id === id) return t;
  return null;
}

/** Solo / coopération : niveau réussi. */
function completeLevel(g: SGame): NonNullable<TurnEnd['levelDone']> {
  const lv = g.lvl;
  const details: string[] = [];
  g.players.forEach((_, i) => levelEndEffects(g, i, details));
  const left = Math.max(0, lv.moves - lv.used);
  const over = Math.max(0, Math.floor((lv.score - lv.target) / 10));
  const reward = baseReward(lv) + left + over;
  for (const p of g.players) p.money += reward;
  details.unshift(`Niveau ${lv.special ? 'spécial' : 'normal'} : ${baseReward(lv)} $`, `${left} coup${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''} : ${left} $`, `${over * 10} points au-delà de l’objectif : ${over} $`);
  log(g, 0, `Niveau ${lv.n} réussi : ${lv.score} / ${lv.target} — +${reward} $${g.mode === 'coop' ? ' chacun' : ''}`, 'level');
  // Les tuiles retournent dans les sacs ; les cases et les tuiles améliorées restent.
  clearBoard(g);
  for (let i = 0; i < g.players.length; i++) { const p = g.players[i]; p.bag.push(...p.rack); p.rack = []; shuffle(p.bag); }
  if (lv.n === LAST_LEVEL && !g.continued) g.won = true;
  // Niveau suivant.
  const n = lv.n + 1;
  const special = isSpecialLevel(n) ? g.next : null;
  if (special) g.next = randomSpecial(n + 3);
  g.lvl = newLevel(n, special);
  g.phase = 'shop';
  g.shopQueue = g.players.map((_, i) => i);
  openShop(g, 0);
  return { player: 0, reward, details };
}

/** Compétition : le joueur pi a-t-il atteint son objectif ? */
function checkCompet(g: SGame, pi: number): TurnEnd['levelDone'] | null {
  const lv = lvlOf(g, pi);
  if (!(lv.score >= lv.target && (lv.special !== 'gamma' || lv.gamma) && upsilonOk(g, [pi]))) return null;
  return competLevelUp(g, pi, !lv.nuFail);
}
function competLevelUp(g: SGame, pi: number, rewarded: boolean, shop = rewarded): NonNullable<TurnEnd['levelDone']> {
  const p = g.players[pi];
  const lv = p.lvl!;
  const details: string[] = [];
  levelEndEffects(g, pi, details);
  let reward = 0;
  if (rewarded) {
    const over = Math.max(0, Math.floor((lv.score - lv.target) / 10));
    reward = competReward(lv) + over;
    details.unshift(`Récompense du niveau après ${lv.used} tour${lv.used > 1 ? 's' : ''} : ${competReward(lv)} $`, `${over * 10} points au-delà de l’objectif : ${over} $`);
    p.money += reward;
  } else details.unshift('Pas de récompense pour ce niveau.');
  log(g, pi, `${p.name} réussit le niveau ${lv.n} (${lv.score} / ${lv.target})${rewarded ? ` : ${reward >= 0 ? '+' : ''}${reward} $` : ''}`, 'level');
  const n = lv.n + 1;
  const special = isSpecialLevel(n) ? p.next! : null;
  if (special) p.next = randomSpecial(n + 3);
  p.lvl = newLevel(n, special);
  resetLevelStats(p);
  if (shop) {
    g.phase = 'shop';
    g.shopQueue = [pi];
    openShop(g, pi);
  } else {
    g.cur = (1 - pi) as 0 | 1;
    beginTurn(g);
  }
  return { player: pi, reward, details };
}

function resetLevelStats(p: SPlayer) {
  p.muet = 0; p.eboueur = 0; p.cancre = false; p.sold = false; p.played = false; p.crypto = null;
}

/** Compétition : retire toutes les tuiles du plateau (elles retournent chez leurs propriétaires). */
function clearBoard(g: SGame) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const t = g.board[r][c];
    if (!t) continue;
    g.board[r][c] = null;
    delete t.as;
    const owner = g.players[t.own] ?? g.players[0];
    owner.bag.splice(ri(owner.bag.length + 1), 0, t);
  }
}

function finishCompet(g: SGame, why: string) {
  g.phase = 'over';
  const [a, b] = g.players;
  const res = a.total === b.total ? `Égalité : ${a.total} partout.`
    : `${a.total > b.total ? a.name : b.name} gagne, ${Math.max(a.total, b.total)} à ${Math.min(a.total, b.total)}.`;
  g.overText = `${why} ${res}`;
  log(g, 0, g.overText, 'level');
}

/** Début du tour de g.cur : zombie, désinfecteur, Rhô, Psi, idole. */
export function beginTurn(g: SGame): string[] {
  const pi = g.cur;
  const p = g.players[pi];
  const lv = lvlOf(g, pi);
  const out: string[] = [];
  p.idole = pick(['A', 'E', 'I', 'O', 'U']);
  p.psi = lv.special === 'psi' && p.powers.length ? pick(p.powers).uid : undefined;
  const rho = p.rack.filter((t) => t.l !== '#');
  p.rho = lv.special === 'rho' && rho.length ? pick(rho).id : undefined;
  for (const x of [...p.powers]) {
    if (x.uid === p.psi) continue;
    if (x.id === 'zombie' && chance(0.1)) {
      const targets: STile[] = [];
      for (const row of g.board) for (const t of row) if (t && !(t.font === 'infection' && t.inf === pi)) targets.push(t);
      if (targets.length) {
        const t = pick(targets);
        t.font = 'infection'; t.inf = pi;
        p.powers = p.powers.filter((y) => y.uid !== x.uid);
        out.push(`🧟 Le zombie infecte ${letterOf(t)} et disparaît`);
      }
    }
    if (x.id === 'desinfecteur') {
      let n = 0;
      const tiles: STile[] = [...p.rack];
      for (const row of g.board) for (const t of row) if (t) tiles.push(t);
      for (const t of tiles) {
        if (t.font === 'infection') { delete t.font; delete t.inf; n++; }
        if (t.ed === 'toxique') { delete t.ed; n++; }
      }
      if (n) { x.n += n; out.push(`🧴 Le désinfecteur soigne ${n} tuile${n > 1 ? 's' : ''}`); }
    }
  }
  if (out.length) log(g, pi, out.join(' · '), 'info');
  return out;
}

/** Début d'un niveau (après le magasin) : pioche et premier tour. */
function startLevel(g: SGame): string[] {
  for (const p of g.players) resetLevelStats(p);
  const out: string[] = [];
  g.players.forEach((_, i) => out.push(...refill(g, i)));
  g.phase = 'play';
  g.cur = 0;
  const lv = g.lvl;
  log(g, 0, `Niveau ${lv.n}${lv.special ? ` — ${SPECIALS[lv.special].letter} ${SPECIALS[lv.special].name}` : ''} : ${lv.target} points en ${lv.moves} coups.`, 'level');
  if (lv.special === 'upsilon' && g.players.some((p) => !p.powers.length)) {
    g.phase = 'over';
    g.overText = 'Upsilon : il faut une tuile pouvoir à vendre pour ce niveau. Partie perdue.';
    log(g, 0, g.overText, 'bad');
    return out;
  }
  out.push(...beginTurn(g));
  return out;
}

// ---------- Magasin ----------
function tilePrice(t: STile): number {
  let p = 2 + Math.floor(t.bonus / 5);
  if (t.tex) p += TEXTURES[t.tex].price;
  if (t.ed) p += EDITIONS[t.ed].price;
  if (t.font) p += FONTS[t.font].price;
  for (const x of t.pas) p += PASTILLES[x].price;
  for (const x of t.sty) p += STYLES[x].price;
  return p;
}
function cellPrice(c: Cell): number {
  return (c.t ? CELL_TYPES[c.t].price : 0) + (c.x ? CELL_TEX[c.x].price : 0);
}
const LETTER_POOL = Object.entries(LETTERS).filter(([l]) => l !== '?').flatMap(([l, { count: n }]) => Array<string>(n).fill(l));
/** Tuile spéciale du magasin : valeur bonus de 0 à 20 et au moins une particularité. */
export function randomSpecialTile(g: SGame, own: 0 | 1, vowel?: boolean): STile {
  const pool = vowel === undefined ? LETTER_POOL : LETTER_POOL.filter((l) => isVowel(l) === vowel);
  const t = newTile(g, chance(0.04) && vowel === undefined ? '?' : pick(pool), own);
  t.bonus = weighted([[0, 30], [ri(5) + 1, 30], [ri(10) + 5, 20], [ri(11) + 10, 8]] as [number, number][]);
  const mods = () => {
    if (chance(0.45)) t.tex = pick(['bronze', 'argent', 'or', 'bois', 'verre', 'papier', 'pierre'] as Texture[]);
    if (chance(0.15)) t.ed = pick(['holo', 'poly'] as Edition[]);
    if (chance(0.2)) t.font = pick(['casino', 'console', 'western', 'calli'] as Font[]);
    if (chance(0.2)) t.pas.push(pick(Object.keys(PASTILLES) as Pastille[]));
    if (chance(0.15)) t.sty.push(pick(Object.keys(STYLES) as Style[]));
  };
  mods();
  if (!t.tex && !t.ed && !t.font && !t.pas.length && !t.sty.length && t.bonus === 0) improveTile(t);
  return t;
}
function powerWeights(g: SGame, pi: number): [PowerId, number][] {
  const zombie = g.players.some((p) => p.powers.some((x) => x.id === 'zombie'));
  const mine = new Set(g.players[pi].powers.map((x) => x.id));
  return POWER_IDS.filter((id) => !mine.has(id)).map((id) => [id, RARITY_WEIGHT[POWERS[id].rarity] * (id === 'desinfecteur' && zombie ? 12 : 1)]);
}
function randomOffer(g: SGame, pi: number, kind: PackKind): Offer {
  switch (kind) {
    case 'tile': return { kind, tile: randomSpecialTile(g, pi as 0 | 1) };
    case 'cell': return { kind, cell: randomCell() };
    case 'power': return { kind, id: weighted(powerWeights(g, pi)) };
    case 'program': return { kind, id: pick(PROGRAM_IDS) };
    default: return { kind: 'upgrade', letter: pick(Object.keys(LETTERS).filter((l) => l !== '?')) };
  }
}
export function offerPrice(o: Offer): number {
  switch (o.kind) {
    case 'tile': return tilePrice(o.tile);
    case 'cell': return cellPrice(o.cell);
    case 'power': return POWER_PRICE[POWERS[o.id].rarity];
    case 'program': return PROGRAM_PRICE;
    default: return UPGRADE_PRICE;
  }
}
export const packPrice = (of: PackKind, size: 3 | 6) => (of === 'power' ? 6 : size === 3 ? 4 : 6);

function genShop(g: SGame, pi: number): ShopItem[] {
  const items: ShopItem[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 3; i++) {
    let o: Offer;
    let guard = 0;
    do {
      const kind = weighted<PackKind>([['power', 34], ['tile', 24], ['cell', 18], ['program', 14], ['upgrade', 10]]);
      o = randomOffer(g, pi, kind);
      guard++;
    } while (o.kind === 'power' && used.has(o.id) && guard < 20);
    if (o.kind === 'power') used.add(o.id);
    items.push({ ...o, price: offerPrice(o) });
  }
  for (let i = 0; i < 2; i++) {
    const of = weighted<PackKind>([['tile', 22], ['power', 18], ['cell', 22], ['program', 22], ['upgrade', 16]]);
    const size: 3 | 6 = of === 'power' ? 3 : chance(0.35) ? 6 : 3;
    items.push({ kind: 'pack', of, size, price: packPrice(of, size) });
  }
  return items;
}
export function openShop(g: SGame, pi: number) {
  g.players[pi].shop = { items: genShop(g, pi), reroll: REROLL_PRICE, bought: false };
}
export function rerollShop(g: SGame, pi: number): string | null {
  const s = g.players[pi].shop!;
  const p = g.players[pi];
  if (p.money < s.reroll) return 'Pas assez d’argent.';
  p.money -= s.reroll;
  s.reroll++;
  s.items = genShop(g, pi);
  return null;
}
/** Prix réel d'un article (dénicheur : moitié prix sur le premier achat). */
export function priceFor(g: SGame, pi: number, base: number): number {
  const s = g.players[pi].shop;
  return s && !s.bought && owns(g, pi, 'denicheur') ? Math.ceil(base / 2) : base;
}

export type BuyResult = { ok: false; error: string } | { ok: true; msg: string };
export function buy(g: SGame, pi: number, idx: number): BuyResult {
  const p = g.players[pi];
  const s = p.shop;
  const it = s?.items[idx];
  if (!s || !it || it.sold) return { ok: false, error: 'Article indisponible.' };
  if (g.pending) return { ok: false, error: 'Terminez d’abord l’achat en cours.' };
  const price = priceFor(g, pi, it.price);
  if (p.money < price) return { ok: false, error: 'Pas assez d’argent.' };
  if (it.kind === 'power' && p.powers.length >= MAX_POWERS) return { ok: false, error: `${MAX_POWERS} tuiles pouvoir au maximum : vendez-en une d’abord.` };
  p.money -= price;
  s.bought = true;
  it.sold = true;
  if (it.kind === 'pack') {
    const offers: Offer[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < it.size; i++) {
      let o: Offer, guard = 0;
      do { o = randomOffer(g, pi, it.of); guard++; } while (o.kind === 'power' && seen.has(o.id) && guard < 20);
      if (o.kind === 'power') seen.add(o.id);
      offers.push(o);
    }
    g.pending = { type: 'choose', title: packTitle(it.of, it.size), offers };
    g.pendingFor = pi as 0 | 1;
    return { ok: true, msg: 'Choisissez un élément du paquet.' };
  }
  return applyOffer(g, pi, it);
}
export function packTitle(of: PackKind, size: number) {
  return { tile: `Paquet de ${size} tuiles lettres`, cell: `Paquet de ${size} cases`, power: `Paquet de ${size} pouvoirs`,
    program: `Paquet de ${size} programmes`, upgrade: `Paquet de ${size} améliorations de lettre` }[of];
}

export function applyOffer(g: SGame, pi: number, o: Offer): BuyResult {
  const p = g.players[pi];
  g.pending = null;
  switch (o.kind) {
    case 'tile': {
      const t = { ...structuredClone(o.tile), id: ++g.seq };
      addToBag(g, pi, [t]);
      return { ok: true, msg: `Tuile ${letterOf(t) === '?' ? 'joker' : letterOf(t)} ajoutée à votre sac.` };
    }
    case 'cell':
      g.pending = { type: 'cell', cell: structuredClone(o.cell) };
      g.pendingFor = pi as 0 | 1;
      return { ok: true, msg: 'Touchez la case du plateau à améliorer.' };
    case 'power':
      if (p.powers.length >= MAX_POWERS) return { ok: false, error: `${MAX_POWERS} tuiles pouvoir au maximum.` };
      p.powers.push({ uid: ++g.seq, id: o.id, price: POWER_PRICE[POWERS[o.id].rarity], n: 0 });
      return { ok: true, msg: `${POWERS[o.id].name} rejoint vos pouvoirs.` };
    case 'program': return startProgram(g, pi, o.id, false);
    default: {
      p.up[o.letter] = (p.up[o.letter] ?? 0) + baseValue(o.letter);
      return { ok: true, msg: `Toutes vos tuiles ${o.letter} valent désormais ${baseValue(o.letter) + p.up[o.letter]} points.` };
    }
  }
}
/** Le joueur renonce au paquet ouvert. */
export function skipPending(g: SGame) {
  const pd = g.pending;
  if (pd?.type === 'program' && !pd.fromReserve) { const p = g.players[g.pendingFor]; p.bag.push(...pd.drawn); shuffle(p.bag); }
  g.pending = null;
}

export function placeCell(g: SGame, pi: number, r: number, c: number): BuyResult {
  if (g.pending?.type !== 'cell') return { ok: false, error: 'Aucune case à poser.' };
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return { ok: false, error: 'Case hors du plateau.' };
  g.cells[r][c] = mergeCell(g.cells[r][c], g.pending.cell, pi as 0 | 1);
  g.pending = null;
  return { ok: true, msg: 'Case améliorée.' };
}

export function sellPower(g: SGame, pi: number, uid: number): BuyResult {
  const p = g.players[pi];
  const i = p.powers.findIndex((x) => x.uid === uid);
  if (i < 0) return { ok: false, error: 'Pouvoir introuvable.' };
  const x = p.powers[i];
  const value = Math.max(1, Math.floor(x.price / 2));
  p.powers.splice(i, 1);
  p.money += value;
  p.sold = true;
  let msg = `${POWERS[x.id].name} vendu : +${value} $.`;
  if (x.id === 'vendeur' && p.powers.length) {
    const src = pick(p.powers);
    p.powers.push({ uid: ++g.seq, id: src.id, price: src.price, n: 0 });
    msg += ` Copie de ${POWERS[src.id].name} obtenue.`;
  }
  log(g, pi, msg, 'info');
  if (x.id === 'sauveteur' && g.mode === 'compet' && g.phase === 'play') {
    competLevelUp(g, pi, false, false);
    msg += ' Le sauveteur vous fait passer au niveau suivant.';
  }
  return { ok: true, msg };
}
export function movePower(g: SGame, pi: number, uid: number, dir: -1 | 1) {
  const a = g.players[pi].powers;
  const i = a.findIndex((x) => x.uid === uid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
}

/** Quitte le magasin : joueur suivant au magasin, ou reprise du jeu. */
export function leaveShop(g: SGame): string[] {
  const pi = g.shopQueue.shift();
  if (pi !== undefined) delete g.players[pi].shop;
  if (g.pending?.type === 'program') skipPending(g);
  g.pending = null;
  if (g.shopQueue.length) { openShop(g, g.shopQueue[0]); return []; }
  if (g.mode === 'compet') {
    const first = g.players.every((p) => !p.rack.length) && g.board.every((r) => r.every((t) => !t));
    g.phase = 'play';
    if (first) {
      g.players.forEach((_, i) => refill(g, i));
      g.cur = 0;
      log(g, 0, 'Que la compétition commence !', 'level');
    } else g.cur = (1 - (pi ?? 0)) as 0 | 1;
    return beginTurn(g);
  }
  return startLevel(g);
}

// ---------- Programmes ----------
export function startProgram(g: SGame, pi: number, id: ProgramId, fromReserve: boolean): BuyResult {
  const p = g.players[pi];
  const info = PROGRAMS[id];
  if (fromReserve) p.reserve = null;
  if (info.pick || info.draws) {
    let drawn: STile[] = [];
    if (!fromReserve) {
      const n = rackSize(g, pi);
      drawn = shuffle([...p.bag]).filter((t) => t.l !== '#').slice(0, n);
      p.bag = p.bag.filter((t) => !drawn.includes(t));
    }
    if (!info.pick) {
      // Boosts : une tuile détruite au hasard, trois tuiles améliorées ajoutées.
      const pool = fromReserve ? p.rack.filter((t) => t.l !== '#') : drawn;
      const lines: string[] = [];
      if (pool.length) { const t = pick(pool); destroy(g, t); drawn = drawn.filter((x) => x !== t); lines.push(`${letterOf(t)} détruite`); }
      const added = [0, 1, 2].map(() => randomSpecialTile(g, pi as 0 | 1, id === 'boostV'));
      addToBag(g, pi, added);
      p.bag.push(...drawn);
      shuffle(p.bag);
      finishProgramCommon(g, pi, id);
      return { ok: true, msg: `${info.name} : ${lines.join(', ')}${lines.length ? ' ; ' : ''}${added.map(letterOf).join(', ')} ajoutées à votre sac.` };
    }
    g.pending = { type: 'program', id, fromReserve, drawn };
    g.pendingFor = pi as 0 | 1;
    return { ok: true, msg: `${info.name} : ${info.pick[0] === info.pick[1] ? `choisissez ${info.pick[0]} tuile${info.pick[0] > 1 ? 's' : ''}` : `choisissez jusqu’à ${info.pick[1]} tuiles`}.` };
  }
  let msg = '';
  if (id === 'sauver') {
    if (p.lastProgram) { p.reserve = p.lastProgram; msg = `${PROGRAMS[p.lastProgram].name} est copié dans votre réserve.`; }
    else msg = 'Aucun programme utilisé jusqu’ici : rien à sauver.';
  } else if (id === 'police') {
    const opts = p.bag.filter((t) => !t.font && t.l !== '#');
    if (opts.length) { const t = pick(opts); t.font = pick(['casino', 'console', 'western', 'calli'] as Font[]); msg = `Une tuile ${letterOf(t)} de votre sac reçoit la police ${FONTS[t.font].name}.`; }
    else msg = 'Aucune tuile sans police dans votre sac.';
  } else if (id === 'investissement') {
    const n = Math.max(0, Math.floor(p.money / 2));
    p.money += n;
    msg = `Investissement : +${n} $.`;
  } else if (id === 'trading') {
    const n = ri(21);
    p.money += n;
    msg = `Trading : +${n} $.`;
  }
  finishProgramCommon(g, pi, id);
  return { ok: true, msg };
}
function finishProgramCommon(g: SGame, pi: number, id: ProgramId) {
  if (id !== 'sauver') g.players[pi].lastProgram = id;
  log(g, pi, `Programme ${PROGRAMS[id].name}`, 'info');
}

/** Exécute un programme à choix sur les tuiles sélectionnées (dans l'ordre de sélection). */
export function runProgram(g: SGame, pi: number, ids: number[], letter?: string): BuyResult {
  const pd = g.pending;
  if (pd?.type !== 'program') return { ok: false, error: 'Aucun programme en cours.' };
  const p = g.players[pi];
  const info = PROGRAMS[pd.id];
  const pool = pd.fromReserve ? p.rack : pd.drawn;
  const sel = ids.map((id) => pool.find((t) => t.id === id)).filter((t): t is STile => !!t && t.l !== '#');
  const [min, max] = info.pick!;
  if (sel.length < Math.min(min, pool.length) || sel.length > max) return { ok: false, error: `Sélectionnez ${min === max ? min : `de ${min} à ${max}`} tuile${max > 1 ? 's' : ''}.` };
  if (pd.id === 'ecriture' && !(letter && /^[A-Z]$/.test(letter))) return { ok: false, error: 'Choisissez la nouvelle lettre.' };
  for (const t of sel) if (t.font === 'console') t.bonus += 5;
  const gone = new Set<number>();
  let msg = '';
  const L = (t: STile) => (letterOf(t) === '?' ? 'joker' : letterOf(t));
  switch (pd.id) {
    case 'clonage': {
      const [a, b] = sel;
      if (a && b) { const id = a.id; Object.assign(a, structuredClone(b), { id }); msg = `${L(a)} est désormais une copie de ${L(b)}.`; }
      break;
    }
    case 'poubelle':
      for (const t of sel) { destroy(g, t); gone.add(t.id); }
      msg = sel.length ? `${sel.map(L).join(', ')} détruite${sel.length > 1 ? 's' : ''}.` : 'Aucune tuile détruite.';
      break;
    case 'ecriture': sel[0].l = letter!; delete sel[0].as; msg = `La tuile devient un ${letter}.`; break;
    case 'plus': for (const t of sel) t.bonus += 5; msg = `+5 sur ${sel.map(L).join(', ') || 'aucune tuile'}.`; break;
    case 'fois':
      for (const t of sel) { const v = tileValue(g, t); t.bonus += Math.round(v * 1.5) - v; }
      msg = `×1,5 sur ${sel.map(L).join(', ') || 'aucune tuile'}.`;
      break;
    case 'etincelles':
      if (chance(0.5)) { sel[0].ed = pick(['holo', 'poly'] as Edition[]); msg = `${L(sel[0])} devient ${EDITIONS[sel[0].ed].name.toLowerCase()} !`; }
      else msg = 'Pas d’étincelle cette fois…';
      break;
    case 'verre': case 'pierre': case 'papier':
      sel[0].tex = pd.id; sel[0].wear = 0; msg = `${L(sel[0])} devient en ${pd.id}.`; break;
    case 'metal':
      for (const t of sel) t.tex = pick(['bronze', 'argent', 'or'] as Texture[]);
      msg = sel.map((t) => `${L(t)} en ${t.tex}`).join(', ') + '.';
      break;
    case 'bois': for (const t of sel) t.tex = 'bois'; msg = `${sel.map(L).join(', ') || 'Aucune tuile'} en bois.`; break;
    case 'pastilles':
      for (const t of sel) {
        const free = (Object.keys(PASTILLES) as Pastille[]).filter((x) => !t.pas.includes(x));
        if (free.length) t.pas.push(pick(free));
      }
      msg = sel.map((t) => `${L(t)} ${t.pas.map((x) => PASTILLES[x].icon).join('')}`).join(', ') + '.';
      break;
    case 'gras': case 'italique': case 'souligne':
      for (const t of sel) if (!t.sty.includes(pd.id)) t.sty.push(pd.id);
      msg = `${sel.map(L).join(', ')} : ${STYLES[pd.id].name.toLowerCase()}.`;
      break;
    case 'gomme': sel[0].l = '?'; delete sel[0].as; msg = 'La tuile devient un joker.'; break;
    case 'transfert': {
      const [a, b] = sel;
      if (a && b) {
        b.bonus += a.bonus; a.bonus = 0;
        for (const k of ['tex', 'ed', 'font', 'inf', 'wear'] as const) if (a[k] !== undefined) { (b as unknown as Record<string, unknown>)[k] = a[k]; delete a[k]; }
        b.pas = [...new Set([...b.pas, ...a.pas])]; a.pas = [];
        b.sty = [...new Set([...b.sty, ...a.sty])]; a.sty = [];
        msg = `Les particularités de ${L(a)} passent à ${L(b)}.`;
      }
      break;
    }
    default: break;
  }
  if (!pd.fromReserve) { p.bag.push(...pd.drawn.filter((t) => !gone.has(t.id))); shuffle(p.bag); }
  g.pending = null;
  finishProgramCommon(g, pi, pd.id);
  return { ok: true, msg };
}
/** Programme de la réserve, utilisable à tout moment. */
export function useReserve(g: SGame, pi: number): BuyResult {
  const p = g.players[pi];
  if (!p.reserve) return { ok: false, error: 'Réserve vide.' };
  if (g.pending) return { ok: false, error: 'Terminez d’abord l’action en cours.' };
  const id = p.reserve;
  p.reserve = null;
  // En jeu, on choisit parmi les lettres du chevalet ; au magasin (chevalet vide), on pioche dans le sac.
  return startProgram(g, pi, id, g.phase === 'play');
}

// ---------- Sauvegarde ----------
const SAVE_KEY = 'scrabble-fr-scralatro';
export function saveScralatro(g: SGame | null) {
  try { if (g) localStorage.setItem(SAVE_KEY, JSON.stringify(g)); else localStorage.removeItem(SAVE_KEY); } catch { /* stockage indisponible */ }
}
export function loadScralatro(): SGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const g = raw ? (JSON.parse(raw) as SGame) : null;
    return g && g.v === 1 ? g : null;
  } catch { return null; }
}

/** Le joueur pi continue après la victoire au niveau 15. */
export function continueAfterWin(g: SGame) { g.won = false; g.continued = true; }
