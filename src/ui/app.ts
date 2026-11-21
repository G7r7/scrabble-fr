import { BLANK, BONUS, CENTER, RACK_SIZE, SIZE, letterValue } from '../game/constants';
import { evaluatePlacement } from '../game/rules';
import { shuffle } from '../game/bag';
import {
  AI, HARDCORE_PENALTY, HUMAN, VARIANTS, accept, challenge, exchange, loadGame, newGame, pass, playMove, propose, refuse,
  saveGame, winnerText, type GameState, type HistoryEntry, type Variant,
} from '../game/game';
import type { Action } from '../game/remote';
import { DICTS, dictInfo, dictOf, type DictId, type GameDict } from '../game/dicts';
import { THEMES, THEME_MULT, applyTheme, themeInfo, themeOf, type ThemeId } from '../game/themes';
import type { Placement } from '../game/types';
import { CODE_TAKEN, GameLink, fetchSummaries, isCode, isToken, newCode, newToken, normalizeCode } from '../net/online';
import { cleanName, type GameOptions, type GameSummary, type ServerMsg } from '../net/protocol';
import qrcode from 'qrcode-generator';
import type { Level } from '../ai/player';
import { Engine } from '../engine';
import { Fx, Sound } from './fx';
import { ChallengeScene } from './challenge';
import { Notifier, bindInstall, notifSupported } from './notify';
import { clearOds, loadOds, saveOds } from '../dict/store';
import { normalizeWord } from '../dict/normalize.js';

interface RackTile { id: number; letter: string }
interface PendingTile extends RackTile { r: number; c: number; assigned: string }
type Tab = 'game' | 'history' | 'dict' | 'options';

