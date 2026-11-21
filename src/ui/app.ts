import { BLANK, BONUS, CENTER, RACK_SIZE, SIZE, letterValue } from '../game/constants';
import { evaluatePlacement } from '../game/rules';
import { shuffle } from '../game/bag';
import {
  AI, exchange, loadGame, newGame, pass, playMove, saveGame, winnerText, type GameState, type HistoryEntry,
} from '../game/game';
import { applyAction, parseAction, viewFor, type Action } from '../game/remote';
import type { Placement } from '../game/types';
import {
  CODE_TAKEN, RelayLink, isCode, newCode, newToken, normalizeCode,
  type GuestLink, type GuestMsg, type HostLink, type HostMsg,
} from '../net/online';
import type { Level } from '../ai/player';
import { Engine } from '../engine';
import { Fx, Sound } from './fx';
import { Notifier, bindInstall, notifSupported } from './notify';
import { clearOds, loadOds, saveOds } from '../dict/store';
import { normalizeWord } from '../dict/normalize.js';

interface RackTile { id: number; letter: string }
interface PendingTile extends RackTile { r: number; c: number; assigned: string }
type Tab = 'game' | 'history' | 'dict' | 'options';
interface DictInfo { source: 'libre' | 'ods'; count: number; name: string }

const BONUS_LABEL: Record<string, string> = { MT: 'Mot<br>×3', MD: 'Mot<br>×2', LT: 'Lettre<br>×3', LD: 'Lettre<br>×2' };
const LEVELS: Level[] = ['facile', 'moyen', 'difficile'];
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const cleanName = (s: unknown) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) : '';
function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* rien */ } }
function lsDel(k: string) { try { localStorage.removeItem(k); } catch { /* rien */ } }
const HOST_SAVE = 'scrabble-fr-hote';
interface HostSave { code: string; token: string; state: GameState }
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
  private dict: DictInfo | null = null;
  private previewToken = 0;
  private tab: Tab = 'game';
  private historySeen = 0;
  private land = matchMedia('(min-aspect-ratio: 1/1) and (min-width: 760px)');

  // Jeu en ligne : « solo » contre l'ordinateur, « host » (crée la partie et arbitre), « guest » (rejoint).
  private mode: 'solo' | 'host' | 'guest' = 'solo';
  private me: 0 | 1 = 0;
  private host: HostLink | null = null;
  private guest: GuestLink | null = null;
  private hostToken = '';
  private oppConnected = false;

  // Effets : sons, animation du dernier coup, compteurs de points.
  private sound = new Sound();
  private fx = new Fx(this.sound);
  private seen = 0;                       // entrées d'historique déjà célébrées
  private shown: [number, number] | null = null; // scores affichés (pendant le défilement)
  private fxDone: Promise<void> = Promise.resolve();
  private notifier = new Notifier();

  private el = {} as Record<
    'board' | 'rack' | 'preview' | 'scores' | 'bag' | 'history' | 'actions' | 'dict' | 'status' | 'level' |
    'levelWrap' | 'onlineBtn' | 'newGame' | 'onlineInfo' | 'onlineBody' | 'sfxBtn' | 'musicBtn' | 'notifBtn',
    HTMLElement
  >;

  constructor(private root: HTMLElement) {}

  async start() {
    this.root.innerHTML = TEMPLATE;
    for (const k of ['board', 'rack', 'preview', 'scores', 'bag', 'history', 'actions', 'dict', 'status', 'level',
      'levelWrap', 'onlineBtn', 'newGame', 'onlineInfo', 'onlineBody', 'sfxBtn', 'musicBtn', 'notifBtn'] as const) {
      this.el[k] = $(this.root, `#${k}`);
    }
    this.buildBoard();
    this.bindEvents();

    const loading = $(this.root, '#loading');
    try {
      await this.loadDictionary();
    } catch (err) {
      loading.innerHTML = `<p>Impossible de charger le dictionnaire.</p><p class="muted">${esc(String(err))}</p>`;
      return;
    }
    loading.remove();

    const saved = loadGame();
    this.game = saved && !saved.over ? saved : newGame(this.readLevel());
    (this.el.level as HTMLSelectElement).value = this.game.level;
    this.seen = this.game.history.length;
    this.syncRack();
    this.render();
    if (this.game.current === AI && !this.game.over) void this.aiTurn();

    const code = normalizeCode(new URLSearchParams(location.search).get('partie') ?? '');
    let hosted: HostSave | null = null;
    try { hosted = JSON.parse(lsGet(HOST_SAVE) ?? 'null'); } catch { /* rien */ }
    if (hosted && isCode(code) && hosted.code === code && !hosted.state.over) {
      // L'hôte a rechargé la page : il reprend sa partie, l'invité se reconnectera.
      this.openHost(code, hosted.token, hosted.state);
    } else if (isCode(code)) {
      // Déjà venu sur cette partie (rechargement) : on se reconnecte directement.
      if (lsGet(`scrabble-fr-jeton-${code}`) && lsGet('scrabble-fr-nom')) this.joinGame(code);
      else this.lobby('menu', code);
    }
  }

  // ---------- Dictionnaire ----------

  private async loadDictionary() {
    const ods = await loadOds();
    if (ods) {
      const { count } = await this.engine.load(ods.text);
      this.dict = { source: 'ods', count, name: ods.name };
    } else {
      const res = await fetch(`${import.meta.env.BASE_URL}dict/fr-libre.txt`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { count } = await this.engine.load(await res.text());
      this.dict = { source: 'libre', count, name: 'Liste libre' };
    }
  }

  private async importOds(file: File) {
    this.setStatus(`Import de « ${file.name} »…`);
    try {
      const { count, normalized } = await this.engine.load(await file.text());
      if (count < 1000) {
        this.setStatus(`Ce fichier ne contient que ${count} mots valides : import annulé.`, true);
        await this.loadDictionary();
        this.renderDict();
        return;
      }
      await saveOds({ name: file.name, count, text: normalized });
      this.dict = { source: 'ods', count, name: file.name };
      this.setStatus(`Dictionnaire importé : ${count.toLocaleString('fr-FR')} mots. Il reste sur cet appareil.`);
    } catch (err) {
      this.setStatus(`Échec de l'import : ${err}`, true);
    }
    this.renderDict();
    void this.updatePreview();
  }

  private async revertToFree() {
    await clearOds();
    this.setStatus('Retour à la liste libre…');
    await this.loadDictionary();
    this.setStatus('Liste libre rechargée.');
    this.renderDict();
    void this.updatePreview();
  }

  // ---------- Partie ----------

  private readLevel(): Level {
    try {
      const l = localStorage.getItem('scrabble-fr-niveau') as Level | null;
      if (l && LEVELS.includes(l)) return l;
    } catch { /* rien */ }
    return 'moyen';
  }

  private startNewGame() {
    if (this.mode !== 'solo') return this.quitOnline();
    if (this.busy) return;
    if (!this.game.over && this.game.history.length > 0 && !confirm('Abandonner la partie en cours ?')) return;
    this.game = newGame((this.el.level as HTMLSelectElement).value as Level);
    this.resetBoardUi();
    this.afterTurn();
  }

  /** Aligne les tuiles affichées sur le chevalet réel, en conservant l'ordre choisi par le joueur. */
  private syncRack() {
    const rack = [...this.game.players[this.me].rack];
    const kept: RackTile[] = [];
    for (const t of [...this.tiles, ...this.pending]) {
      const i = rack.indexOf(t.letter);
      if (i >= 0) { rack.splice(i, 1); kept.push({ id: t.id, letter: t.letter }); }
    }
    this.tiles = [...kept, ...rack.map((letter) => ({ id: this.nextId++, letter }))];
    this.pending = [];
  }

  private placements(): Placement[] {
    return this.pending.map((p) => ({
      r: p.r, c: p.c,
      letter: p.letter === BLANK ? p.assigned : p.letter,
      blank: p.letter === BLANK,
    }));
  }

  private canAct() {
    return !this.busy && !this.game.over && this.game.current === this.me &&
      (this.mode !== 'guest' || this.oppConnected);
  }

  private get opp(): 0 | 1 { return this.me === 0 ? 1 : 0; }

  private async play() {
    if (!this.canAct() || !this.pending.length) return;
    const ps = this.placements();
    const res = evaluatePlacement(this.game.board, ps);
    if (!res.ok) { this.sound.invalid(); return this.setStatus(res.error, true); }
    // L'invité soumet son coup à l'hôte, dont le dictionnaire fait foi.
    if (this.mode === 'guest') return this.sendAction({ type: 'play', placements: ps });
    const invalid = await this.engine.invalidWords(res.words.map((w) => w.word));
    if (invalid.length) this.sound.invalid();
    if (invalid.length) return this.setStatus(`Mot${invalid.length > 1 ? 's' : ''} absent${invalid.length > 1 ? 's' : ''} du dictionnaire : ${invalid.join(', ')}`, true);
    // On retire les tuiles posées pour que syncRack n'en garde que les restantes.
    const placedIds = new Set(this.pending.map((p) => p.id));
    this.pending = [];
    playMove(this.game, { placements: ps, words: res.words, score: res.score });
    this.tiles = this.tiles.filter((t) => !placedIds.has(t.id));
    this.setStatus(`Vous marquez ${res.score} points.`);
    this.afterTurn();
  }

  private doPass() {
    if (!this.canAct()) return;
    if (!confirm('Passer votre tour ?')) return;
    this.recallAll();
    if (this.mode === 'guest') return this.sendAction({ type: 'pass' });
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
    if (this.mode === 'guest') {
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
    if (this.mode === 'host' && this.host) {
      this.host.send({ type: 'state', state: viewFor(this.game, 1), you: 1 });
      lsSet(HOST_SAVE, JSON.stringify({ code: this.host.code, token: this.hostToken, state: this.game } satisfies HostSave));
    }
    this.syncRack();
    this.render();
    this.celebrate();
    if (this.game.over) return void this.fxDone.then(() => this.showEnd());
    if (this.mode === 'solo' && this.game.players[this.game.current].isAi) void this.aiTurn();
  }

  /** Anime et sonorise ce qui vient de se passer (coup joué, échange, tour suivant), puis fait défiler les scores. */
  private celebrate() {
    const g = this.game;
    const fresh = g.history.slice(this.seen);
    this.seen = g.history.length;
    const play = fresh.find((e) => e.kind === 'play');
    let wait = 0;
    if (play && g.lastWords?.length) {
      wait = this.fx.duration(g.lastMove.length, g.lastWords.length);
      this.fxDone = this.fx.countMove(this.el.board, g.lastMove, g.lastWords, play.score);
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
      : theirs.kind === 'exchange' ? `${who} échange des lettres.` : `${who} passe son tour.`;
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
        this.engine.aiMove(g.board, g.players[AI].rack, g.bag.length, g.level),
        this.fxDone.then(() => delay(500)),
      ]);
      if (g !== this.game) return; // nouvelle partie lancée entre-temps
      if (d.kind === 'play') {
        playMove(g, d.move);
        this.setStatus(`L'ordinateur joue ${d.move.words[0].word} pour ${d.move.score} points.`);
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
    $(d, '#endNew').textContent = this.mode === 'solo' ? 'Nouvelle partie' : 'Revanche';
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
    return '';
  }

  private sendAction(action: Action) {
    if (!this.guest?.connected || !this.oppConnected) return this.setStatus('L’hôte n’est pas connecté pour l’instant.', true);
    this.busy = true;
    this.guest.send({ type: 'action', action });
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

  private createGame() {
    this.closeLinks();
    this.openHost(newCode(), newToken(), null);
  }

  /** Ouvre (ou rouvre, après rechargement) une partie en tant qu'hôte. */
  private openHost(code: string, token: string, resume: GameState | null) {
    this.hostToken = token;
    setUrlCode(code);
    if (resume) {
      this.mode = 'host';
      this.me = 0;
      this.game = resume;
      this.resetBoardUi();
      this.setStatus(`Partie en ligne reprise. En attente de ${resume.players[1].name}…`);
      this.syncRack();
      this.render();
    } else this.lobby('hosting', code, false);
    this.host = new RelayLink<GuestMsg, HostMsg>(code, 'host', token, {
      onOpen: () => { if (this.mode === 'solo') this.lobby('hosting', code, true); },
      onPeer: (online) => {
        this.oppConnected = online;
        if (!online && this.mode === 'host' && !this.game.over) {
          this.setStatus(`${this.game.players[1].name} est hors ligne. En attente de son retour…`, true);
        }
        this.render();
      },
      onMessage: (m) => void this.onGuestMsg(m),
      onError: (text, fatal) => {
        if (text === CODE_TAKEN && this.mode === 'solo') return this.createGame();
        if (fatal && this.mode === 'solo') { this.closeLinks(); this.lobby('error', text); } else this.setStatus(text, true);
      },
    });
  }

  private async onGuestMsg(m: GuestMsg) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'hello') {
      const name = cleanName(m.name) || 'Invité';
      if (this.mode !== 'host') {
        this.mode = 'host';
        this.me = 0;
        this.game = newGame('moyen', { names: [this.myName(), name] });
        this.resetBoardUi();
        this.closeLobby();
        this.setStatus(`${name} a rejoint la partie.`);
        void this.notifier.show(`${name} a rejoint la partie`,
          this.game.current === this.me ? 'La partie commence : à vous de jouer !' : `La partie commence : ${name} joue en premier.`, 'tour');
      } else {
        this.game.players[1].name = name;
        this.setStatus(`${name} est de retour.`);
      }
      return this.afterTurn();
    }
    if (this.mode !== 'host') return;
    if (m.type === 'action') {
      const action = parseAction(m.action);
      if (!action) return this.host?.send({ type: 'error', message: 'Coup mal formé.' });
      const err = await applyAction(this.game, 1, action, (w) => this.engine.invalidWords(w));
      if (err) return this.host?.send({ type: 'error', message: err });
      this.setStatus(this.describe(this.game.history[this.game.history.length - 1]));
      this.afterTurn();
    } else if (m.type === 'rematch') {
      if (this.game.over) this.rematch();
    } else if (m.type === 'bye') {
      this.oppConnected = false;
      this.setStatus(`${this.game.players[1].name} a quitté la partie.`, true);
      void this.notifier.show(`${this.game.players[1].name} a quitté la partie`, '', 'depart');
      this.render();
    }
  }

  private joinGame(code: string) {
    this.closeLinks();
    let token = lsGet(`scrabble-fr-jeton-${code}`);
    if (!token) { token = newToken(); lsSet(`scrabble-fr-jeton-${code}`, token); }
    setUrlCode(code);
    this.lobby('joining', code);
    const link: GuestLink = new RelayLink<HostMsg, GuestMsg>(code, 'guest', token, {
      onPeer: (online) => {
        this.oppConnected = online;
        // L'hôte (re)vient : on se présente, il répond avec l'état de la partie.
        if (online) {
          link.send({ type: 'hello', name: this.myName() });
          if (this.mode === 'guest') { this.setStatus(`${this.game.players[this.opp].name} est de retour.`); this.render(); }
          return;
        }
        this.busy = false;
        if (this.mode === 'guest' && !this.game.over) {
          this.setStatus(`${this.game.players[this.opp].name} est hors ligne. En attente de son retour…`, true);
        }
        this.render();
      },
      onMessage: (m) => this.onHostMsg(m),
      onError: (text, fatal) => {
        if (fatal && this.mode === 'solo') { this.closeLinks(); this.lobby('error', text); } else this.setStatus(text, true);
      },
    });
    this.guest = link;
  }

  private onHostMsg(m: HostMsg) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'state') {
      const prev = this.mode === 'guest' ? this.game : null;
      const fresh = !prev || m.state.history.length < prev.history.length || (prev.over && !m.state.over);
      this.mode = 'guest';
      this.me = m.you;
      this.game = m.state;
      if (fresh) { this.resetBoardUi(); this.closeLobby(); }
      this.busy = false;
      const last = this.game.history[this.game.history.length - 1];
      if (fresh) this.setStatus(`Partie contre ${this.game.players[this.opp].name}. Bonne chance !`);
      else if (last && prev && this.game.history.length > prev.history.length) this.setStatus(this.describe(last));
      this.syncRack();
      this.render();
      this.celebrate();
      if (this.game.over && !prev?.over) void this.fxDone.then(() => this.showEnd());
    } else if (m.type === 'error') {
      if (this.mode !== 'guest') { this.closeLinks(); return this.lobby('error', m.message); }
      this.busy = false;
      this.sound.invalid();
      this.setStatus(m.message, true);
      this.render();
    } else if (m.type === 'bye') {
      this.oppConnected = false;
      this.setStatus(`${this.game.players[this.opp].name} a fermé la partie.`, true);
      void this.notifier.show(`${this.game.players[this.opp].name} a fermé la partie`, '', 'depart');
      this.render();
    }
  }

  private rematch() {
    if (this.mode === 'guest') {
      this.guest?.send({ type: 'rematch' });
      $(this.root, '#endDialog').classList.remove('open');
      return this.setStatus('Revanche demandée…');
    }
    const [a, b] = this.game.players;
    this.game = newGame('moyen', { names: [a.name, b.name] });
    this.resetBoardUi();
    this.setStatus('Nouvelle manche !');
    this.afterTurn();
  }

  private closeLinks() {
    this.host?.close({ type: 'bye' });
    this.guest?.close({ type: 'bye' });
    this.host = this.guest = null;
    this.oppConnected = false;
  }

  private quitOnline() {
    if (!this.game.over && !confirm('Quitter la partie en ligne ?')) return;
    this.closeLinks();
    if (this.mode === 'host') lsDel(HOST_SAVE);
    this.mode = 'solo';
    this.me = 0;
    setUrlCode(null);
    const saved = loadGame();
    this.game = saved && !saved.over ? saved : newGame(this.readLevel());
    this.resetBoardUi();
    this.setStatus('Retour à la partie contre l’ordinateur.');
    this.afterTurn();
  }

  private lobby(view: 'menu' | 'hosting' | 'joining' | 'error', arg = '', ready = false) {
    const name = esc(cleanName(lsGet('scrabble-fr-nom')));
    const body = this.el.onlineBody;
    if (view === 'menu') {
      body.innerHTML = `
        <h2>Jouer en ligne</h2>
        <p class="muted">Affrontez quelqu’un à distance : créez une partie et envoyez-lui le lien.</p>
        <label class="field">Votre nom<input id="olName" maxlength="16" autocomplete="nickname" value="${name}" placeholder="Votre nom" /></label>
        ${arg ? '' : '<button class="btn primary wide" data-ol="create">Créer une partie</button><div class="sep"><span>ou</span></div>'}
        <form class="check" data-ol="join-form">
          <input id="olCode" maxlength="7" placeholder="Code de la partie" autocomplete="off" autocapitalize="characters" value="${esc(arg)}" />
          <button class="btn ${arg ? 'primary' : ''}">Rejoindre</button>
        </form>
        <p class="note">Le dictionnaire de la personne qui crée la partie fait foi.</p>
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
    body.querySelector<HTMLInputElement>(view === 'menu' && !name ? '#olName' : '#olCode')?.focus();
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
      this.closeLinks();
      this.closeLobby();
      setUrlCode(null);
    };
    body.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-ol]')?.dataset.ol;
      if (a === 'create') { if (saveName()) this.createGame(); }
      else if (a === 'close' || a === 'cancel') cancel();
      else if (a === 'menu') this.lobby('menu');
      else if (a === 'copy') {
        const input = $<HTMLInputElement>(body, '#olLink');
        input.select();
        navigator.clipboard?.writeText(input.value).then(
          () => { (e.target as HTMLElement).textContent = 'Copié !'; },
          () => document.execCommand('copy'),
        );
      } else if (a === 'share') {
        const url = $<HTMLInputElement>(body, '#olLink').value;
        navigator.share?.({ title: 'Scrabble FR', text: 'Une partie de Scrabble ?', url }).catch(() => { /* annulé */ });
      }
    });
    body.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!saveName()) return;
      const input = $<HTMLInputElement>(body, '#olCode');
      const code = normalizeCode(input.value);
      if (!isCode(code)) { input.classList.add('invalid'); return input.focus(); }
      this.joinGame(code);
    });
    body.addEventListener('input', (e) => (e.target as HTMLElement).classList.remove('invalid'));
  }

  // ---------- Tuiles ----------

  private async placeTile(id: number, r: number, c: number): Promise<boolean> {
    if (!this.canAct() || this.exchangeMode) return false;
    if (this.game.board[r][c] || this.pending.some((p) => p.r === r && p.c === c)) return false;
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
    });
    $(this.root, '#newGame').addEventListener('click', () => this.startNewGame());
    $(this.root, '#endNew').addEventListener('click', () => (this.mode === 'solo' ? this.startNewGame() : this.rematch()));
    this.el.onlineBtn.addEventListener('click', () => this.lobby('menu'));
    this.el.sfxBtn.addEventListener('click', () => { this.sound.setSfx(!this.sound.sfxOn); this.renderSoundButtons(); this.sound.place(); });
    this.el.musicBtn.addEventListener('click', () => { this.sound.setMusic(!this.sound.musicOn); this.renderSoundButtons(); });
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
    this.el.level.addEventListener('change', () => {
      const l = (this.el.level as HTMLSelectElement).value as Level;
      try { localStorage.setItem('scrabble-fr-niveau', l); } catch { /* rien */ }
      if (this.mode !== 'solo') return;
      this.game.level = l;
      saveGame(this.game);
      this.setStatus(`Niveau de l'ordinateur : ${l}.`);
    });

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
      const invalid = await this.engine.invalidWords([w]);
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
    for (const id of ['#onlineBtn', '#newGame']) $(this.root, id).addEventListener('click', () => this.setTab('game'));
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

  private bindDrag() {
    /**
     * Géométrie du chevalet relevée au début du glissement (sans décalage) : les autres lettres
     * s'écartent ensuite par `translate` pour ouvrir une place là où la lettre tenue s'intercalera.
     */
    type RackGeom = { others: HTMLElement[]; orig: number[]; center: number; pitch: number; size: number };
    type Drag = {
      id: number; x: number; y: number; src: HTMLElement; ghost: HTMLElement | null; pointer: number;
      fromRack: boolean; rack: RackGeom | null; slot: number | null; over: 'rack' | 'board' | null; cell: number;
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

    this.root.addEventListener('pointerdown', (e) => {
      const tileEl = (e.target as HTMLElement).closest<HTMLElement>('.tile[data-id]');
      if (!tileEl || e.button > 0) return;
      drag = {
        id: +tileEl.dataset.id!, x: e.clientX, y: e.clientY, src: tileEl, ghost: null, pointer: e.pointerId,
        fromRack: !!tileEl.closest('#rack'), rack: null, slot: null, over: null, cell: -1,
      };
      tileEl.setPointerCapture(e.pointerId);
    });

    this.root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const d = drag;
      if (!d.ghost) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
        // Ranger son chevalet reste possible pendant le tour de l'adversaire.
        if (this.exchangeMode || (!d.fromRack && !this.canAct())) return;
        d.rack = measureRack(d.src);
        d.ghost = d.src.cloneNode(true) as HTMLElement;
        d.ghost.classList.remove('selected', 'pop', 'dragging');
        d.ghost.classList.add('ghost');
        d.ghost.style.translate = '';
        document.body.appendChild(d.ghost);
        d.src.classList.add('dragging');
        if (d.fromRack) d.slot = d.rack.others.length + 1; // force la première mise en place
      }
      const over = rackZone(e.clientX, e.clientY) ? 'rack' : 'board';
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
      d.ghost.style.transform = `translate(${e.clientX - s / 2}px, ${e.clientY - s * 0.9}px)`;
      this.highlightDrop(over === 'board' ? e.clientX : -1, e.clientY);
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
      d.src.classList.remove('dragging');
      if (cancelled) return this.flipFrom(prev, () => this.render());
      if (d.slot !== null) return this.flipFrom(prev, () => this.returnTile(d.id, d.slot!));
      const cell = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.cell');
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
    if (!this.canAct()) return;
    if (this.exchangeMode) {
      if (this.exchangeSel.has(id)) this.exchangeSel.delete(id);
      else this.exchangeSel.add(id);
      return this.render();
    }
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
    const cells = this.el.board.children;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = cells[r * SIZE + c] as HTMLElement;
        const t = g.board[r][c];
        const p = pend.get(r * SIZE + c);
        cell.querySelector('.tile')?.remove();
        if (t) cell.insertAdjacentHTML('beforeend', this.tileHtml(t.letter, t.blank, last.has(r * SIZE + c) ? 'last' : ''));
        else if (p) cell.insertAdjacentHTML('beforeend', this.tileHtml(p.letter === BLANK ? p.assigned : p.letter, p.letter === BLANK, 'pending', p.id));
        cell.classList.toggle('target', this.selected !== null && !t && !p);
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
    this.el.bag.textContent = `${g.bag.length} jeton${g.bag.length > 1 ? 's' : ''} dans le sac`;

    this.el.history.innerHTML = g.history.length
      ? [...g.history].reverse().map((e) => `<li class="${e.player === this.me ? 'me' : 'ai'} k-${e.kind}">
          <span class="who">${e.kind === 'end' ? '' : e.player === this.me ? 'Vous' : solo ? 'Ordi' : esc(g.players[e.player].name)}</span>
          <span class="what">${esc(e.text)}</span>
          <span class="sc">${e.kind === 'play' ? `+${e.score}` : ''}</span></li>`).join('')
      : '<li class="empty">Aucun coup pour l’instant.</li>';

    const can = this.canAct();
    this.el.actions.innerHTML = this.exchangeMode
      ? `<button class="btn primary" data-action="confirm-exchange">Échanger ${this.exchangeSel.size || ''}</button>
         <button class="btn" data-action="exchange">Annuler</button>`
      : `<button class="btn primary" data-action="play" ${can && this.pending.length ? '' : 'disabled'}>Jouer</button>
         <button class="btn" data-action="recall" ${this.pending.length ? '' : 'disabled'}>Reprendre</button>
         <button class="btn" data-action="shuffle">Mélanger</button>
         <button class="btn" data-action="exchange" ${can && g.bag.length >= RACK_SIZE ? '' : 'disabled'}>Échanger</button>
         <button class="btn" data-action="pass" ${can ? '' : 'disabled'}>Passer</button>`;

    this.el.levelWrap.hidden = !solo;
    this.el.onlineBtn.hidden = !solo;
    this.el.newGame.textContent = solo ? 'Nouvelle partie' : 'Quitter';
    this.el.onlineInfo.hidden = solo;
    if (!solo) {
      const code = (this.host ?? this.guest)?.code ?? '';
      this.el.onlineInfo.innerHTML = `<span class="dot ${this.oppConnected ? 'on' : ''}"></span>En ligne · <b>${esc(code)}</b>`;
      this.el.onlineInfo.title = this.oppConnected ? 'Adversaire connecté' : 'Adversaire déconnecté';
    }

    this.renderDict();
    this.renderBadge();
    void this.updatePreview();
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
    const d = this.dict;
    if (!d) return;
    const head = $(this.el.dict, '#dictHead');
    head.innerHTML = d.source === 'ods'
      ? `<strong>${esc(d.name)}</strong><span>${d.count.toLocaleString('fr-FR')} mots · importé, stocké sur cet appareil</span>
         <button type="button" class="link" data-revert>Revenir à la liste libre</button>`
      : `<strong>Liste libre</strong><span>${d.count.toLocaleString('fr-FR')} mots · proche de l’ODS, sans être identique</span>`;
  }

  private async updatePreview() {
    const token = ++this.previewToken;
    const out = this.el.preview;
    const playBtn = this.el.actions.querySelector<HTMLButtonElement>('[data-action="play"]');
    const setPlayable = (v: boolean) => { if (playBtn) playBtn.disabled = !v; };

    if (!this.game || this.game.over) { out.innerHTML = ''; return setPlayable(false); }
    if (this.game.current !== this.me) {
      const who = this.mode === 'solo' ? 'l’ordinateur' : esc(this.game.players[this.opp].name);
      out.innerHTML = `<span class="muted">Au tour de ${who}…</span>`;
      return setPlayable(false);
    }
    if (this.exchangeMode) { out.innerHTML = '<span class="muted">Mode échange</span>'; return setPlayable(false); }
    if (!this.pending.length) {
      out.innerHTML = '<span class="muted">Glissez vos lettres sur le plateau, ou touchez une lettre puis une case.</span>';
      return setPlayable(false);
    }
    const res = evaluatePlacement(this.game.board, this.placements());
    if (!res.ok) { out.innerHTML = `<span class="bad">${esc(res.error)}</span>`; return setPlayable(false); }
    const words = res.words.map((w) => w.word);
    out.innerHTML = `<span class="words">${words.join(' · ')}</span><span class="score">${res.score} pts</span>`;
    setPlayable(false);
    const invalid = await this.engine.invalidWords(words);
    if (token !== this.previewToken) return;
    if (invalid.length) {
      out.innerHTML = `<span class="words">${words.map((w) => (invalid.includes(w) ? `<s class="bad">${w}</s>` : w)).join(' · ')}</span>` +
        `<span class="bad">absent du dictionnaire${this.mode === 'guest' ? ' (l’hôte tranchera)' : ''}</span>`;
      // En ligne, seul le dictionnaire de l'hôte fait foi : l'invité peut tenter le coup.
      setPlayable(this.mode === 'guest' && this.canAct());
    } else setPlayable(this.canAct());
  }

  private setStatus(msg: string, error = false) {
    this.el.status.textContent = msg;
    this.el.status.className = error ? 'bad' : '';
  }
}

const TEMPLATE = `
<main class="app">
<div class="board-wrap"><div id="board" class="board" aria-label="Plateau"></div></div>
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
    <label class="level" id="levelWrap">Niveau
      <select id="level">
        <option value="facile">Facile</option>
        <option value="moyen">Moyen</option>
        <option value="difficile">Difficile</option>
      </select>
    </label>
    <button class="btn primary" id="onlineBtn">Jouer en ligne</button>
    <button class="btn" id="newGame">Nouvelle partie</button>
    <button class="btn" id="installBtn" hidden>Installer l’appli</button>
  </div>
</header>
<section class="scorebox">
  <div id="scores" class="scores"></div>
  <p id="bag" class="bag"></p>
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