const BONUS_LABEL: Record<string, string> = { MT: 'Mot<br>×3', MD: 'Mot<br>×2', LT: 'Lettre<br>×3', LD: 'Lettre<br>×2' };
const LEVELS: Level[] = ['facile', 'moyen', 'difficile'];
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* rien */ } }
function lsDel(k: string) { try { localStorage.removeItem(k); } catch { /* rien */ } }
/** Jeton secret du joueur pour une partie en ligne (suffixé du code de la partie). */
const TOKEN_KEY = 'scrabble-fr-jeton-';
const VARIANT_KEY = 'scrabble-fr-variante';
const THEME_KEY = 'scrabble-fr-theme';
const OPP_KEY = 'scrabble-fr-adversaire';
const DICT_KEY = 'scrabble-fr-liste';
/** Parties en ligne en cours sur cet appareil (« Mes parties en cours »). */
const GAMES_KEY = 'scrabble-fr-parties';
interface MyGame { code: string; opp?: string; scores?: [number, number]; myTurn?: boolean; waiting?: boolean; at: number }
function loadMyGames(): MyGame[] {
  try {
    const l = JSON.parse(lsGet(GAMES_KEY) ?? '[]');
    return Array.isArray(l) ? l.filter((g) => g && isCode(g.code) && lsGet(`${TOKEN_KEY}${g.code}`)) : [];
  } catch { return []; }
}
const saveMyGames = (l: MyGame[]) => lsSet(GAMES_KEY, JSON.stringify(l.slice(0, 30)));
function rememberGame(code: string, patch: Partial<MyGame>) {
  const l = loadMyGames();
  const g = l.find((x) => x.code === code);
  if (g) Object.assign(g, patch, { at: Date.now() }); else l.unshift({ code, ...patch, at: Date.now() });
  saveMyGames(l);
}
const forgetGame = (code: string) => saveMyGames(loadMyGames().filter((g) => g.code !== code));
const variantOf = (v: unknown): Variant | null => (v === 'challenge' || v === 'hardcore' ? v : null);
/** Première lettre en minuscule (pour enchaîner « Nom : mot refusé… »). */
const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const variantLabel = (v: Variant | null | undefined) => VARIANTS.find((x) => x.id === (v ?? 'normal'))!.label;
function setUrlCode(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('partie', code); else url.searchParams.delete('partie');
  history.replaceState(null, '', url);
}
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export class App {
  private engine = new Engine();
  private game!: GameState;
  private tiles: RackTile[] = [];
  private pending: PendingTile[] = [];
  private selected: number | null = null;
  private nextId = 1;
  private busy = false;
  private exchangeMode = false;
  private exchangeSel = new Set<number>();
  /** Liste chargée dans le moteur (vérification des mots et ordinateur). */
  private dict: { id: GameDict; label: string; count: number } | null = null;
  /** Liste demandée (la partie en cours) et chargement en cours. */
  private dictWanted: GameDict | null = null;
  private dictLoading: Promise<void> = Promise.resolve();
  private dictError = '';
  /** Nom du fichier ODS importé sur cet appareil, s'il y en a un. */
  private odsName: string | null = null;
  private previewToken = 0;
  private tab: Tab = 'game';
  private historySeen = 0;
  private land = matchMedia('(min-aspect-ratio: 1/1) and (min-width: 760px)');

  // « solo » contre l'ordinateur, « online » : partie gardée et arbitrée par le serveur.
  private mode: 'solo' | 'online' = 'solo';
  private me: 0 | 1 = 0;
  private link: GameLink | null = null;
  /** Partie en ligne créée, personne ne l'a encore rejointe. */
  private waiting = false;
  /** Code de la partie en ligne affichée (pour savoir si un état reçu est celui d'une autre partie). */
  private gameCode: string | null = null;
  private oppConnected = false;

  // Effets : sons, animation du dernier coup, compteurs de points.
  private sound = new Sound();
  private fx = new Fx(this.sound);
  private scene = new ChallengeScene(this.sound, this.fx);
  private seen = 0;                       // entrées d'historique déjà célébrées
  private shown: [number, number] | null = null; // scores affichés (pendant le défilement)
  private fxDone: Promise<void> = Promise.resolve();
  private notifier = new Notifier();

  private el = {} as Record<
    'board' | 'rack' | 'preview' | 'scores' | 'bag' | 'history' | 'actions' | 'dict' | 'status' |
    'newGame' | 'quitBtn' | 'onlineInfo' | 'onlineBody' | 'sfxBtn' | 'musicBtn' | 'notifBtn',
    HTMLElement
  >;

  constructor(private root: HTMLElement) {}

  async start() {
    this.root.innerHTML = TEMPLATE;
    for (const k of ['board', 'rack', 'preview', 'scores', 'bag', 'history', 'actions', 'dict', 'status',
      'newGame', 'quitBtn', 'onlineInfo', 'onlineBody', 'sfxBtn', 'musicBtn', 'notifBtn'] as const) {
      this.el[k] = $(this.root, `#${k}`);
    }
    this.buildBoard();
    this.bindEvents();
    this.bindZoom();

    const loading = $(this.root, '#loading');
    const ods = await loadOds();
    this.odsName = ods?.name ?? null;
    // Avant le choix de liste, un ODS importé servait à toutes les parties : on garde ce choix.
    if (!lsGet(DICT_KEY) && ods) lsSet(DICT_KEY, 'ods');
    const saved = loadGame();
    this.game = saved && !saved.over ? saved : newGame(this.readLevel(), null, this.prefs());
    await this.useDict(this.gameDict());
    if (!this.dict) {
      loading.innerHTML = `<p>Impossible de charger le dictionnaire.</p><p class="muted">${esc(this.dictError)}</p>`;
      return;
    }
    loading.remove();
    this.seen = this.game.history.length;
    this.syncRack();
    this.render();
    this.soloNext();

    lsDel('scrabble-fr-hote'); // ancienne sauvegarde de l'hôte (avant le serveur de jeu)
    const params = new URLSearchParams(location.search);
    const code = normalizeCode(params.get('partie') ?? '');
    // Lien « Continuer sur un autre appareil » : il apporte le jeton secret de la place du joueur.
    const jeton = params.get('jeton');
    if (params.has('jeton')) {
      const url = new URL(location.href);
      url.searchParams.delete('jeton');
      history.replaceState(null, '', url);
    }
    if (isCode(code) && isToken(jeton)) {
      lsSet(`${TOKEN_KEY}${code}`, jeton);
      rememberGame(code, {});
    }
    if (!isCode(code)) void this.refreshMyGames();
    if (isCode(code)) {
      // Déjà venu sur cette partie (rechargement, ou retour plus tard) : on se reconnecte directement.
      if (lsGet(`${TOKEN_KEY}${code}`) && lsGet('scrabble-fr-nom')) this.joinGame(code);
      else this.lobby('menu', code);
    }
  }

  // ---------- Dictionnaire ----------

  /** Liste voulue pour la partie en cours (un ODS importé ne sert qu'en solo). */
  private gameDict(): GameDict {
    const d = this.game?.dict ?? 'libre';
    return d === 'ods' && (this.mode === 'online' || !this.odsName) ? 'libre' : d;
  }

  /** Charge la liste `id` dans le moteur, si ce n'est pas déjà elle (les chargements s'enchaînent). */
  private useDict(id: GameDict): Promise<void> {
    if (id === this.dictWanted) return this.dictLoading;
    this.dictWanted = id;
    this.dictLoading = this.dictLoading.then(async () => {
      if (this.dictWanted !== id || this.dict?.id === id) return;
      this.dictError = '';
      this.renderDict();
      if (id === 'ods') {
        const ods = await loadOds();
        if (ods) {
          const { count } = await this.engine.load(ods.text);
          this.dict = { id, label: ods.name, count };
          return;
        }
        id = 'libre';
      }
      const info = dictInfo(id);
      const res = await fetch(`${import.meta.env.BASE_URL}dict/${info.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { count } = await this.engine.load(await res.text());
      this.dict = { id, label: info.label, count };
    }).catch((err) => {
      this.dictError = String(err);
      this.dictWanted = null;
      this.setStatus(`Impossible de charger la liste de mots : ${err}`, true);
    }).then(() => {
      this.renderDict();
      if (this.game) void this.updatePreview();
    });
    return this.dictLoading;
  }

  /** Mots absents de la liste de la partie (attend la fin d'un chargement en cours). */
  private async invalid(words: string[]): Promise<string[]> {
    await this.dictLoading;
    return this.engine.invalidWords(words);
  }

  private dictPref(): GameDict {
    const v = lsGet(DICT_KEY);
    return v === 'ods' && this.odsName ? 'ods' : dictOf(v) ?? 'libre';
  }

  /** Change la liste de la partie contre l'ordinateur (tout de suite) et des suivantes. */
  private setDict(id: GameDict) {
    lsSet(DICT_KEY, id);
    if (this.mode !== 'solo') return this.setStatus('La liste choisie servira pour vos prochaines parties contre l’ordinateur.');
    if (id === 'libre') delete this.game.dict; else this.game.dict = id;
    saveGame(this.game);
    this.render();
    this.setStatus(id === 'ods' ? `Liste : votre fichier « ${this.odsName} ».`
      : `Liste « ${dictInfo(id).label} » : ${dictInfo(id).help}`);
  }

  private async importOds(file: File) {
    this.setStatus(`Import de « ${file.name} »…`);
    try {
      await this.dictLoading;
      const { count, normalized } = await this.engine.load(await file.text());
      // Le moteur contient maintenant ce fichier : on le recharge si l'import échoue ou s'il ne sert pas.
      this.dict = null;
      this.dictWanted = null;
      if (count < 1000) {
        this.setStatus(`Ce fichier ne contient que ${count} mots valides : import annulé.`, true);
        return this.render();
      }
      await saveOds({ name: file.name, count, text: normalized });
      this.odsName = file.name;
      this.setDict('ods');
      this.setStatus(`Dictionnaire importé : ${count.toLocaleString('fr-FR')} mots. Il reste sur cet appareil.`);
    } catch (err) {
      this.setStatus(`Échec de l'import : ${err}`, true);
      this.render();
    }
  }

  private async revertToFree() {
    await clearOds();
    this.odsName = null;
    this.setDict('libre');
  }

  // ---------- Partie ----------

  private readLevel(): Level {
    try {
      const l = localStorage.getItem('scrabble-fr-niveau') as Level | null;
      if (l && LEVELS.includes(l)) return l;
    } catch { /* rien */ }
    return 'moyen';
  }

  private variantPref(): Variant | null { return variantOf(lsGet(VARIANT_KEY)); }
  private themePref(): ThemeId | null { return themeOf(lsGet(THEME_KEY)); }
  /** Options de la prochaine partie contre l'ordinateur. */
  private prefs() { return { variant: this.variantPref(), theme: this.themePref(), dict: this.dictPref() }; }

  /** Nouvelle partie contre l'ordinateur (depuis la fenêtre « Nouvelle partie », ou « Rejouer » en fin de partie). */
  private startSolo(level: Level, opts: { variant: Variant | null; theme: ThemeId | null; dict: GameDict }) {
    const solo = this.mode === 'solo' ? this.game : loadGame();
    if (solo && !solo.over && solo.history.length > 0 && !confirm('Abandonner la partie en cours contre l’ordinateur ?')) return false;
    // Une partie en ligne en cours n'est pas quittée : elle reste dans « Mes parties en cours ».
    if (this.mode === 'online') { this.disconnect(); this.mode = 'solo'; this.me = 0; this.gameCode = null; setUrlCode(null); }
    this.busy = false;
    this.game = newGame(level, null, opts);
    this.resetBoardUi();
    const parts = [`niveau ${level}`, variantLabel(opts.variant) !== 'Normal' ? `mode ${variantLabel(opts.variant)}` : '',
      opts.dict === 'ods' ? 'votre fichier' : opts.dict !== 'libre' ? `liste ${dictInfo(opts.dict).label}` : '',
      opts.theme ? `thème ${themeInfo(opts.theme).label}` : ''].filter(Boolean);
    this.setStatus(`Nouvelle partie contre l’ordinateur : ${parts.join(', ')}.`);
    this.afterTurn();
    return true;
  }

  /** Aligne les tuiles affichées sur le chevalet réel, en conservant l'ordre choisi par le joueur. */
  private syncRack() {
    const rack = [...this.game.players[this.me].rack];
    // Mode challenge : les lettres du coup proposé sont sur le plateau, pas sur le chevalet.
    const prop = this.game.proposal;
    if (prop?.player === this.me) {
      for (const p of prop.move.placements) {
        const i = rack.indexOf(p.blank ? BLANK : p.letter);
        if (i >= 0) rack.splice(i, 1);
      }
    }
    // Coup préparé pendant le tour de l'adversaire : les lettres restent posées si leur case est encore libre.
    const taken = new Set((prop?.move.placements ?? []).map((p) => p.r * SIZE + p.c));
    let keptPending: PendingTile[] = [];
    const back: RackTile[] = [];
    let blocked = false;
    for (const p of this.pending) {
      const i = rack.indexOf(p.letter);
      if (i < 0) continue;
      rack.splice(i, 1);
      keptPending.push(p);
      if (this.game.board[p.r][p.c] || taken.has(p.r * SIZE + p.c)) blocked = true;
    }
    // Le coup de l'adversaire bloque le mot préparé (case prise, ou placement qui n'est plus jouable) :
    // toutes les lettres préparées reviennent sur le chevalet.
    if (!blocked && keptPending.length && this.preparedOk) {
      const ps = keptPending.map((p) => ({ r: p.r, c: p.c, letter: p.letter === BLANK ? p.assigned : p.letter, blank: p.letter === BLANK }));
      blocked = !evaluatePlacement(this.game.board, ps).ok;
    }
    if (blocked) {
      back.push(...keptPending.map((p) => ({ id: p.id, letter: p.letter })));
      keptPending = [];
    }
    const kept: RackTile[] = [];
    for (const t of this.tiles) {
      const i = rack.indexOf(t.letter);
      if (i >= 0) { rack.splice(i, 1); kept.push({ id: t.id, letter: t.letter }); }
    }
    this.tiles = [...kept, ...back, ...rack.map((letter) => ({ id: this.nextId++, letter }))];
    this.pending = keptPending;
    if (blocked) this.bumped = true;
  }

  /** Le dernier coup de l'adversaire a bloqué le coup préparé (lettres rendues au chevalet). */
  private bumped = false;
  /** Le coup préparé était jouable (géométrie) au dernier aperçu. */
  private preparedOk = false;

  /** Après un coup de l'adversaire : signale le coup préparé (prêt, ou lettres rendues). */
  private preparedNotice() {
    const blocked = this.bumped;
    this.bumped = false;
    const g = this.game;
    if (g.over) return;
    const who = this.mode === 'solo' ? 'L’ordinateur' : g.players[this.opp].name;
    const before = this.el.status.textContent?.trim() ?? '';
    const add = (msg: string, error = false) => this.setStatus(before ? `${before} ${msg}` : msg, error);
    if (blocked) add(`${who} a bloqué votre coup préparé : vos lettres reviennent sur le chevalet.`, true);
    else if (g.proposal) return;
    else if (this.pending.length && g.current === this.me && evaluatePlacement(g.board, this.placements()).ok) {
      add('Votre coup préparé est prêt : touchez « Jouer ».');
    }
  }

  /** On peut poser et déplacer ses lettres, même pendant le tour de l'adversaire (coup préparé). */
  private canPlace() {
    return !!this.game && !this.game.over && !this.exchangeMode && !(this.mode === 'online' && this.busy);
  }

  private placements(): Placement[] {
    return this.pending.map((p) => ({
      r: p.r, c: p.c,
      letter: p.letter === BLANK ? p.assigned : p.letter,
      blank: p.letter === BLANK,
    }));
  }

  private canAct() {
    return !this.busy && !this.game.over && this.game.current === this.me && !this.game.proposal &&
      (this.mode !== 'online' || !!this.link?.connected);
  }

  /** Mode challenge : l'adversaire a posé un coup, à nous d'accepter ou de contester. */
  private canRespond() {
    const p = this.game.proposal;
    return !!p && p.player !== this.me && !this.busy && !this.game.over &&
      (this.mode !== 'online' || !!this.link?.connected);
  }

  /** Points du dernier coup joué (bonus du thème compris). */
  private lastPlayScore() {
    for (let i = this.game.history.length - 1; i >= 0; i--) if (this.game.history[i].kind === 'play') return this.game.history[i].score;
    return 0;
  }

  private get opp(): 0 | 1 { return this.me === 0 ? 1 : 0; }

  private async play() {
    if (!this.canAct() || !this.pending.length) return;
    const ps = this.placements();
    const res = evaluatePlacement(this.game.board, ps);
    if (!res.ok) { this.sound.invalid(); return this.setStatus(res.error, true); }
    // En ligne, le serveur vérifie le coup avec son dictionnaire.
    if (this.mode === 'online') return this.sendAction({ type: 'play', placements: ps });
    const g = this.game;
    const move = { placements: ps, words: res.words, score: res.score };
    // On retire les tuiles posées pour que syncRack n'en garde que les restantes.
    const placedIds = new Set(this.pending.map((p) => p.id));
    const commit = () => { this.pending = []; this.tiles = this.tiles.filter((t) => !placedIds.has(t.id)); };
    if (g.variant === 'challenge') {
      commit();
      propose(g, move);
      this.setStatus('L’ordinateur examine votre coup…');
      return this.afterTurn();
    }
    this.busy = true;
    const invalid = await this.invalid(res.words.map((w) => w.word));
    this.busy = false;
    if (g !== this.game) return;
    if (invalid.length && g.variant === 'hardcore') {
      this.recallAll();
      refuse(g, invalid, HARDCORE_PENALTY);
      this.setStatus(this.describe(g.history[g.history.length - 1]), true);
      return this.afterTurn();
    }
    if (invalid.length) {
      this.sound.invalid();
      return this.setStatus(`Mot${invalid.length > 1 ? 's' : ''} absent${invalid.length > 1 ? 's' : ''} du dictionnaire : ${invalid.join(', ')}`, true);
    }
    commit();
    playMove(g, move);
    this.setStatus(`Vous marquez ${this.lastPlayScore()} points.`);
    this.afterTurn();
  }

  private doPass() {
    if (!this.canAct()) return;
    if (!confirm('Passer votre tour ?')) return;
    this.recallAll();
    if (this.mode === 'online') return this.sendAction({ type: 'pass' });
    pass(this.game);
    this.afterTurn();
  }

  private toggleExchange() {
    if (!this.canAct()) return;
    if (this.game.bag.length < RACK_SIZE) return this.setStatus('Échange impossible : il reste moins de 7 jetons dans le sac.', true);
    this.recallAll();
    this.exchangeMode = !this.exchangeMode;
    this.exchangeSel.clear();
    this.setStatus(this.exchangeMode ? 'Touchez les lettres à échanger, puis confirmez.' : '');
    this.render();
  }

  private confirmExchange() {
    if (!this.exchangeSel.size) return this.setStatus('Sélectionnez au moins une lettre.', true);
    const letters = this.tiles.filter((t) => this.exchangeSel.has(t.id)).map((t) => t.letter);
    if (this.mode === 'online') {
      this.exchangeMode = false;
      this.exchangeSel.clear();
      return this.sendAction({ type: 'exchange', letters });
    }
    this.tiles = this.tiles.filter((t) => !this.exchangeSel.has(t.id));
    exchange(this.game, letters);
    this.exchangeMode = false;
    this.exchangeSel.clear();
    this.setStatus(`Vous échangez ${letters.length} lettre${letters.length > 1 ? 's' : ''}.`);
    this.afterTurn();
  }

  private afterTurn() {
    if (this.mode === 'solo') saveGame(this.game);
    this.syncRack();
    this.preparedNotice();
    this.render();
    this.celebrate();
    if (this.game.over) return void this.fxDone.then(() => this.showEnd());
    this.soloNext();
  }

  /** Contre l'ordinateur : le fait jouer, ou juger le coup proposé, si c'est à lui. */
  private soloNext() {
    const g = this.game;
    if (this.mode !== 'solo' || g.over || this.busy) return;
    if (g.proposal) { if (g.proposal.player === HUMAN) void this.aiRespond(); return; }
    if (g.players[g.current].isAi) void this.aiTurn();
  }

  /** Mode challenge : l'ordinateur accepte ou conteste votre coup (il se trompe parfois, selon le niveau). */
  private async aiRespond() {
    const g = this.game;
    const p = g.proposal;
    if (!p) return;
    this.busy = true;
    this.render();
    const [invalid] = await Promise.all([this.invalid(p.move.words.map((w) => w.word)), delay(900)]);
    this.busy = false;
    if (g !== this.game || g.proposal !== p) return;
    const odds = invalid.length
      ? { facile: 0.5, moyen: 0.8, difficile: 1 }[g.level]
      : { facile: 0.1, moyen: 0.04, difficile: 0 }[g.level];
    if (Math.random() < odds) {
      challenge(g, invalid);
      this.setStatus(invalid.length ? 'L’ordinateur conteste… et il a raison ! Vous perdez votre tour.'
        : `L’ordinateur conteste… à tort ! Vous marquez ${this.lastPlayScore()} points et il perd son tour.`, !!invalid.length);
    } else {
      accept(g);
      this.setStatus(`L’ordinateur accepte : vous marquez ${this.lastPlayScore()} points.`);
    }
    this.afterTurn();
  }

  /** Mode challenge : votre décision sur le coup de l'adversaire. */
  private async respond(kind: 'accept' | 'challenge') {
    if (!this.canRespond()) return;
    if (this.mode === 'online') return this.sendAction({ type: kind });
    const g = this.game;
    const p = g.proposal!;
    if (kind === 'accept') {
      accept(g);
      this.setStatus(`Coup accepté : l’ordinateur marque ${this.lastPlayScore()} points.`);
      return this.afterTurn();
    }
    this.busy = true;
    const invalid = await this.invalid(p.move.words.map((w) => w.word));
    this.busy = false;
    if (g !== this.game || g.proposal !== p) return;
    challenge(g, invalid);
    this.setStatus(invalid.length ? 'Challenge réussi ! L’ordinateur perd son tour.'
      : `Challenge raté : le coup est valide, vous perdez votre tour.`, !invalid.length);
    this.afterTurn();
  }

  /** Anime et sonorise ce qui vient de se passer (coup joué, échange, tour suivant), puis fait défiler les scores. */
  private celebrate() {
    const g = this.game;
    const fresh = g.history.slice(this.seen);
    this.seen = g.history.length;
    const play = fresh.find((e) => e.kind === 'play');
    // Mode challenge / hardcore : grand tampon animé avant le reste.
    const judged = fresh.find((e) => e.challenged || (e.kind === 'invalid' && e.score < 0));
    let stamp: Promise<void> | null = null, wait = 0;
    if (judged?.kind === 'invalid' && judged.score < 0) {
      stamp = this.fx.stamp('REFUSÉ', `${judged.score} points`, 'bad');
      wait = this.fx.stampMs;
    } else if (judged) {
      // Écran de challenge : suspense, puis réaction (variante choisie par le nombre de coups).
      const refused = judged.kind === 'invalid';
      const name = (p: number) => (this.mode === 'solo' ? (p === HUMAN ? 'Vous' : 'L’ordinateur') : g.players[p].name);
      const challenger = refused ? 1 - judged.player : (fresh.find((e) => e.kind === 'challenge')?.player ?? 1 - judged.player);
      const words = refused ? judged.text.replace(/^[^:]*:\s*/, '').replace(/\s*—.*$/, '').split(/,\s*/)
        : (g.lastWords ?? []).map((w) => w.word);
      const detail = refused
        ? (judged.player === this.me ? 'Challenge réussi contre vous : votre coup est annulé.' : `Challenge réussi : le coup de ${name(judged.player)} est annulé.`)
        : (challenger === this.me ? 'Challenge raté : vous perdez votre tour.' : `Challenge raté : ${name(challenger)} perd son tour.`);
      stamp = this.scene.play(refused ? 'invalid' : 'valid', words, detail, g.history.length);
      wait = this.scene.duration;
    }
    const before = stamp ?? Promise.resolve();
    if (play && g.lastWords?.length) {
      const words = g.lastWords, cells = g.lastMove;
      wait += this.fx.duration(cells.length, words.length);
      this.fxDone = before.then(() => this.fx.countMove(this.el.board, cells, words, play.score));
    } else if (stamp) {
      this.fxDone = stamp;
    } else if (fresh.some((e) => e.kind === 'exchange')) {
      this.sound.shuffle();
      this.fxDone = Promise.resolve();
    } else if (fresh.some((e) => e.kind === 'pass')) {
      this.sound.soft();
      this.fxDone = Promise.resolve();
    }
    // En ligne, petit signal quand c'est de nouveau à vous.
    if (this.mode !== 'solo' && fresh.length && !g.over && g.current === this.me) {
      void this.fxDone.then(() => this.sound.turn());
    }
    this.notifyTurn(fresh);
    this.tweenScores(wait);
  }

  /** Notification quand l'adversaire a joué (ou que la partie est finie) pendant que la page est cachée. */
  private notifyTurn(fresh: HistoryEntry[]) {
    const g = this.game;
    if (!fresh.length) return;
    if (g.over) return void this.notifier.show(winnerText(g, this.me), 'La partie est terminée.', 'tour');
    const theirs = fresh.filter((e) => e.player === this.opp && e.kind !== 'end').pop();
    if (!theirs || g.current !== this.me) return;
    const who = this.mode === 'solo' ? 'L’ordinateur' : g.players[this.opp].name;
    const what = theirs.kind === 'play' ? `${who} joue ${theirs.text} pour ${theirs.score} points.`
      : theirs.kind === 'exchange' ? `${who} échange des lettres.`
      : theirs.kind === 'invalid' ? `${who} : ${lcFirst(theirs.text)}.`
      : theirs.kind === 'challenge' ? `${who} a contesté à tort et perd son tour.` : `${who} passe son tour.`;
    void this.notifier.show('À vous de jouer !', what, 'tour');
  }

  private tweenScores(delayMs: number) {
    const target: [number, number] = [this.game.players[0].score, this.game.players[1].score];
    const shown = this.shown ?? [...target];
    this.shown = shown;
    const g = this.game;
    const pts = (i: number) => this.el.scores.querySelector<HTMLElement>(`.pts[data-p="${i}"]`);
    for (const i of [0, 1] as const) {
      this.fx.tween(shown[i], target[i], delayMs,
        (v) => { if (g !== this.game) return; shown[i] = v; const el = pts(i); if (el) el.textContent = String(v); },
        () => { const el = pts(i); if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); });
    }
  }

  private async aiTurn() {
    this.busy = true;
    this.render();
    try {
      const g = this.game;
      const [d] = await Promise.all([
        this.dictLoading.then(() => this.engine.aiMove(g.board, g.players[AI].rack, g.bag.length, g.level)),
        this.fxDone.then(() => delay(500)),
      ]);
      if (g !== this.game) return; // nouvelle partie lancée entre-temps
      if (d.kind === 'play' && g.variant === 'challenge') {
        propose(g, d.move);
        this.setStatus(`L’ordinateur propose ${d.move.words.map((w) => w.word).join(', ')} pour ${d.move.score} points : acceptez ou contestez !`);
      } else if (d.kind === 'play') {
        playMove(g, d.move);
        this.setStatus(`L'ordinateur joue ${d.move.words[0].word} pour ${this.lastPlayScore()} points.`);
      } else if (d.kind === 'exchange' && g.bag.length >= RACK_SIZE) {
        exchange(g, d.letters);
        this.setStatus(`L'ordinateur échange ${d.letters.length} lettre${d.letters.length > 1 ? 's' : ''}.`);
      } else {
        pass(g);
        this.setStatus("L'ordinateur passe son tour.");
      }
    } catch (err) {
      this.setStatus(`Erreur de l'ordinateur : ${err}`, true);
      pass(this.game);
    } finally {
      this.busy = false;
    }
    this.afterTurn();
  }

  private showEnd() {
    const d = $(this.root, '#endDialog');
    $(d, '#endTitle').textContent = winnerText(this.game, this.me);
    const h = this.game.players[this.me], a = this.game.players[this.opp];
    const other = this.mode === 'solo' ? 'ordinateur' : a.name;
    $(d, '#endDetail').textContent =
      `Lettres restantes — vous : ${h.rack.join(' ') || 'aucune'} · ${other} : ${a.rack.join(' ') || 'aucune'}`;
    $(d, '#endNew').textContent = this.mode === 'solo' ? 'Rejouer' : 'Revanche';
    d.classList.add('open');
    this.sound.end(h.score > a.score);
  }

  // ---------- Jeu en ligne ----------

  /** Message d'état décrivant un coup qui vient d'être joué. */
  private describe(e: HistoryEntry): string {
    const mine = e.player === this.me;
    const name = this.game.players[e.player].name;
    if (e.kind === 'play') return mine ? `Vous marquez ${e.score} points.` : `${name} joue ${e.text} pour ${e.score} points.`;
    if (e.kind === 'exchange') return mine ? 'Vous échangez des lettres.' : `${name} échange des lettres.`;
    if (e.kind === 'pass') return mine ? 'Vous passez votre tour.' : `${name} passe son tour.`;
    if (e.kind === 'invalid') return e.challenged
      ? (mine ? `Challenge réussi contre vous. ${e.text}.` : `Challenge réussi ! ${name} : ${lcFirst(e.text)}.`)
      : (mine ? `${e.text}.` : `${name} : ${lcFirst(e.text)}.`);
    if (e.kind === 'challenge') return mine ? 'Challenge raté : le mot était bon, vous perdez votre tour.'
      : `${name} a contesté à tort et perd son tour.`;
    return '';
  }

  private sendAction(action: Action) {
    if (!this.link?.connected) return this.setStatus('Pas de connexion au serveur pour l’instant.', true);
    this.busy = true;
    this.link.send({ type: 'action', action });
    this.setStatus('Envoi du coup…');
    this.render();
  }

  private myName() { return cleanName(lsGet('scrabble-fr-nom')) || 'Joueur'; }

  /** Remet l'interface à zéro pour une nouvelle partie (en ligne ou non). */
  private resetBoardUi() {
    this.tiles = [];
    this.pending = [];
    this.selected = null;
    this.exchangeMode = false;
    this.exchangeSel.clear();
    this.busy = false;
    this.seen = this.game.history.length;
    this.shown = null;
    $(this.root, '#endDialog').classList.remove('open');
  }

  private createGame(options: GameOptions) {
    this.disconnect();
    const code = newCode(), token = newToken();
    lsSet(`${TOKEN_KEY}${code}`, token);
    rememberGame(code, { waiting: true });
    this.lobby('hosting', code, false);
    this.connect(code, token, options);
    this.waiting = true; // « Annuler » supprimera la partie tant que personne ne l'a rejointe
  }

  private joinGame(code: string) {
    // Passer d'une partie en ligne à une autre : on se déconnecte de la première sans la quitter.
    if (this.mode === 'online') this.toSolo();
    this.disconnect();
    let token = lsGet(`${TOKEN_KEY}${code}`);
    if (!token) { token = newToken(); lsSet(`${TOKEN_KEY}${code}`, token); }
    this.lobby('joining', code);
    this.connect(code, token, null);
  }

  /** Se connecte à une partie du serveur ; `create` : on la crée, avec ces options. */
  private connect(code: string, token: string, create: GameOptions | null) {
    setUrlCode(code);
    const link: GameLink = new GameLink(code, token, !!create, {
      onOpen: () => link.send({ type: 'hello', name: this.myName(), ...(create ? { options: create } : {}) }),
      onPeer: (online) => {
        const was = this.oppConnected;
        this.oppConnected = online;
        if (this.mode !== 'online' || this.game.over || was === online) return this.render();
        const name = this.game.players[this.opp].name;
        if (online) this.setStatus(`${name} est de retour.`);
        else this.setStatus(this.game.current === this.me
          ? `${name} est hors ligne : jouez quand même, il verra votre coup à son retour.`
          : `${name} est hors ligne.`);
        this.render();
      },
      onMessage: (m) => this.onServerMsg(m),
      onError: (text, fatal, closeCode) => {
        if (text === CODE_TAKEN && create && this.mode === 'solo') return this.createGame(create);
        // Partie disparue (expirée, quittée) ou place prise : on l'oublie.
        if (closeCode === 4004 || closeCode === 4003) { forgetGame(code); lsDel(`${TOKEN_KEY}${code}`); }
        if (fatal && this.mode === 'solo') { this.disconnect(); this.lobby('error', text); }
        else { this.busy = false; this.setStatus(text, true); this.render(); }
      },
    });
    this.link = link;
  }

  private onServerMsg(m: ServerMsg) {
    if (!m || typeof m !== 'object' || !this.link) return;
    if (m.type === 'waiting') {
      this.waiting = true;
      if (this.mode === 'solo') this.lobby('hosting', this.link.code, true);
    } else if (m.type === 'state') {
      const sameGame = this.mode === 'online' && this.gameCode === this.link.code;
      const prev = sameGame ? this.game : null;
      const fresh = !prev || m.state.history.length < prev.history.length || (prev.over && !m.state.over);
      const opp = m.state.players[m.you === 0 ? 1 : 0].name;
      this.gameCode = this.link.code;
      const st = m.state, mine = st.players[m.you], theirs = st.players[m.you === 0 ? 1 : 0];
      if (st.over) forgetGame(this.link.code);
      else rememberGame(this.link.code, {
        opp, scores: [mine.score, theirs.score], waiting: false,
        myTurn: st.proposal ? st.proposal.player !== m.you : st.current === m.you,
      });
      if (this.waiting && m.state.history.length === 0) {
        void this.notifier.show(`${opp} a rejoint la partie`,
          m.state.current === m.you ? 'La partie commence : à vous de jouer !' : `La partie commence : ${opp} joue en premier.`, 'tour');
      }
      this.waiting = false;
      this.mode = 'online';
      this.me = m.you;
      this.game = m.state;
      if (fresh) { this.resetBoardUi(); this.closeLobby(); }
      this.busy = false;
      const last = this.game.history[this.game.history.length - 1];
      if (fresh) this.setStatus(this.game.history.length
        ? `Partie contre ${opp} reprise.`
        : `Partie contre ${opp}${this.game.variant ? ` (mode ${variantLabel(this.game.variant)})` : ''}. Bonne chance !`);
      else if (last && prev && this.game.history.length > prev.history.length) this.setStatus(this.describe(last), last.kind === 'invalid' && last.player === this.me);
      // Mode challenge : l'adversaire vient de poser un coup, à nous de trancher.
      const prop = this.game.proposal;
      if (prop && prop.player !== this.me && !prev?.proposal) {
        const what = `${opp} propose ${prop.move.words.map((w) => w.word).join(', ')} pour ${prop.move.score} points`;
        this.setStatus(`${what} : acceptez ou contestez !`);
        this.sound.turn();
        void this.notifier.show('Accepter ou contester ?', `${what}.`, 'tour');
      } else if (prop && prop.player === this.me && !prev?.proposal) {
        this.setStatus(`Coup posé : ${opp} va l’accepter ou le contester…`);
      }
      this.syncRack();
      if (!fresh) this.preparedNotice();
      this.render();
      this.celebrate();
      if (this.game.over && !prev?.over) void this.fxDone.then(() => this.showEnd());
    } else if (m.type === 'error') {
      if (this.mode !== 'online') { this.disconnect(); return this.lobby('error', m.message); }
      this.busy = false;
      this.sound.invalid();
      this.setStatus(m.message, true);
      this.render();
    } else if (m.type === 'left') {
      if (this.mode !== 'online') return;
      this.oppConnected = false;
      const name = this.game.players[this.opp].name;
      this.setStatus(`${name} a quitté la partie.`, true);
      void this.notifier.show(`${name} a quitté la partie`, '', 'depart');
      this.render();
    }
  }

  private rematch() {
    this.link?.send({ type: 'rematch' });
    $(this.root, '#endDialog').classList.remove('open');
    this.setStatus('Revanche demandée…');
  }

  /** Se déconnecte de la partie en ligne sans la quitter : on pourra la reprendre (lien, code, « Mes parties »). */
  private disconnect() {
    this.link?.close();
    this.link = null;
    this.oppConnected = false;
    this.waiting = false;
  }

  /** Quitte la partie en ligne pour de bon : le serveur prévient l'adversaire, l'appareil oublie la partie. */
  private leaveGame() {
    if (this.link) { lsDel(`${TOKEN_KEY}${this.link.code}`); forgetGame(this.link.code); }
    this.link?.close({ type: 'bye' });
    this.link = null;
    this.oppConnected = false;
    this.waiting = false;
  }

  /** Revient à la partie contre l'ordinateur. */
  private toSolo(msg = 'Retour à la partie contre l’ordinateur.') {
    this.disconnect();
    this.mode = 'solo';
    this.me = 0;
    this.gameCode = null;
    setUrlCode(null);
    const saved = loadGame();
    this.game = saved && !saved.over ? saved : newGame(this.readLevel(), null, this.prefs());
    this.resetBoardUi();
    this.setStatus(msg);
    this.afterTurn();
    void this.refreshMyGames();
  }

  private quitOnline() {
    if (!this.game.over && !confirm('Quitter définitivement la partie en ligne ? Votre adversaire sera prévenu.\n\n(Pour une simple pause, fermez l’appli : la partie vous attendra.)')) return;
    this.leaveGame();
    this.toSolo();
  }

  // ---------- Mes parties en cours ----------

  /** Met à jour la liste auprès du serveur (à qui le tour, scores) et oublie les parties disparues ou finies. */
  private async refreshMyGames(): Promise<MyGame[]> {
    const mine = loadMyGames();
    const sums = await fetchSummaries(mine.map((g) => ({ code: g.code, token: lsGet(`${TOKEN_KEY}${g.code}`)! })));
    if (sums) {
      const by = new Map(sums.map((x: GameSummary) => [x.code, x]));
      for (const g of mine) {
        const x = by.get(g.code);
        if (!x) continue;
        if (!x.found || x.over) { forgetGame(g.code); if (!x.found) lsDel(`${TOKEN_KEY}${g.code}`); continue; }
        rememberGame(g.code, x.waiting ? { waiting: true } : { opp: x.opp, scores: x.scores, myTurn: x.myTurn, waiting: false });
      }
    }
    this.renderGamesBar();
    this.renderGamesList();
    return loadMyGames();
  }

  /** Parties en ligne autres que celle affichée, celles où c'est à moi d'abord. */
  private otherGames() {
    return loadMyGames().filter((g) => g.code !== this.gameCode)
      .sort((a, b) => Number(!!b.myTurn) - Number(!!a.myTurn) || b.at - a.at);
  }

  private gameLine(g: MyGame, short = false) {
    if (g.waiting) return `<b>${esc(g.code)}</b> · ${short ? 'en attente' : 'en attente d’un adversaire'}`;
    const sc = g.scores ? ` · ${g.scores[0]} – ${g.scores[1]}` : '';
    const turn = g.myTurn ? `<span class="your-turn">${short ? 'à vous !' : 'à vous de jouer'}</span>`
      : short ? 'son tour' : `au tour de ${esc(g.opp ?? 'l’adversaire')}`;
    return `${short ? '' : 'contre '}<b>${esc(g.opp ?? '?')}</b>${sc} · ${turn}`;
  }

  /** Bandeau sous les scores (contre l'ordinateur) : rappelle les parties en ligne en cours. */
  private renderGamesBar() {
    const bar = this.root.querySelector<HTMLElement>('#gamesBar');
    if (!bar) return;
    const list = this.mode === 'solo' ? this.otherGames() : [];
    bar.hidden = !list.length;
    if (!list.length) return;
    const turns = list.filter((g) => g.myTurn).length;
    bar.innerHTML = list.length === 1
      ? `<span>En ligne : ${this.gameLine(list[0], true)}</span><button class="btn small primary" data-resume="${list[0].code}">Reprendre</button>`
      : `<span>${list.length} parties en ligne${turns ? ` · <span class="your-turn">${turns} à vous de jouer</span>` : ''}</span><button class="btn small primary" data-games>Voir</button>`;
  }

  /** Liste « Mes parties en cours » dans la fenêtre Jouer en ligne. */
  private renderGamesList() {
    const box = this.el.onlineBody.querySelector<HTMLElement>('#olGames');
    if (!box) return;
    const list = this.otherGames();
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<h3>Mes parties en cours</h3>` + list.map((g) =>
      `<button type="button" class="game-row ${g.myTurn ? 'turn' : ''}" data-ol="resume" data-code="${g.code}"><span>${this.gameLine(g)}</span><span aria-hidden="true">›</span></button>`).join('') : '';
  }

  // ---------- Continuer sur un autre appareil ----------

  private transferUrl() {
    const code = this.link?.code ?? '';
    const token = lsGet(`${TOKEN_KEY}${code}`) ?? '';
    return `${location.origin}${location.pathname}?partie=${code}&jeton=${token}`;
  }
  private lobby(view: 'menu' | 'hosting' | 'joining' | 'error' | 'transfer', arg = '', ready = false) {
    const name = esc(cleanName(lsGet('scrabble-fr-nom')));
    const body = this.el.onlineBody;
    if (view === 'menu' && arg) {
      // Arrivée par un lien de partie : on rejoint, rien d'autre à régler.
      body.innerHTML = `
        <h2>Rejoindre la partie</h2>
        <p class="muted">On vous a invité à une partie en ligne.</p>
        <label class="field">Votre nom<input id="olName" maxlength="16" autocomplete="nickname" value="${name}" placeholder="Votre nom" /></label>
        <form class="check" data-ol="join-form">
          <input id="olCode" maxlength="7" placeholder="Code de la partie" autocomplete="off" autocapitalize="characters" value="${esc(arg)}" />
          <button class="btn primary">Rejoindre</button>
        </form>
        <div class="row"><button type="button" class="btn" data-ol="close">Fermer</button></div>`;
    } else if (view === 'menu') {
      const opp = lsGet(OPP_KEY) === 'online' ? 'online' : 'solo';
      const variant = this.variantPref() ?? 'normal', level = this.readLevel();
      const dict = this.dictPref();
      const seg = (nameAttr: string, items: { id: string; label: string; cls?: string }[], cur: string, label: string) =>
        `<div class="seg" role="radiogroup" aria-label="${label}" style="--n:${items.length}">${items.map((x) => `<label class="seg-opt ${x.cls ?? ''}">
          <input type="radio" name="${nameAttr}" value="${x.id}" ${cur === x.id ? 'checked' : ''} /><span>${x.label}</span></label>`).join('')}</div>`;
      body.innerHTML = `
        <h2>Nouvelle partie</h2>
        <section id="olGames" class="my-games" hidden></section>
        <section class="setup" data-opp="${opp}" aria-label="Nouvelle partie">
          <div class="setup-row"><span class="setup-label">Contre</span>${seg('olOpp',
            [{ id: 'solo', label: 'L’ordinateur' }, { id: 'online', label: 'En ligne' }], opp, 'Adversaire')}</div>
          <div class="setup-row only-solo"><span class="setup-label">Niveau</span>${seg('olLevel',
            LEVELS.map((l) => ({ id: l, label: l[0].toUpperCase() + l.slice(1) })), level, 'Niveau de l’ordinateur')}</div>
          <label class="setup-row only-online"><span class="setup-label">Votre nom</span><input id="olName" maxlength="16" autocomplete="nickname" value="${name}" placeholder="Votre nom" /></label>
          <div class="setup-row"><span class="setup-label">Mode</span>${seg('olVariant',
            VARIANTS.map((v) => ({ id: v.id, label: v.label, cls: `v-${v.id}` })), variant, 'Mode de jeu')}</div>
          <p class="setup-help" id="olVariantHelp">${VARIANTS.find((v) => v.id === variant)!.help}</p>
          <label class="setup-row"><span class="setup-label">Liste</span><select id="olDict">${DICTS.map((d) =>
            `<option value="${d.id}" ${dict === d.id ? 'selected' : ''}>${d.label} (${d.words} mots)</option>`).join('')}${this.odsName
            ? `<option value="ods" ${dict === 'ods' ? 'selected' : ''} ${opp === 'online' ? 'disabled' : ''}>Mon fichier : ${esc(this.odsName)}</option>` : ''}</select></label>
          <label class="setup-row"><span class="setup-label">Thème</span><select id="olTheme">${this.themeOptions(this.themePref())}</select></label>
          <button class="btn primary wide" data-ol="start">Démarrer la partie</button>
          <p class="setup-note only-online">Vous recevrez un lien à envoyer à votre adversaire. La partie est gardée sur le serveur :
            chacun peut fermer l’appli et revenir plus tard.</p>
        </section>
        <div class="sep"><span>ou rejoindre une partie en ligne</span></div>
        <form class="check" data-ol="join-form">
          <input id="olCode" maxlength="7" placeholder="Code de la partie" autocomplete="off" autocapitalize="characters" />
          <button class="btn">Rejoindre</button>
        </form>
        <div class="row"><button type="button" class="btn" data-ol="close">Fermer</button></div>`;
    } else if (view === 'hosting') {
      const link = `${location.origin}${location.pathname}?partie=${arg}`;
      body.innerHTML = `
        <h2>Partie créée</h2>
        <p class="muted">Envoyez ce lien à votre adversaire :</p>
        <div class="check"><input id="olLink" readonly value="${esc(link)}" /><button class="btn" data-ol="copy">Copier</button></div>
        <p class="code" aria-label="Code de la partie">${arg}</p>
        <p class="wait"><span class="spinner small"></span>${ready ? 'En attente de votre adversaire…' : 'Ouverture de la partie…'}</p>
        <div class="row">
          ${'share' in navigator ? '<button class="btn" data-ol="share">Partager…</button>' : ''}
          <button class="btn" data-ol="cancel">Annuler</button>
        </div>`;
    } else if (view === 'transfer') {
      const url = this.transferUrl();
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      body.innerHTML = `
        <h2>Continuer sur un autre appareil</h2>
        <p class="muted">Scannez ce code avec l’autre appareil, ou ouvrez-y ce lien : vous y retrouverez votre place dans la partie.</p>
        <div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
        <div class="check"><input id="olLink" readonly value="${esc(url)}" /><button class="btn" data-ol="copy">Copier</button></div>
        <p class="note bad">Ce lien donne accès à votre place : ne l’envoyez qu’à vous-même. L’appareil actuel sera déconnecté dès que l’autre ouvrira la partie.</p>
        <div class="row">
          ${'share' in navigator ? '<button class="btn" data-ol="share-self">Envoyer…</button>' : ''}
          <button class="btn primary" data-ol="close">Fermer</button>
        </div>`;
    } else if (view === 'joining') {
      body.innerHTML = `
        <h2>Connexion…</h2>
        <p class="wait"><span class="spinner small"></span>Connexion à la partie <strong>${esc(arg)}</strong></p>
        <div class="row"><button class="btn" data-ol="cancel">Annuler</button></div>`;
    } else {
      body.innerHTML = `
        <h2>Jeu en ligne</h2>
        <p class="bad">${esc(arg)}</p>
        <div class="row"><button class="btn primary" data-ol="menu">Retour</button><button class="btn" data-ol="cancel">Fermer</button></div>`;
    }
    $(this.root, '#onlineDialog').classList.add('open');
    if (view === 'menu') { this.renderGamesList(); void this.refreshMyGames(); }
    if (view === 'menu' && arg) body.querySelector<HTMLInputElement>(name ? '#olCode' : '#olName')?.focus();
  }

  private themeOptions(current: ThemeId | null) {
    return `<option value="">Aucun</option>` + THEMES.map((t) =>
      `<option value="${t.id}" ${current === t.id ? 'selected' : ''}>${t.icons[0]} ${t.label} (mots ×${THEME_MULT})</option>`).join('');
  }

  private closeLobby() { $(this.root, '#onlineDialog').classList.remove('open'); }

  private bindLobby() {
    const body = this.el.onlineBody;
    const saveName = () => {
      const input = body.querySelector<HTMLInputElement>('#olName');
      const n = cleanName(input?.value);
      if (!n) { input?.focus(); input?.classList.add('invalid'); return false; }
      lsSet('scrabble-fr-nom', n);
      return true;
    };
    const cancel = () => {
      if (this.mode !== 'solo') return this.closeLobby();
      // Annuler une partie qu'on vient de créer (personne ne l'a rejointe) la supprime ; sinon on se déconnecte seulement.
      if (this.waiting) this.leaveGame(); else this.disconnect();
      this.closeLobby();
      setUrlCode(null);
    };
    body.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-ol]')?.dataset.ol;
      if (a === 'start') {
        const pick = (n: string) => body.querySelector<HTMLInputElement>(`input[name="${n}"]:checked`)?.value;
        const online = pick('olOpp') === 'online';
        const variant = variantOf(pick('olVariant'));
        const theme = themeOf(body.querySelector<HTMLSelectElement>('#olTheme')?.value);
        const dictVal = body.querySelector<HTMLSelectElement>('#olDict')?.value;
        const level = (LEVELS as string[]).includes(pick('olLevel') ?? '') ? pick('olLevel') as Level : 'moyen';
        // On retient ces réglages pour la prochaine fois.
        lsSet(OPP_KEY, online ? 'online' : 'solo');
        lsSet(VARIANT_KEY, variant ?? 'normal');
        lsSet(THEME_KEY, theme ?? '');
        if (!online) {
          const dict: GameDict = dictVal === 'ods' && this.odsName ? 'ods' : dictOf(dictVal) ?? 'libre';
          lsSet(DICT_KEY, dict);
          lsSet('scrabble-fr-niveau', level);
          if (this.startSolo(level, { variant, theme, dict })) this.closeLobby();
          return;
        }
        if (!saveName()) return;
        const dict: DictId = dictOf(dictVal) ?? 'libre';
        lsSet(DICT_KEY, dict);
        this.createGame({ variant, theme, dict });
      }
      else if (a === 'close' || a === 'cancel') cancel();
      else if (a === 'menu') this.lobby('menu');
      else if (a === 'copy') {
        const input = $<HTMLInputElement>(body, '#olLink');
        input.select();
        navigator.clipboard?.writeText(input.value).then(
          () => { (e.target as HTMLElement).textContent = 'Copié !'; },
          () => document.execCommand('copy'),
        );
      } else if (a === 'resume') {
        const code = (e.target as HTMLElement).closest<HTMLElement>('[data-code]')?.dataset.code;
        if (code && isCode(code)) { if (!lsGet('scrabble-fr-nom')) lsSet('scrabble-fr-nom', this.myName()); this.joinGame(code); }
      } else if (a === 'share-self') {
        navigator.share?.({ title: 'Scrabble FR — ma partie', url: this.transferUrl() }).catch(() => { /* annulé */ });
      } else if (a === 'share') {
        const url = $<HTMLInputElement>(body, '#olLink').value;
        navigator.share?.({ title: 'Scrabble FR', text: 'Une partie de Scrabble ?', url }).catch(() => { /* annulé */ });
      }
    });
    body.addEventListener('submit', (e) => {
      e.preventDefault();
      // Rejoindre demande un nom : on affiche le champ s'il était masqué (adversaire « ordinateur » coché).
      const online = body.querySelector<HTMLInputElement>('input[name="olOpp"][value="online"]');
      if (online && !cleanName(body.querySelector<HTMLInputElement>('#olName')?.value)) {
        online.checked = true;
        online.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (!saveName()) return;
      const input = $<HTMLInputElement>(body, '#olCode');
      const code = normalizeCode(input.value);
      if (!isCode(code)) { input.classList.add('invalid'); return input.focus(); }
      this.joinGame(code);
    });
    body.addEventListener('input', (e) => (e.target as HTMLElement).classList.remove('invalid'));
    body.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      const help = body.querySelector('#olVariantHelp');
      if (t.name === 'olVariant' && help) help.textContent = VARIANTS.find((v) => v.id === t.value)?.help ?? '';
      if (t.name === 'olOpp') {
        const setup = body.querySelector<HTMLElement>('.setup');
        if (setup) setup.dataset.opp = t.value;
        // Votre fichier ODS ne sert qu'en solo : il ne part jamais sur le serveur.
        const ods = body.querySelector<HTMLOptionElement>('#olDict option[value="ods"]');
        if (ods) {
          ods.disabled = t.value === 'online';
          const sel = ods.parentElement as HTMLSelectElement;
          if (ods.disabled && sel.value === 'ods') sel.value = 'libre';
        }
        if (t.value === 'online') body.querySelector<HTMLInputElement>('#olName')?.focus();
      }
    });
  }

  // ---------- Tuiles ----------

  private async placeTile(id: number, r: number, c: number): Promise<boolean> {
    if (!this.canPlace()) return false;
    if (this.game.board[r][c] || this.pending.some((p) => p.r === r && p.c === c)) return false;
    if (this.game.proposal?.move.placements.some((p) => p.r === r && p.c === c)) return false;
    const onBoard = this.pending.find((p) => p.id === id);
    if (onBoard) {
      onBoard.r = r; onBoard.c = c;
    } else {
      const i = this.tiles.findIndex((t) => t.id === id);
      if (i < 0) return false;
      const t = this.tiles[i];
      let assigned = t.letter;
      if (t.letter === BLANK) {
        const chosen = await this.pickBlankLetter();
        if (!chosen) return false;
        assigned = chosen;
      }
      this.tiles.splice(i, 1);
      this.pending.push({ ...t, r, c, assigned });
    }
    this.sound.place();
    this.selected = null;
    this.render();
    return true;
  }

  /** Remet une tuile sur le chevalet, intercalée à la position `at` (à la fin par défaut). */
  private returnTile(id: number, at = -1) {
    this.sound.pickup();
    let tile: RackTile | undefined;
    const pi = this.pending.findIndex((p) => p.id === id);
    if (pi >= 0) {
      const p = this.pending.splice(pi, 1)[0];
      tile = { id: p.id, letter: p.letter };
    } else {
      const ti = this.tiles.findIndex((t) => t.id === id);
      if (ti < 0) return;
      tile = this.tiles.splice(ti, 1)[0];
    }
    if (at < 0 || at >= this.tiles.length) this.tiles.push(tile);
    else this.tiles.splice(at, 0, tile);
    this.render();
  }

  private recallAll() {
    for (const p of this.pending) this.tiles.push({ id: p.id, letter: p.letter });
    this.pending = [];
    this.selected = null;
  }

  private pickBlankLetter(): Promise<string | null> {
    const d = $(this.root, '#blankDialog');
    const grid = $(d, '.letters');
    grid.innerHTML = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
      .map((l) => `<button class="tile pick" data-l="${l}">${l}</button>`).join('');
    d.classList.add('open');
    return new Promise((resolve) => {
      const done = (v: string | null) => {
        d.classList.remove('open');
        d.removeEventListener('click', onClick);
        resolve(v);
      };
      const onClick = (e: Event) => {
        const t = e.target as HTMLElement;
        const b = t.closest<HTMLElement>('[data-l]');
        if (b) done(b.dataset.l!);
        else if (t === d || t.closest('[data-cancel]')) done(null);
      };
      d.addEventListener('click', onClick);
    });
  }

  // ---------- Événements ----------

  private bindEvents() {
    const actions = this.el.actions;
    actions.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (a === 'play') void this.play();
      else if (a === 'recall') this.withFlip(() => { this.recallAll(); this.render(); });
      else if (a === 'shuffle') this.withFlip(() => { shuffle(this.tiles); this.sound.shuffle(); this.render(); });
      else if (a === 'exchange') this.toggleExchange();
      else if (a === 'confirm-exchange') this.confirmExchange();
      else if (a === 'pass') this.doPass();
      else if (a === 'accept' || a === 'challenge') void this.respond(a);
    });
    this.el.newGame.addEventListener('click', () => this.lobby('menu'));
    this.el.quitBtn.addEventListener('click', () => this.quitOnline());
    // Rejouer contre l'ordinateur avec les mêmes réglages.
    $(this.root, '#endNew').addEventListener('click', () => {
      if (this.mode !== 'solo') return this.rematch();
      const g = this.game;
      this.startSolo(g.level, { variant: g.variant ?? null, theme: g.theme ?? null, dict: g.dict ?? 'libre' });
    });
    $(this.root, '#transferBtn').addEventListener('click', () => this.lobby('transfer'));
    $(this.root, '#gamesBar').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (b?.dataset.resume) this.joinGame(b.dataset.resume);
      else if (b?.hasAttribute('data-games')) this.lobby('menu');
    });
    this.el.sfxBtn.addEventListener('click', () => { this.sound.setSfx(!this.sound.sfxOn); this.renderSoundButtons(); this.sound.place(); });
    this.el.musicBtn.addEventListener('click', () => { this.sound.setMusic(!this.sound.musicOn); this.renderSoundButtons(); });
    // Volume général : on entend un petit « clac » en le réglant (si les effets sont activés).
    const vol = $<HTMLInputElement>(this.root, '#volume');
    vol.value = String(Math.round(this.sound.volume * 100));
    const paintVol = () => vol.style.setProperty('--v', `${vol.value}%`);
    paintVol();
    let lastClack = 0;
    vol.addEventListener('input', () => {
      this.sound.setVolume(+vol.value / 100);
      paintVol();
      const now = performance.now();
      if (now - lastClack > 120) { lastClack = now; this.sound.place(); }
    });
    this.bindTabs();
    const fs = $(this.root, '#fsBtn');
    if (document.fullscreenEnabled) {
      fs.hidden = false;
      fs.title = 'Plein écran';
      fs.addEventListener('click', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => { /* refusé */ });
      });
      document.addEventListener('fullscreenchange', () => {
        const on = !!document.fullscreenElement;
        fs.setAttribute('aria-pressed', String(on));
        fs.title = on ? 'Quitter le plein écran' : 'Plein écran';
      });
    }
    this.renderSoundButtons();
    this.bindNotifications();
    this.bindLobby();
    $(this.root, '#endClose').addEventListener('click', () => $(this.root, '#endDialog').classList.remove('open'));
    this.el.dict.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.type !== 'file') return;
      if (input.files?.[0]) void this.importOds(input.files[0]);
      input.value = '';
    });
    this.el.dict.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-revert]')) void this.revertToFree();
    });
    this.el.dict.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $<HTMLInputElement>(this.el.dict, '#checkWord');
      const out = $(this.el.dict, '#checkResult');
      const w = normalizeWord(input.value) ?? '';
      if (!/^[A-Z]{2,15}$/.test(w)) { out.textContent = 'De 2 à 15 lettres.'; out.className = 'bad'; return; }
      const invalid = await this.invalid([w]);
      out.textContent = invalid.length ? `${w} : refusé` : `${w} : valable`;
      out.className = invalid.length ? 'bad' : 'good';
    });

    document.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'Enter') void this.play();
      else if (e.key === 'Escape') { this.recallAll(); this.exchangeMode = false; this.render(); }
    });

    this.bindDrag();
  }

  /**
   * En portrait, une barre d'onglets en bas bascule entre la partie, l'historique, le dictionnaire
   * et les options (niveau, jeu en ligne, nouvelle partie). En paysage tout est visible à la fois
   * et les options reviennent dans l'en-tête.
   */
  private bindTabs() {
    const opts = $(this.root, '#topActions');
    const top = $(this.root, '.top');
    const optPane = $(this.root, '.pane[data-pane="options"]');
    const details = $<HTMLDetailsElement>(this.root, '.dict-box');
    const place = () => {
      if (this.land.matches) { top.appendChild(opts); this.setTab('game'); }
      else { optPane.appendChild(opts); details.open = true; }
    };
    place();
    this.land.addEventListener('change', place);
    $(this.root, '.tabs').addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;
      if (t) this.setTab(t as Tab);
    });
    // Lancer une partie ramène sur le plateau.
    this.el.newGame.addEventListener('click', () => this.setTab('game'));
    this.setTab('game');
  }

  private setTab(tab: Tab) {
    this.tab = tab;
    $(this.root, '.app').dataset.tab = tab;
    for (const b of this.root.querySelectorAll<HTMLElement>('.tabs [data-tab]')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    this.renderBadge();
  }

  /** Pastille sur l'onglet Historique quand des coups ont été joués depuis la dernière visite. */
  private renderBadge() {
    const badge = this.root.querySelector<HTMLElement>('.tabs .badge');
    if (!badge || !this.game) return;
    const n = this.game.history.length;
    if (this.tab === 'history' || this.historySeen > n) this.historySeen = n;
    badge.hidden = n <= this.historySeen;
  }

  // ---------- Zoom du plateau (téléphone) ----------

  private zoom = 1;
  private static readonly ZOOM_MAX = 2.4;
  private static readonly ZOOM_STEP = 1.8;

  /**
   * Change le zoom en gardant le point (fx, fy) du plateau — fractions de sa largeur et de sa hauteur —
   * sous le point (x, y) de l'écran.
   */
  private setZoom(z: number, x?: number, y?: number, fx?: number, fy?: number) {
    const sc = $(this.root, '#boardScroll');
    const board = this.el.board;
    z = Math.min(App.ZOOM_MAX, Math.max(1, z));
    if (z < 1.04) z = 1;
    const view = sc.getBoundingClientRect();
    x ??= view.left + view.width / 2;
    y ??= view.top + view.height / 2;
    const before = board.getBoundingClientRect();
    fx ??= (x - before.left) / before.width;
    fy ??= (y - before.top) / before.height;
    this.zoom = z;
    sc.style.setProperty('--zoom', String(z));
    sc.classList.toggle('zoomed', z > 1);
    const after = board.getBoundingClientRect();
    sc.scrollLeft += after.left + fx * after.width - x;
    sc.scrollTop += after.top + fy * after.height - y;
    const btn = $(this.root, '#zoomBtn');
    btn.setAttribute('aria-pressed', String(z > 1));
    btn.setAttribute('aria-label', z > 1 ? 'Dézoomer le plateau' : 'Zoomer le plateau');
  }

  /**
   * Zoom définitif (une seule mise en page), adouci par une animation FLIP : le plateau part de là où il
   * est affiché (éventuellement agrandi par l'aperçu du pincement) et glisse vers sa nouvelle place,
   * par une simple transformation que la carte graphique calcule sans recalculer la page.
   */
  private zoomTo(z: number, x?: number, y?: number, fx?: number, fy?: number) {
    const board = this.el.board;
    const from = board.getBoundingClientRect();
    board.style.transform = '';
    board.classList.remove('zooming');
    this.setZoom(z, x, y, fx, fy);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const to = board.getBoundingClientRect();
    if (!to.width || (Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1 && Math.abs(from.width - to.width) < 1)) return;
    board.animate([
      { transformOrigin: '0 0', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})` },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
  }

  private bindZoom() {
    const sc = $(this.root, '#boardScroll');
    const board = this.el.board;
    $(this.root, '#zoomBtn').addEventListener('click', () => this.zoomTo(this.zoom > 1 ? 1 : App.ZOOM_STEP));

    // Double-tap sur une case vide (sans lettre sélectionnée) : zoome / dézoome à cet endroit.
    let lastTap = { t: 0, x: 0, y: 0 };
    sc.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest('.cell');
      if (!cell || cell.querySelector('.tile') || this.selected !== null) { lastTap.t = 0; return; }
      const now = performance.now();
      if (now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        this.zoomTo(this.zoom > 1 ? 1 : App.ZOOM_STEP, e.clientX, e.clientY);
        lastTap.t = 0;
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    });

    // Pincer à deux doigts : pendant le geste, simple aperçu par transformation (aucune mise en page) ;
    // le vrai zoom n'est appliqué qu'au lâcher.
    let pinch: { d0: number; z0: number; fx: number; fy: number; b0: DOMRect; z: number; x: number; y: number } | null = null;
    let frame = 0;
    const mid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2,
      d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY),
    });
    const preview = () => {
      frame = 0;
      if (!pinch) return;
      const { b0, z, x, y, fx, fy } = pinch;
      const k = z / this.zoom;
      board.style.transform = `translate(${x - b0.left - k * fx * b0.width}px, ${y - b0.top - k * fy * b0.height}px) scale(${k})`;
    };
    sc.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      const m = mid(e.touches);
      const b0 = board.getBoundingClientRect();
      pinch = {
        d0: Math.max(m.d, 1), z0: this.zoom, fx: (m.x - b0.left) / b0.width, fy: (m.y - b0.top) / b0.height,
        b0, z: this.zoom, x: m.x, y: m.y,
      };
      board.classList.add('zooming');
      this.pinching = true;
    }, { passive: true });
    sc.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const m = mid(e.touches);
      // Un peu de jeu au-delà des limites pendant le geste ; on revient dans les bornes au lâcher.
      pinch.z = Math.min(App.ZOOM_MAX * 1.15, Math.max(0.85, pinch.z0 * (m.d / pinch.d0)));
      pinch.x = m.x;
      pinch.y = m.y;
      frame ||= requestAnimationFrame(preview);
    }, { passive: false });
    const stop = (e: TouchEvent) => {
      if (e.touches.length >= 2) return;
      if (pinch) {
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        const p = pinch;
        pinch = null;
        this.zoomTo(p.z, p.x, p.y, p.fx, p.fy);
      }
      if (!e.touches.length) this.pinching = false;
    };
    sc.addEventListener('touchend', stop);
    sc.addEventListener('touchcancel', stop);
  }

  /** Deux doigts posés sur le plateau : on ne glisse pas de lettre pendant ce temps. */
  private pinching = false;

  /** Pendant un glissement sur le plateau zoomé, fait défiler quand la lettre approche d'un bord. */
  /**
   * Pendant un glissement sur le plateau zoomé : fait défiler quand la lettre (pas le doigt) reste un moment
   * tout près d'un bord. Vitesse progressive selon la profondeur dans la bande du bord, pour pouvoir viser
   * les cases du bord sans que le plateau file dessous. Renvoie l'instant d'entrée dans la bande (0 = hors bande).
   */
  private edgeScroll(x: number, y: number, since: number): number {
    if (this.zoom <= 1) return 0;
    const sc = $(this.root, '#boardScroll');
    const r = sc.getBoundingClientRect();
    const m = 26, max = 7, dwell = 350;
    const depth = (d: number) => Math.min(1, Math.max(0, d / m));
    const dx = x < r.left + m ? -depth(r.left + m - x) : x > r.right - m ? depth(x - (r.right - m)) : 0;
    const dy = y < r.top + m ? -depth(r.top + m - y) : y > r.bottom - m ? depth(y - (r.bottom - m)) : 0;
    if (!dx && !dy) return 0;
    const now = performance.now();
    if (!since) return now;
    if (now - since > dwell) sc.scrollBy(Math.round(dx * max), Math.round(dy * max));
    return since;
  }

  private bindDrag() {
    /**
     * Géométrie du chevalet relevée au début du glissement (sans décalage) : les autres lettres
     * s'écartent ensuite par `translate` pour ouvrir une place là où la lettre tenue s'intercalera.
     */
    type RackGeom = { others: HTMLElement[]; orig: number[]; center: number; pitch: number; size: number };
    type Drag = {
      id: number; x: number; y: number; src: HTMLElement; ghost: HTMLElement | null; pointer: number;
      fromRack: boolean; rack: RackGeom | null; slot: number | null; over: 'rack' | 'board' | null; cell: number;
      lastX: number; lastY: number; scrolling: boolean; touch: boolean; edgeSince: number;
    };
    let drag: Drag | null = null;

    const measureRack = (src: HTMLElement): RackGeom => {
      const rack = this.el.rack;
      const all = [...rack.querySelectorAll<HTMLElement>('.tile[data-id]')];
      const rects = all.map((el) => el.getBoundingClientRect());
      const rr = rack.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(rack).columnGap) || 6;
      const size = rects[0]?.width ?? Math.max(rr.height - 20, 36);
      const center = rects.length ? (rects[0].left + rects[rects.length - 1].right) / 2 : rr.left + rr.width / 2;
      const others = all.filter((el) => el !== src);
      return {
        others, orig: others.map((el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; }),
        center, pitch: size + gap, size,
      };
    };

    /** Place les lettres du chevalet : une case vide à `slot`, ou resserrées si `slot` est nul. */
    const layoutRack = (g: RackGeom, slot: number | null) => {
      const n = g.others.length;
      const m = slot === null ? n : n + 1;
      const first = g.center - ((m - 1) * g.pitch) / 2;
      g.others.forEach((el, j) => {
        const s = slot === null || j < slot ? j : j + 1;
        const dx = first + s * g.pitch - g.orig[j];
        el.style.translate = Math.abs(dx) < 0.5 ? '' : `${dx}px 0`;
      });
    };

    const rackZone = (x: number, y: number) => {
      const r = this.el.rack.getBoundingClientRect();
      return x > r.left - 24 && x < r.right + 24 && y > r.top - 36 && y < r.bottom + 28;
    };

    const sizeGhost = (d: Drag) => {
      if (!d.ghost) return;
      const cell = this.el.board.firstElementChild?.getBoundingClientRect().width ?? 40;
      const s = d.over === 'rack' ? d.rack!.size : Math.max(cell * 1.08, 34);
      d.ghost.style.width = d.ghost.style.height = `${s}px`;
      d.ghost.style.fontSize = `${s * 0.52}px`;
      d.ghost.dataset.size = String(s);
    };

    /** Au doigt, la lettre tenue flotte au-dessus du pouce pour qu'on voie la case visée ; à la souris, sous le curseur. */
    const lift = (d: Drag) => {
      const s = +(d.ghost?.dataset.size ?? 0);
      return d.touch ? s / 2 + 38 : s * 0.4;
    };

    this.root.addEventListener('pointerdown', (e) => {
      const tileEl = (e.target as HTMLElement).closest<HTMLElement>('.tile[data-id]');
      if (!tileEl || e.button > 0) return;
      drag = {
        id: +tileEl.dataset.id!, x: e.clientX, y: e.clientY, src: tileEl, ghost: null, pointer: e.pointerId,
        fromRack: !!tileEl.closest('#rack'), rack: null, slot: null, over: null, cell: -1,
        lastX: e.clientX, lastY: e.clientY, scrolling: false, touch: e.pointerType !== 'mouse', edgeSince: 0,
      };
      tileEl.setPointerCapture(e.pointerId);
    });

    this.root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const d = drag;
      if (this.pinching && !d.ghost) { drag = null; return; }
      if (!d.ghost) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
        // Ranger son chevalet reste possible pendant le tour de l'adversaire.
        if (this.exchangeMode || (!d.fromRack && !this.canPlace())) return;
        d.rack = measureRack(d.src);
        d.ghost = d.src.cloneNode(true) as HTMLElement;
        d.ghost.classList.remove('selected', 'pop', 'dragging');
        d.ghost.classList.add('ghost');
        d.ghost.style.translate = '';
        document.body.appendChild(d.ghost);
        document.body.classList.add('tile-drag');
        d.src.classList.add('dragging');
        if (d.fromRack) d.slot = d.rack.others.length + 1; // force la première mise en place
      }
      // La lettre est sur le chevalet si le doigt y est ET que la lettre tenue (au-dessus du doigt) n'est plus
      // au-dessus du plateau : on peut ainsi viser les dernières lignes du plateau, doigt déjà sur le chevalet.
      const sr = $(this.root, '#boardScroll').getBoundingClientRect();
      const py = e.clientY - lift(d);
      const aboveBoard = e.clientX >= sr.left && e.clientX <= sr.right && py >= sr.top && py <= sr.bottom;
      const over = !aboveBoard && rackZone(e.clientX, e.clientY) ? 'rack' : 'board';
      if (over !== d.over) { d.over = over; sizeGhost(d); }
      const g = d.rack!;
      let slot: number | null = null;
      if (over === 'rack') {
        const n = g.others.length;
        const first = g.center - (n * g.pitch) / 2;
        slot = Math.max(0, Math.min(n, Math.round((e.clientX - first) / g.pitch)));
      }
      if (slot !== d.slot) {
        if (slot !== null && d.slot !== null && d.slot <= g.others.length) this.sound.slide();
        d.slot = slot;
        layoutRack(g, slot);
      }
      const s = +(d.ghost.dataset.size ?? d.ghost.offsetWidth);
      d.ghost.style.transform = `translate(${e.clientX - s / 2}px, ${e.clientY - lift(d) - s / 2}px)`;
      // Point visé = centre de la lettre tenue (au-dessus du pouce), pas le doigt lui-même.
      d.lastX = e.clientX; d.lastY = e.clientY - lift(d);
      this.highlightDrop(over === 'board' ? d.lastX : -1, d.lastY);
      if (over === 'board' && !d.scrolling) {
        d.scrolling = true;
        const tick = () => {
          if (drag !== d || d.over !== 'board') { d.scrolling = false; return; }
          d.edgeSince = this.edgeScroll(d.lastX, d.lastY, d.edgeSince);
          this.highlightDrop(d.lastX, d.lastY);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    });

    const end = async (e: PointerEvent, cancelled = false) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const d = drag;
      drag = null;
      this.highlightDrop(-1, -1);
      if (!d.ghost) {
        if (!cancelled) this.withFlip(() => this.onTileClick(d.id));
        return;
      }
      const prev = this.tileRects();
      prev.set(d.id, d.ghost.getBoundingClientRect());
      d.ghost.remove();
      document.body.classList.remove('tile-drag');
      d.src.classList.remove('dragging');
      if (cancelled) return this.flipFrom(prev, () => this.render());
      if (d.slot !== null) return this.flipFrom(prev, () => this.returnTile(d.id, d.slot!));
      const cell = (document.elementFromPoint(e.clientX, e.clientY - lift(d)) as HTMLElement | null)?.closest<HTMLElement>('.cell');
      if (cell && (await this.flipFromAsync(prev, () => this.placeTile(d.id, +cell.dataset.r!, +cell.dataset.c!)))) return;
      this.flipFrom(prev, () => this.render());
    };
    // Filet de sécurité : aucun défilement (ni rafraîchissement par glissement) pendant qu'une lettre est tenue.
    document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
    this.root.addEventListener('pointerup', (e) => void end(e));
    this.root.addEventListener('pointercancel', (e) => void end(e, true));

    this.el.board.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell');
      if (!cell || cell.querySelector('.tile')) return;
      const id = this.selected;
      if (id !== null) void this.withFlipAsync(() => this.placeTile(id, +cell.dataset.r!, +cell.dataset.c!));
    });
  }

  // ---------- Animations des tuiles (FLIP) ----------

  /** Positions à l'écran de toutes les tuiles déplaçables, par identifiant. */
  private tileRects() {
    const m = new Map<number, DOMRect>();
    for (const el of this.root.querySelectorAll<HTMLElement>('#rack .tile[data-id], #board .tile[data-id]')) {
      m.set(+el.dataset.id!, el.getBoundingClientRect());
    }
    return m;
  }

  /** Fait glisser chaque tuile de son ancienne position vers la nouvelle après un rendu. */
  private animateTiles(prev: Map<number, DOMRect>) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const el of this.root.querySelectorAll<HTMLElement>('#rack .tile[data-id], #board .tile[data-id]')) {
      const a = prev.get(+el.dataset.id!);
      if (!a) continue;
      const b = el.getBoundingClientRect();
      if (!b.width) continue;
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      const k = a.width / b.width;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(k - 1) < 0.02) continue;
      el.animate(
        [{ translate: `${dx}px ${dy}px`, scale: `${k}`, zIndex: 5 }, { translate: '0 0', scale: '1', zIndex: 5 }],
        { duration: 200, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)' },
      );
    }
  }

  private flipFrom(prev: Map<number, DOMRect>, fn: () => void) { fn(); this.animateTiles(prev); }
  private async flipFromAsync<T>(prev: Map<number, DOMRect>, fn: () => Promise<T>) {
    const res = await fn();
    this.animateTiles(prev);
    return res;
  }
  private withFlip(fn: () => void) { this.flipFrom(this.tileRects(), fn); }
  private withFlipAsync<T>(fn: () => Promise<T>) { return this.flipFromAsync(this.tileRects(), fn); }

  private highlightDrop(x: number, y: number) {
    this.el.board.querySelector('.drop')?.classList.remove('drop');
    if (x < 0) return;
    const cell = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.cell');
    if (cell && !cell.querySelector('.tile')) cell.classList.add('drop');
  }

  private onTileClick(id: number) {
    if (this.exchangeMode) {
      if (!this.canAct()) return;
      if (this.exchangeSel.has(id)) this.exchangeSel.delete(id);
      else this.exchangeSel.add(id);
      return this.render();
    }
    if (!this.canPlace()) return;
    if (this.pending.some((p) => p.id === id)) { this.selected = null; return this.returnTile(id); }
    this.selected = this.selected === id ? null : id;
    this.render();
  }

  // ---------- Rendu ----------

  private buildBoard() {
    const html: string[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const b = BONUS[r][c];
        const star = r === CENTER && c === CENTER;
        html.push(`<div class="cell ${b ? `b-${b}` : ''} ${star ? 'star' : ''}" data-r="${r}" data-c="${c}">` +
          `<span class="label">${star ? '★' : b ? BONUS_LABEL[b] : ''}</span></div>`);
      }
    }
    this.el.board.innerHTML = html.join('');
  }

  private tileHtml(letter: string, blank: boolean, extra = '', id?: number) {
    const v = blank ? '' : `<sub>${letterValue(letter)}</sub>`;
    return `<div class="tile ${blank ? 'blank' : ''} ${extra}"${id !== undefined ? ` data-id="${id}"` : ''}>` +
      `<span>${letter === BLANK ? '' : letter}</span>${v}</div>`;
  }

  private render() {
    const g = this.game;
    if (!g) return;
    const last = new Set(g.lastMove.map(([r, c]) => r * SIZE + c));
    const pend = new Map(this.pending.map((p) => [p.r * SIZE + p.c, p]));
    const prop = new Map((g.proposal?.move.placements ?? []).map((p) => [p.r * SIZE + p.c, p]));
    const themed = new Set(g.themeCells ?? []);
    this.renderFantasy(g.theme ?? null);
    void this.useDict(this.gameDict());
    const cells = this.el.board.children;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = cells[r * SIZE + c] as HTMLElement;
        const t = g.board[r][c];
        const p = pend.get(r * SIZE + c);
        cell.querySelector('.tile')?.remove();
        if (t) cell.insertAdjacentHTML('beforeend', this.tileHtml(t.letter, t.blank,
          `${last.has(r * SIZE + c) ? 'last' : ''} ${themed.has(r * SIZE + c) ? 'themed' : ''}`));
        else if (p) cell.insertAdjacentHTML('beforeend', this.tileHtml(p.letter === BLANK ? p.assigned : p.letter, p.letter === BLANK, 'pending', p.id));
        else if (prop.has(r * SIZE + c)) { const q = prop.get(r * SIZE + c)!; cell.insertAdjacentHTML('beforeend', this.tileHtml(q.letter, q.blank, 'proposed')); }
        cell.classList.toggle('target', this.selected !== null && !t && !p && !prop.has(r * SIZE + c));
      }
    }

    this.el.rack.innerHTML = this.tiles
      .map((t) => this.tileHtml(t.letter, t.letter === BLANK,
        [t.id === this.selected ? 'selected' : '', this.exchangeSel.has(t.id) ? 'marked' : ''].join(' '), t.id))
      .join('');
    this.el.rack.classList.toggle('exchange', this.exchangeMode);

    const solo = this.mode === 'solo';
    const h = g.players[this.me], a = g.players[this.opp];
    const turn = (i: number) => (!g.over && g.current === i ? 'turn' : '');
    const oppTag = solo
      ? (this.busy ? ' <i class="thinking">réfléchit</i>' : '')
      : !this.oppConnected ? ' <i class="off">hors ligne</i>'
      : !g.over && g.current === this.opp ? ' <i class="thinking">joue</i>' : '';
    this.el.scores.innerHTML = `
      <div class="player ${turn(this.me)}"><span class="name">${solo ? 'Vous' : `${esc(h.name)} <i class="off">(vous)</i>`}</span><span class="pts" data-p="${this.me}">${this.shownScore(this.me)}</span></div>
      <div class="player ${turn(this.opp)}"><span class="name">${solo ? 'Ordinateur' : esc(a.name)}${oppTag}</span><span class="pts" data-p="${this.opp}">${this.shownScore(this.opp)}</span></div>`;
    this.el.bag.innerHTML = `${g.bag.length} jeton${g.bag.length > 1 ? 's' : ''} dans le sac` +
      (g.variant ? ` · <span class="variant-tag v-${g.variant}">${variantLabel(g.variant)}</span>` : '') +
      (g.dict && g.dict !== 'libre' ? ` · <span class="variant-tag dict-tag">${esc(g.dict === 'ods' ? 'ODS' : dictInfo(g.dict).label)}</span>` : '') +
      (g.theme ? ` · <span class="variant-tag theme-tag">${themeInfo(g.theme).icons[0]} ${themeInfo(g.theme).label}</span>` : '');

    this.el.history.innerHTML = g.history.length
      ? [...g.history].reverse().map((e) => `<li class="${e.player === this.me ? 'me' : 'ai'} k-${e.kind}">
          <span class="who">${e.kind === 'end' ? '' : e.player === this.me ? 'Vous' : solo ? 'Ordi' : esc(g.players[e.player].name)}</span>
          <span class="what">${esc(e.text)}</span>
          <span class="sc">${e.kind === 'play' ? `+${e.score}` : e.score < 0 ? `−${-e.score}` : ''}</span></li>`).join('')
      : '<li class="empty">Aucun coup pour l’instant.</li>';

    const can = this.canAct();
    this.el.actions.innerHTML = g.proposal && g.proposal.player !== this.me && !g.over
      ? `<button class="btn" data-action="accept" ${this.canRespond() ? '' : 'disabled'}>Accepter</button>
         <button class="btn challenge-btn" data-action="challenge" ${this.canRespond() ? '' : 'disabled'} aria-label="Challenge !">${
           [...'CHALLENGE!'].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('')}</button>`
      : this.exchangeMode
      ? `<button class="btn primary" data-action="confirm-exchange">Échanger ${this.exchangeSel.size || ''}</button>
         <button class="btn" data-action="exchange">Annuler</button>`
      : `<button class="btn primary" data-action="play" ${can && this.pending.length ? '' : 'disabled'}>Jouer</button>
         <button class="btn" data-action="recall" ${this.pending.length ? '' : 'disabled'}>Reprendre</button>
         <button class="btn" data-action="shuffle">Mélanger</button>
         <button class="btn" data-action="exchange" ${can && g.bag.length >= RACK_SIZE ? '' : 'disabled'}>Échanger</button>
         <button class="btn" data-action="pass" ${can ? '' : 'disabled'}>Passer</button>`;

    $(this.root, '#transferBtn').hidden = solo || !this.link;
    this.el.quitBtn.hidden = solo;
    this.renderGamesBar();
    this.el.onlineInfo.hidden = solo;
    if (!solo) {
      const code = this.link?.code ?? '';
      this.el.onlineInfo.innerHTML = `<span class="dot ${this.oppConnected ? 'on' : ''}"></span>En ligne · <b>${esc(code)}</b>`;
      this.el.onlineInfo.title = this.oppConnected ? 'Adversaire connecté' : 'Adversaire déconnecté';
    }

    this.renderDict();
    this.renderBadge();
    void this.updatePreview();
  }

  /** Mode fantasy : couleurs du thème et icône au centre (plateau fixe : rien ne bouge pendant la réflexion). */
  private fantasy: ThemeId | null | undefined;
  private renderFantasy(theme: ThemeId | null) {
    if (theme === this.fantasy) return;
    this.fantasy = theme;
    const app = $(this.root, '.app');
    if (theme) app.dataset.fantasy = theme; else delete app.dataset.fantasy;
    const star = this.el.board.querySelector<HTMLElement>('.cell.star .label');
    if (star) star.textContent = theme ? themeInfo(theme).icons[0] : '★';
  }

  private shownScore(i: 0 | 1) { return (this.shown ?? [this.game.players[0].score, this.game.players[1].score])[i]; }

  private bindNotifications() {
    bindInstall($(this.root, '#installBtn'));
    if (!notifSupported()) return;
    this.el.notifBtn.hidden = false;
    this.notifier.bindFocus();
    this.renderNotifButton();
    this.el.notifBtn.addEventListener('click', async () => {
      const on = await this.notifier.toggle();
      this.renderNotifButton();
      this.setStatus(on ? 'Notifications activées : vous serez prévenu quand c’est à vous de jouer.'
        : this.notifier.blocked ? 'Notifications bloquées par le navigateur : autorisez-les dans les paramètres du site.'
        : 'Notifications désactivées.', !on && this.notifier.blocked);
    });
  }

  private renderNotifButton() {
    const on = this.notifier.enabled;
    this.el.notifBtn.setAttribute('aria-pressed', String(on));
    this.el.notifBtn.title = on ? 'Couper les notifications' : 'Me prévenir quand c’est à moi de jouer';
  }

  private renderSoundButtons() {
    this.el.sfxBtn.setAttribute('aria-pressed', String(this.sound.sfxOn));
    this.el.sfxBtn.title = this.sound.sfxOn ? 'Couper les sons' : 'Activer les sons';
    this.el.musicBtn.setAttribute('aria-pressed', String(this.sound.musicOn));
    this.el.musicBtn.title = this.sound.musicOn ? 'Couper la musique' : 'Musique de fond';
  }

  private renderDict() {
    const head = this.el.dict?.querySelector<HTMLElement>('#dictHead');
    if (!head) return;
    const d = this.dict, loading = this.dictWanted !== null && d?.id !== this.dictWanted;
    const info = d && d.id !== 'ods' ? dictInfo(d.id) : null;
    head.innerHTML = (loading ? '<strong>Chargement de la liste…</strong>'
      : !d ? `<strong class="bad">Liste indisponible</strong><span>${esc(this.dictError)}</span>`
      : d.id === 'ods'
        ? `<strong>${esc(d.label)}</strong><span>${d.count.toLocaleString('fr-FR')} mots · importé, stocké sur cet appareil</span>`
        : `<strong>${esc(d.label)}</strong><span>${d.count.toLocaleString('fr-FR')} mots · ${esc(info!.help)}</span>`) +
      `<span class="muted">${this.mode === 'online' ? 'Liste choisie par la personne qui a créé la partie ; le serveur vérifie chaque coup avec elle.'
        : 'Changer de liste : Options.'}</span>` +
      (this.odsName ? `<button type="button" class="link" data-revert>Supprimer mon fichier importé</button>` : '');
    const credits = this.el.dict.querySelector<HTMLElement>('#dictCredits');
    if (credits && !credits.childElementCount) {
      credits.innerHTML = DICTS.map((x) => `<li><b>${x.label}</b> — ${x.words} mots, d’après
        <a href="${x.url}" target="_blank" rel="noopener">${esc(x.source)}</a> (${x.licence})</li>`).join('');
    }
  }

  private async updatePreview() {
    const token = ++this.previewToken;
    const out = this.el.preview;
    const playBtn = this.el.actions.querySelector<HTMLButtonElement>('[data-action="play"]');
    const setPlayable = (v: boolean) => { if (playBtn) playBtn.disabled = !v; };

    if (!this.game || this.game.over) { out.innerHTML = ''; return setPlayable(false); }
    if (!this.pending.length) this.preparedOk = false;
    const prop = this.game.proposal;
    if (prop) {
      const who = this.mode === 'solo' ? 'L’ordinateur' : esc(this.game.players[this.opp].name);
      const words = prop.move.words.map((w) => w.word).join(' · ');
      out.innerHTML = prop.player === this.me
        ? `<span class="words">${words}</span><span class="muted">${who} accepte ou conteste…</span>`
        : `<span class="words">${words}</span><span class="score">${prop.move.score} pts</span><span class="muted">Accepter ou contester ?</span>`;
      return setPlayable(false);
    }
    const myTurn = this.game.current === this.me;
    const who = this.mode === 'solo' ? 'l’ordinateur' : esc(this.game.players[this.opp].name);
    if (!myTurn && !this.pending.length) {
      out.innerHTML = `<span class="muted">Au tour de ${who}… Vous pouvez préparer votre coup.</span>`;
      return setPlayable(false);
    }
    if (this.exchangeMode) { out.innerHTML = '<span class="muted">Mode échange</span>'; return setPlayable(false); }
    if (!this.pending.length) {
      out.innerHTML = '<span class="muted">Glissez vos lettres sur le plateau, ou touchez une lettre puis une case.</span>';
      return setPlayable(false);
    }
    const res = evaluatePlacement(this.game.board, this.placements());
    this.preparedOk = res.ok;
    if (!res.ok) { out.innerHTML = `<span class="bad">${esc(res.error)}</span>`; return setPlayable(false); }
    const words = res.words.map((w) => w.word);
    // Mode fantasy : en mode normal, les mots du thème sont signalés (et comptés double) dès l'aperçu.
    const shown = this.game.variant ? null : applyTheme(this.game.theme, { placements: [], words: res.words, score: res.score });
    const label = (w: string) => (shown?.words.find((x) => x.word === w)?.themed ? `<b class="themed-word">✦ ${w}</b>` : w);
    const later = myTurn ? '' : `<span class="muted">prêt pour votre tour</span>`;
    out.innerHTML = `<span class="words">${words.map(label).join(' · ')}</span><span class="score">${shown?.score ?? res.score} pts</span>${later}`;
    // Modes challenge et hardcore : on ne sait pas si le mot est valide avant de le jouer.
    if (this.game.variant) return setPlayable(this.canAct());
    setPlayable(false);
    const invalid = await this.invalid(words);
    if (token !== this.previewToken) return;
    if (invalid.length) {
      out.innerHTML = `<span class="words">${words.map((w) => (invalid.includes(w) ? `<s class="bad">${w}</s>` : label(w))).join(' · ')}</span>` +
        `<span class="bad">absent du dictionnaire${this.mode === 'online' ? ' (le serveur tranchera)' : ''}</span>${later}`;
      // En ligne, seul le dictionnaire du serveur fait foi : on peut tenter le coup.
      setPlayable(this.mode === 'online' && this.canAct());
    } else setPlayable(this.canAct());
  }

  private setStatus(msg: string, error = false) {
    this.el.status.textContent = msg;
    this.el.status.className = error ? 'bad' : '';
  }
}

const TEMPLATE = `
<main class="app">
<div class="board-wrap"><div class="board-scroll" id="boardScroll"><div id="board" class="board" aria-label="Plateau"></div></div>
<button class="btn icon zoom-btn" id="zoomBtn" aria-label="Zoomer le plateau" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/><path class="off" d="M10.5 8v5"/></svg></button></div>
<div class="panel">
<header class="top">
  <div class="top-title">
  <h1>Scrabble <em>FR</em></h1>
  <div class="top-icons">
    <button class="btn icon" id="sfxBtn" aria-label="Sons"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path class="on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path class="off" d="M16 9l6 6M22 9l-6 6"/></svg></button>
    <button class="btn icon" id="musicBtn" aria-label="Musique"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/><path class="off" d="M3 3l18 18"/></svg></button>
    <button class="btn icon" id="notifBtn" aria-label="Notifications" aria-pressed="false" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path class="off" d="M3 3l18 18"/></svg></button>
    <button class="btn icon" id="fsBtn" aria-label="Plein écran" aria-pressed="false" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path class="off" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path class="on" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg></button>
  </div>
  </div>
  <div class="top-actions" id="topActions">
    <span id="onlineInfo" class="online-info" hidden></span>
    <button class="btn primary" id="newGame">Nouvelle partie</button>
    <label class="volume" title="Volume (musique et effets)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7"/></svg><span class="vol-label">Volume</span>
      <input type="range" id="volume" min="0" max="100" step="1" aria-label="Volume (musique et effets)" /></label>
    <button class="btn" id="quitBtn" hidden>Quitter la partie en ligne</button>
    <button class="btn" id="transferBtn" hidden>Continuer sur un autre appareil</button>
    <button class="btn" id="installBtn" hidden>Installer l’appli</button>
  </div>
</header>
<section class="scorebox">
  <div id="scores" class="scores"></div>
  <p id="bag" class="bag"></p>
  <p id="gamesBar" class="games-bar" hidden></p>
</section>
<div id="preview" class="preview" aria-live="polite"></div>
<div id="rack" class="rack" aria-label="Chevalet"></div>
<div id="actions" class="actions"></div>
<p id="status" aria-live="polite"></p>
<aside class="side" id="side">
  <section class="pane" data-pane="options"><h2>Options</h2></section>
  <section class="pane" data-pane="history">
    <h2>Historique</h2>
    <ol id="history" class="history"></ol>
  </section>
  <section class="pane" data-pane="dict">
  <details class="dict-box">
    <summary><h2>Dictionnaire</h2></summary>
    <form id="dict" class="dict">
      <div id="dictHead" class="dict-head"></div>
      <ul id="dictCredits" class="dict-credits"></ul>
      <label class="btn file">Importer mon fichier ODS…<input type="file" accept=".txt,.csv,text/plain" hidden /></label>
      <p class="note">L’ODS de la Fédération est protégé par le droit d’auteur et n’est donc pas fourni.
        Si vous en avez une copie, importez-la (un mot par ligne, texte brut). Le fichier reste dans votre navigateur et n’est envoyé nulle part.</p>
      <div class="check">
        <input id="checkWord" placeholder="Vérifier un mot" autocomplete="off" autocapitalize="characters" />
        <button class="btn">OK</button>
      </div>
      <p id="checkResult"></p>
    </form>
  </details>
  </section>
</aside>
<nav class="tabs" role="tablist" aria-label="Sections">
  <button role="tab" data-tab="game"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>Partie</button>
  <button role="tab" data-tab="history"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>Historique<i class="badge" hidden></i></button>
  <button role="tab" data-tab="dict"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/></svg>Dictionnaire</button>
  <button role="tab" data-tab="options"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>Options</button>
</nav>
</div>
</main>
<div id="loading" class="overlay open"><div class="card"><div class="spinner"></div><p>Chargement du dictionnaire…</p></div></div>
<div id="blankDialog" class="overlay"><div class="card">
  <h2>Lettre du joker</h2><div class="letters"></div>
  <button class="btn" data-cancel>Annuler</button>
</div></div>
<div id="onlineDialog" class="overlay"><div class="card online" id="onlineBody"></div></div>
<div id="endDialog" class="overlay"><div class="card">
  <h2 id="endTitle"></h2><p id="endDetail" class="muted"></p>
  <div class="row"><button class="btn primary" id="endNew">Nouvelle partie</button><button class="btn" id="endClose">Voir le plateau</button></div>
</div></div>
`;
