// SCRALATRO : interface (plein écran, au-dessus de l'appli de Scrabble). Réutilise le plateau, les tuiles,
// les sons et le dictionnaire (Web Worker) de l'appli.
import './scralatro.css';
import { SIZE } from '../game/constants';
import type { Fx, Sound } from '../ui/fx';
import {
  CELL_TEX, CELL_TYPES, EDITIONS, FONTS, MAX_POWERS, PASTILLES, POWERS, PROGRAMS, SPECIALS, STYLES, TEXTURES,
  type Mode, type Rarity,
} from './data';
import {
  baseValue, beginTurn, competReward, geometry, has,
  LAST_LEVEL, loadScralatro, lvlOf, movesLeft, newScralatro, nextSpecialLevel,
  nextSpecialOf, packPrice, previewScore, priceFor,
  saveScralatro, tileValue, validate,
  type Cell, type Lex, type MoveResult, type Offer, type PowerInst, type Req, type SGame, type STile, type ShopItem,
  type TurnEnd,
} from './engine';
import { actor, applySxOp, type SxEvent, type SxOp } from './remote';
import type { ClientMsg, ServerMsg } from '../net/protocol';

/** Jeu en ligne : l'appli crée la partie sur le serveur (avec son écran d'attente) et gère la connexion. */
export interface NetDeps {
  host(mode: 'coop' | 'compet', name: string): void;
  /** Se déconnecte de la partie en ligne ; `bye` : la quitte pour de bon. */
  close(bye: boolean): void;
}
export interface Deps { lex: Lex; sound: Sound; fx: Fx; onExit: () => void; net: NetDeps }

const ACTIVE_KEY = 'scrabble-fr-scralatro-actif';
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plural = (n: number, w: string) => `${n} ${w}${Math.abs(n) > 1 ? 's' : ''}`;
const RARITY_CLS: Record<Rarity, string> = { commun: 'r-c', 'peu commun': 'r-u', rare: 'r-r' };
const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* rien */ } }

/** La partie Scralatro était affichée lors de la dernière visite. */
export const scralatroWasActive = () => lsGet(ACTIVE_KEY) === '1' && !!loadScralatro();

// ---------- Rendu des tuiles et des cases ----------
export function tileHtml(g: SGame, t: STile, extra = '', withId = true): string {
  const cls = ['tile', 'sx-tile', extra];
  if (t.l === '?') cls.push('blank');
  if (t.l === '#') cls.push('lock');
  if (t.tex) cls.push(`tex-${t.tex}`);
  if (t.tex === 'papier' && t.wear) cls.push(`wear-${Math.min(3, t.wear)}`);
  if (t.ed) cls.push(`ed-${t.ed}`);
  if (t.font) cls.push(`font-${t.font}`);
  if (t.font === 'infection') cls.push(`inf-${t.inf ?? 0}`);
  for (const s of t.sty) cls.push(`sty-${s}`);
  const l = t.l === '#' ? '🔒' : t.l === '?' ? (t.as ?? '') : t.l;
  const v = tileValue(g, t);
  const val = t.l === '#' ? '' : `<sub class="${t.bonus > 0 ? 'up' : t.bonus < 0 ? 'down' : ''}">${v}</sub>`;
  const pas = t.pas.length ? `<i class="pas">${t.pas.map((p) => `<b class="p-${p}"></b>`).join('')}</i>` : '';
  const tox = t.ed === 'toxique' ? '<i class="tox">☣</i>' : '';
  return `<div class="${cls.join(' ')}"${withId ? ` data-id="${t.id}"` : ''}><span>${l}</span>${val}${pas}${tox}</div>`;
}
export function tileTitle(t: STile): string {
  const parts: string[] = [t.l === '?' ? 'Joker' : t.l === '#' ? 'Verrou' : `Lettre ${t.l}`];
  if (t.bonus) parts.push(`${t.bonus > 0 ? '+' : ''}${t.bonus} de valeur`);
  if (t.tex) parts.push(`${TEXTURES[t.tex].name} : ${TEXTURES[t.tex].desc}${t.tex === 'papier' ? ` (posée ${t.wear ?? 0}/3)` : ''}`);
  if (t.ed) parts.push(`${EDITIONS[t.ed].name} : ${EDITIONS[t.ed].desc}`);
  if (t.font) parts.push(`${FONTS[t.font].name} : ${FONTS[t.font].desc}`);
  for (const p of t.pas) parts.push(`${PASTILLES[p].name} : ${PASTILLES[p].desc}`);
  for (const s of t.sty) parts.push(`${STYLES[s].name} : ${STYLES[s].desc}`);
  return parts.join('\n');
}
function cellClasses(g: SGame, cell: Cell): string {
  const c: string[] = [];
  if (cell.t) c.push(`b-${cell.t === 'MQM' ? 'MQ' : cell.t}`, `sx-${cell.t}`);
  if (cell.x) c.push(`x-${cell.x}`);
  if (g.mode === 'compet' && cell.o !== undefined) c.push(`own-${cell.o}`);
  return c.join(' ');
}
function cellLabel(cell: Cell): string {
  let s = '';
  if (cell.t === 'RND') s = `🎲<br>${cell.rnd ?? ''}`;
  else if (cell.t === 'MQM') s = 'Mot<br>×4↔';
  else if (cell.t) s = CELL_TYPES[cell.t].label;
  if (cell.x) s += `<em>${CELL_TEX[cell.x].icon}</em>`;
  return s;
}
export function cellInfo(cell: Cell): string {
  const parts: string[] = [];
  if (cell.t) parts.push(`${CELL_TYPES[cell.t].name} : ${CELL_TYPES[cell.t].desc}`);
  if (cell.x) parts.push(`${CELL_TEX[cell.x].name} : ${CELL_TEX[cell.x].desc}`);
  return parts.join(' — ') || 'Case de base';
}
function miniCell(cell: Cell): string {
  return `<div class="cell sx-mini ${cellClasses({ mode: 'solo' } as SGame, cell)}"><span class="label">${cellLabel(cell)}</span></div>`;
}

export class Scralatro {
  private root: HTMLElement;
  private g: SGame | null = null;
  /** Coup en préparation : tuile → case. */
  private pend = new Map<number, { r: number; c: number; as?: string }>();
  private rackOrder: number[] = [];
  private sel: number | null = null;
  private exch: Set<number> | null = null;
  private busy = false;
  private selPower: number | null = null;
  private selItem: number | null = null;
  private progSel: number[] = [];
  private progLetter = '';
  /** À deux : joueur à qui l'appareil a été remis. */
  private shownPlayer = -1;
  private previewTok = 0;
  private status = '';
  private statusBad = false;
  /** Menu de partie (bouton ☰ ou Échap). */
  private menuOpen = false;
  /** Partie en ligne : envoi au serveur, code, place du joueur, adversaire connecté. */
  private net: { send: (m: ClientMsg) => void; code: string } | null = null;
  private seat: 0 | 1 = 0;
  private peer = false;
  /** Évènements reçus en cours d'affichage (décompte d'un coup), joués dans l'ordre. */
  private shows: Promise<void> = Promise.resolve();

  constructor(private deps: Deps) {
    this.root = document.createElement('div');
    this.root.className = 'sx';
    this.root.hidden = true;
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.bindDrag();
    document.addEventListener('keydown', (e) => {
      if (this.root.hidden || e.key !== 'Escape' || !this.g) return;
      e.preventDefault();
      // Échap ferme d'abord une fenêtre ouverte par-dessus (sac, journal…), sinon ouvre ou ferme le menu.
      const extra = this.root.querySelector('.sx-extra');
      if (extra && !this.menuOpen) { extra.querySelector<HTMLElement>('[data-a="close-modal"]')?.click(); return; }
      this.menuOpen = !this.menuOpen;
      this.render();
    });
  }

  // ---------- Ouverture ----------
  open() {
    this.root.hidden = false;
    document.body.classList.add('sx-on');
    if (this.net) return this.render();
    lsSet(ACTIVE_KEY, '1');
    const saved = loadScralatro();
    if (saved && saved.phase !== 'over') { this.g = saved; this.resetUi(); this.render(); }
    else this.menu();
  }
  private exit() {
    this.leaveNet(false);
    this.hide();
    lsSet(ACTIVE_KEY, null);
    this.deps.onExit();
  }
  /** Cache l'écran Scralatro (la partie locale reste sauvegardée). */
  hide() {
    this.root.hidden = true;
    document.body.classList.remove('sx-on');
  }
  get visible() { return !this.root.hidden; }
  private resetUi() {
    this.pend.clear(); this.sel = null; this.exch = null; this.selPower = null; this.selItem = null;
    this.progSel = []; this.progLetter = ''; this.shownPlayer = -1; this.status = ''; this.rackOrder = [];
    this.menuOpen = false; this.busy = false;
  }

  // ---------- En ligne ----------
  get online() { return this.net !== null; }
  get onlineCode() { return this.net?.code ?? null; }
  /** Début d'une partie en ligne (ou reprise) : l'appli transmet ensuite les messages du serveur. */
  attach(code: string, send: (m: ClientMsg) => void, peer: boolean) {
    if (this.net?.code !== code) { this.g = null; this.resetUi(); }
    this.net = { code, send };
    this.peer = peer;
    this.root.hidden = false;
    document.body.classList.add('sx-on');
  }
  /** Quitte la partie en ligne (`bye` : pour de bon) ; sans effet en local. */
  private leaveNet(bye: boolean) {
    if (!this.net) return;
    this.net = null;
    this.peer = false;
    this.g = null;
    this.deps.net.close(bye);
  }
  onPeer(online: boolean) {
    const was = this.peer;
    this.peer = online;
    if (!this.g || was === online) return this.render();
    const other = this.g.players[1 - this.seat]?.name ?? 'Votre partenaire';
    this.say(online ? `${other} est connecté.` : `${other} est hors ligne : la partie l’attendra.`);
    this.render();
  }
  onLeft() {
    const other = this.g?.players[1 - this.seat]?.name ?? 'Votre partenaire';
    this.peer = false;
    this.say(`${other} a quitté la partie.`, true);
    this.render();
  }
  onNetError(text: string) {
    this.busy = false;
    this.deps.sound.invalid();
    this.say(text, true);
    if (this.g) this.render(); else this.menu();
  }
  onServer(m: Extract<ServerMsg, { type: 'sx' }>) {
    const prev = this.g;
    const fresh = !prev || (prev.phase === 'over' && m.state.phase !== 'over') || m.state.log.length < prev.log.length;
    this.seat = m.you;
    this.g = m.state;
    if (fresh) { this.resetUi(); this.say(prev ? 'Nouvelle partie !' : `Partie ${m.state.mode === 'coop' ? 'coopérative' : 'compétitive'} en ligne.`); }
    const ev = m.ev;
    if (ev?.by === this.seat) this.busy = false;
    if (!ev) return this.render();
    const turnBefore = prev ? actor(prev) === this.seat : false;
    if (ev.by === this.seat) this.pend.clear();
    this.render();
    this.shows = this.shows.then(async () => {
      if (this.g !== m.state) { this.render(); return; }
      await this.present(ev);
      if (this.g === m.state && !turnBefore && actor(m.state) === this.seat && m.state.phase !== 'over') this.deps.sound.turn();
      this.render();
    });
  }

  /** Joueur qui doit agir maintenant peut être moi (toujours vrai sur un seul appareil). */
  private canAct(): boolean {
    const g = this.g;
    if (!g || g.phase === 'over' || g.won) return false;
    return !this.net || actor(g) === this.seat;
  }

  /** Envoie une action : appliquée tout de suite sur cet appareil, ou envoyée au serveur en ligne. */
  private async act(op: SxOp): Promise<boolean> {
    const g = this.g;
    if (!g) return false;
    if (this.net) {
      this.busy = true;
      this.net.send({ type: 'sx', op });
      this.render();
      return true;
    }
    const r = await applySxOp(g, op.k === 'abandon' ? this.me : actor(g), op, this.deps.lex);
    if (!r.ok) { this.deps.sound.invalid(); this.say(r.error, true); this.render(); return false; }
    this.save();
    if (op.k === 'play') { this.render(); }
    await this.present(r.ev);
    if (this.g === g) this.render();
    return true;
  }

  /** Affiche le résultat d'une action (les miennes comme celles de l'autre joueur en ligne). */
  private async present(ev: SxEvent) {
    const g = this.g!;
    const mine = !this.net || ev.by === this.seat;
    const who = g.players.length > 1 && !mine ? `${g.players[ev.by].name} : ` : '';
    switch (ev.k) {
      case 'play':
        this.say('');
        this.deps.sound.tiles(ev.res?.placed.length ?? 1, 60);
        if (ev.res && ev.end) { await this.showBreakdown(ev.res, ev.end); await this.afterTurn(ev.end); }
        return;
      case 'pass': case 'exchange': {
        if (ev.k === 'exchange') this.deps.sound.shuffle(); else this.deps.sound.soft();
        const text = ev.msg ?? ev.end?.lines.join(' · ') ?? '';
        this.say(who ? `${who}${ev.k === 'pass' ? 'passe son tour' : 'échange des lettres'}.${text ? ` ${text}` : ''}` : text);
        if (ev.end) await this.afterTurn(ev.end);
        return;
      }
      case 'sell':
        if (ev.msg) this.say(who + ev.msg);
        if (ev.end) await this.afterTurn(ev.end);
        return;
      case 'buy': case 'offer': case 'cell': case 'program': case 'reserve':
        if (mine) { this.deps.sound.sparkle(); this.say(ev.msg ?? ''); }
        return;
      case 'reroll': if (mine) { this.deps.sound.shuffle(); this.say(ev.msg ?? ''); } return;
      case 'leave':
        this.say(ev.msg ?? '');
        if (g.phase === 'play' && g.mode !== 'compet') this.deps.sound.turn();
        return;
      case 'abandon':
        this.deps.sound.end(false);
        return;
      default: return;
    }
  }

  private menu() {
    this.leaveNet(false);
    this.g = null;
    this.menuOpen = false;
    const saved = loadScralatro();
    const resume = saved && saved.phase !== 'over';
    this.root.innerHTML = `
      <div class="sx-menu">
        <h1 class="sx-logo">SCRA<span>LATRO</span></h1>
        <p class="sx-tag">Le plateau et les lettres du Scrabble, des objectifs de score, un magasin et des tuiles pouvoir.</p>
        ${resume ? `<button class="sx-btn gold wide" data-a="resume">Reprendre la partie · niveau ${lvlOf(saved!, 0).n}</button>` : ''}
        <div class="sx-modes">
          <button class="sx-mode" data-a="mode" data-mode="solo"><b>🃏 Solo</b><span>15 niveaux à valider, de plus en plus exigeants.</span></button>
          <button class="sx-mode" data-a="mode" data-mode="coop"><b>🤝 Multijoueur coopératif</b><span>À deux, en ligne ou sur cet appareil : score et coups en commun, chacun ses pouvoirs et son sac.</span></button>
          <button class="sx-mode" data-a="mode" data-mode="compet"><b>⚔️ Multijoueur compétitif</b><span>À deux, en ligne ou sur cet appareil : chacun son niveau ; le plus de points gagne.</span></button>
        </div>
        <div class="sx-names" hidden>
          <h3 class="sx-names-title"></h3>
          <label>Votre nom<input id="sxN1" maxlength="14" value="${esc(lsGet('scrabble-fr-nom') || 'Joueur 1')}" /></label>
          <button class="sx-btn gold wide" data-a="host">🌐 En ligne : créer la partie et envoyer le lien</button>
          <div class="sx-sep"><span>ou sur cet appareil</span></div>
          <label>Joueur 2<input id="sxN2" maxlength="14" value="Joueur 2" /></label>
          <button class="sx-btn wide" data-a="start2">À deux sur cet appareil</button>
        </div>
        <button class="sx-btn ghost" data-a="exit">← Retour au Scrabble</button>
      </div>`;
  }

  private start(mode: Mode, names: string[] = [], ask = true) {
    if (ask && loadScralatro()?.phase === 'play' && !confirm('Abandonner la partie Scralatro en cours ?')) return;
    this.leaveNet(false);
    lsSet(ACTIVE_KEY, '1');
    this.g = newScralatro(mode, names);
    this.resetUi();
    this.save();
    this.render();
  }

  /** Sur cet appareil seulement : en ligne, la partie est gardée par le serveur. */
  private save() { if (this.g && !this.net) saveScralatro(this.g); }

  // ---------- Qui joue ----------
  /** Joueur dont on affiche le chevalet et les pouvoirs. */
  private get me(): 0 | 1 {
    if (this.net) return this.seat;
    return actor(this.g!);
  }
  /** À deux sur un appareil : écran de passage avant de dévoiler un chevalet. */
  private needHandoff(): boolean {
    const g = this.g!;
    if (this.net || g.players.length < 2 || g.phase === 'over') return false;
    return this.shownPlayer !== this.me;
  }

  // ---------- Rendu ----------
  private render() {
    const g = this.g;
    if (!g) return this.menu();
    if (this.needHandoff()) return this.renderHandoff();
    const p = g.players[this.me];
    const lv = lvlOf(g, this.me);
    this.syncRack();
    const compet = g.mode === 'compet';
    const sp = lv.special ? SPECIALS[lv.special] : null;
    const pct = Math.max(0, Math.min(100, (lv.score / lv.target) * 100));
    const scores = compet ? `<div class="sx-duel">${g.players.map((x, i) => {
      const l = lvlOf(g, i);
      return `<div class="sx-duel-p ${i === g.cur && g.phase === 'play' ? 'on' : ''} pc-${i}"><b>${esc(x.name)}</b><span>Niv. ${l.n} · ${l.score}/${l.target}</span><span>Total ${x.total} · ${x.money} $</span></div>`;
    }).join('')}</div>` : '';
    const moves = compet ? `<div class="sx-stat"><small>Récompense</small><b class="${competReward(lv) < 0 ? 'neg' : ''}">${competReward(lv)} $</b></div>`
      : `<div class="sx-stat"><small>Coups</small><b>${movesLeft(g, this.me)}</b></div>`;
    const money = g.mode === 'coop' ? g.players.map((x, i) => `<b class="pc-${i}">${x.money} $</b>`).join(' ') : `<b>${p.money} $</b>`;
    this.root.innerHTML = `
      <div class="sx-game ${g.phase === 'shop' ? 'in-shop' : ''}">
        <header class="sx-head">
          <button class="sx-icon" data-a="menu" title="Menu (Échap)" aria-label="Menu">☰</button>
          <button class="sx-level ${sp ? 'special' : ''}" data-a="level-info" title="${esc(sp ? `${sp.name} : ${sp.desc}` : 'Niveau normal')}">
            <small>Niveau</small><b>${lv.n}</b>${sp ? `<i>${sp.letter}</i>` : ''}</button>
          <div class="sx-goal">
            <div class="sx-goal-txt"><span class="sx-score" data-score>${lv.score}</span><span> / ${lv.target}</span></div>
            <div class="sx-bar"><i style="width:${pct}%"></i></div>
          </div>
          ${moves}
          <div class="sx-stat money"><small>${g.mode === 'coop' ? 'Argent' : esc(p.name)}</small>${money}</div>
        </header>
        ${scores}
        ${this.netBar()}
        ${sp ? `<p class="sx-special"><b>${sp.letter} ${sp.name}</b> ${esc(sp.desc)}</p>` : ''}
        ${this.powersHtml()}
        <div class="sx-board-wrap"><div class="board sx-board" id="sxBoard">${this.boardHtml()}</div></div>
        <div class="sx-preview" id="sxPreview"></div>
        <div class="rack sx-rack ${this.exch ? 'exchange' : ''}" id="sxRack">${this.rackHtml()}</div>
        <div class="sx-actions">${this.actionsHtml()}</div>
        <p class="sx-status ${this.statusBad ? 'bad' : ''}">${esc(this.status)}</p>
      </div>
      ${g.phase === 'shop' && !g.pending && actor(g) === this.me ? this.shopHtml() : ''}
      ${g.pending && g.pendingFor === this.me ? this.pendingHtml() : ''}
      ${g.phase === 'over' ? this.overHtml() : g.won ? this.wonHtml() : ''}
      ${this.menuOpen ? this.gameMenuHtml() : ''}`;
    void this.updatePreview();
  }

  /** En ligne : code de la partie, présence de l'autre joueur, et qui doit agir. */
  private netBar(): string {
    const g = this.g!;
    if (!this.net) return '';
    const other = g.players[1 - this.seat];
    const a = actor(g);
    const what = g.phase === 'over' ? 'Partie terminée'
      : a === this.seat ? (g.phase === 'shop' ? 'À vous : magasin' : g.pending ? 'À vous de choisir' : 'À vous de jouer')
      : g.phase === 'shop' ? `${esc(other.name)} fait ses achats…` : `Au tour de ${esc(other.name)}…`;
    return `<div class="sx-net"><span class="dot ${this.peer ? 'on' : ''}" title="${this.peer ? 'Connecté' : 'Hors ligne'}"></span>
      <span>En ligne · <b>${esc(this.net.code)}</b> · ${esc(other.name)}</span><span class="sx-net-turn ${a === this.seat ? 'mine' : ''}">${what}</span></div>`;
  }

  private gameMenuHtml(): string {
    const g = this.g!;
    const mode = g.mode === 'solo' ? 'solo' : g.mode === 'coop' ? 'coopératif' : 'compétitif';
    const kind = g.mode === 'solo' ? 'Partie solo' : `Partie en mode ${mode}`;
    const live = g.phase !== 'over';
    return `<div class="sx-modal sx-menu-modal"><div class="sx-card"><h2>Menu</h2>
      <p class="sx-hint">${kind}${this.net ? ` en ligne (${esc(this.net.code)})` : ''} · niveau ${lvlOf(g, this.me).n}</p>
      <div class="sx-menu-btns">
        <button class="sx-btn gold wide" data-a="menu-close">▶ Reprendre la partie</button>
        ${live ? '<button class="sx-btn wide red" data-a="abandon">🏳 Abandonner la partie</button>' : ''}
        <button class="sx-btn wide" data-a="restart">↻ Nouvelle partie (mode ${mode})</button>
        <button class="sx-btn wide" data-a="modes">☰ Choisir un autre mode</button>
        <button class="sx-btn wide ghost" data-a="quit">← Retour au Scrabble</button>
      </div>
      ${this.net ? '<p class="sx-hint">En ligne, « Choisir un autre mode » et « Retour » vous déconnectent sans quitter la partie : vous la retrouverez dans « Mes parties en cours ».</p>' : ''}
      </div></div>`;
  }

  private renderHandoff() {
    const g = this.g!;
    const p = g.players[this.me];
    const what = g.phase === 'shop' ? 'au magasin' : 'de jouer';
    this.root.innerHTML = `<div class="sx-handoff pc-${this.me}">
      <p>Passez l’appareil à</p><h2>${esc(p.name)}</h2><p>C’est à vous ${what}.</p>
      ${g.log.length ? `<p class="sx-last">${esc(g.log[g.log.length - 1].text)}</p>` : ''}
      <button class="sx-btn gold" data-a="ready">Je suis prêt</button></div>`;
  }

  private boardHtml(): string {
    const g = this.g!;
    const pendAt = new Map<number, number>();
    for (const [id, q] of this.pend) pendAt.set(q.r * SIZE + q.c, id);
    const p = g.players[this.me];
    const cellMode = g.pending?.type === 'cell';
    const out: string[] = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const cell = g.cells[r][c];
      const t = g.board[r][c];
      const pid = pendAt.get(r * SIZE + c);
      let inner = '';
      if (t) inner = tileHtml(g, t, `placed own${t.own}`, false);
      else if (pid !== undefined) {
        const tile = p.rack.find((x) => x.id === pid);
        if (tile) inner = tileHtml(g, { ...tile, as: this.pend.get(pid)!.as }, 'pending');
      }
      const target = (cellMode || (this.sel !== null && !t && pid === undefined)) ? 'target' : '';
      out.push(`<div class="cell ${cellClasses(g, cell)} ${target}" data-r="${r}" data-c="${c}" title="${esc(cellInfo(cell))}"><span class="label">${cellLabel(cell)}</span>${inner}</div>`);
    }
    return out.join('');
  }

  private syncRack() {
    const p = this.g!.players[this.me];
    const ids = p.rack.map((t) => t.id);
    this.rackOrder = [...this.rackOrder.filter((id) => ids.includes(id)), ...ids.filter((id) => !this.rackOrder.includes(id))];
    for (const id of [...this.pend.keys()]) if (!ids.includes(id)) this.pend.delete(id);
  }
  private rackHtml(): string {
    const g = this.g!;
    if (g.phase !== 'play') return '<span class="sx-rack-note">Chevalet vide entre deux niveaux</span>';
    const p = g.players[this.me];
    const lv = lvlOf(g, this.me);
    return this.rackOrder.filter((id) => !this.pend.has(id)).map((id) => {
      const t = p.rack.find((x) => x.id === id)!;
      const cls = [this.sel === id ? 'selected' : '', this.exch?.has(id) ? 'marked' : '', lv.special === 'rho' && p.rho === id ? 'rho' : ''].join(' ');
      return tileHtml(g, t, cls).replace('<div ', `<div title="${esc(tileTitle(t))}" `);
    }).join('');
  }

  private powersHtml(): string {
    const g = this.g!;
    const pi = this.me;
    const p = g.players[pi];
    const lv = lvlOf(g, pi);
    const slots = p.powers.map((x) => {
      const info = POWERS[x.id];
      const off = lv.special === 'psi' && g.phase === 'play' && p.psi === x.uid;
      return `<button class="sx-power ${RARITY_CLS[info.rarity]} ${this.selPower === x.uid ? 'sel' : ''} ${off ? 'off' : ''}" data-a="power" data-uid="${x.uid}" title="${esc(`${info.name} : ${info.desc}`)}">
        <span class="em">${info.icon}</span><span class="nm">${esc(info.name.replace(/^(Le |La |Les |L’)/, ''))}</span></button>`;
    });
    for (let i = p.powers.length; i < MAX_POWERS; i++) slots.push('<span class="sx-power empty"></span>');
    const selected = p.powers.find((x) => x.uid === this.selPower);
    const reserve = p.reserve ? PROGRAMS[p.reserve] : null;
    const detail = selected ? (() => {
      const info = POWERS[selected.id];
      const i = p.powers.indexOf(selected);
      const note = this.powerNote(selected);
      return `<div class="sx-pdetail ${RARITY_CLS[info.rarity]}"><div><b>${info.icon} ${esc(info.name)}</b> <small>${info.rarity}</small>
        <p>${esc(info.desc)}${note ? ` <em>${esc(note)}</em>` : ''}</p></div>
        <div class="sx-pbtns"><button class="sx-btn small" data-a="pmove" data-d="-1" ${i === 0 || this.busy || !this.canAct() ? 'disabled' : ''}>◀</button>
        <button class="sx-btn small" data-a="pmove" data-d="1" ${i === p.powers.length - 1 || this.busy || !this.canAct() ? 'disabled' : ''}>▶</button>
        <button class="sx-btn small red" data-a="sell" ${this.busy || !this.canAct() ? 'disabled' : ''}>Vendre ${Math.max(1, Math.floor(selected.price / 2))} $</button></div></div>`;
    })() : '';
    return `<section class="sx-powers"><div class="sx-pslots">${slots.join('')}
      <button class="sx-reserve ${reserve ? 'full' : ''}" data-a="reserve" title="${esc(reserve ? `Réserve : ${reserve.name} — ${reserve.desc}` : 'Réserve de programme (vide)')}" ${reserve && this.canAct() ? '' : 'disabled'}>
        <span class="em">${reserve ? reserve.icon : '💾'}</span><span class="nm">${reserve ? esc(reserve.name) : 'Réserve'}</span></button></div>${detail}</section>`;
  }
  private powerNote(x: PowerInst): string {
    const g = this.g!;
    const p = g.players[this.me];
    switch (x.id) {
      case 'muet': return `Actuellement ×${1 + 2 * p.muet}.`;
      case 'eboueur': return `Actuellement ×${1 + 0.5 * p.eboueur}.`;
      case 'maladroit': case 'pessimiste': return `Actuellement ×${1 + x.n}.`;
      case 'collectionneur': return `Actuellement ×${1 + 0.25 * x.n}.`;
      case 'croupier': case 'desinfecteur': return `Actuellement ×${1 + 0.5 * x.n}.`;
      case 'vieux': return `Actuellement ×${Math.max(0, 4 - 0.05 * x.n).toFixed(2)}.`;
      case 'idole': return p.idole ? `Voyelle de ce coup : ${p.idole}.` : '';
      case 'cancre': return p.cancre ? 'Déjà utilisé dans ce niveau.' : '';
      case 'cryptographe': return p.crypto !== null ? `Décalage de ce niveau : ${p.crypto}.` : '';
      default: return '';
    }
  }

  private actionsHtml(): string {
    const g = this.g!;
    if (g.phase !== 'play') return `<button class="sx-btn" data-a="log">Journal</button><button class="sx-btn" data-a="bag">Sac</button>`;
    const dis = this.busy || !this.canAct() ? 'disabled' : '';
    if (this.exch) {
      return `<button class="sx-btn gold" data-a="exch-ok" ${dis}>Échanger ${this.exch.size || ''}</button><button class="sx-btn" data-a="exch">Annuler</button>`;
    }
    return `<button class="sx-btn gold" data-a="play" ${this.pend.size && !dis ? '' : 'disabled'}>Jouer</button>
      <button class="sx-btn" data-a="recall" ${this.pend.size ? '' : 'disabled'}>Reprendre</button>
      <button class="sx-btn" data-a="shuffle">Mélanger</button>
      <button class="sx-btn" data-a="exch" ${dis || (lvlOf(g, this.me).special === 'lambda' ? 'disabled' : '')}>Échanger</button>
      <button class="sx-btn" data-a="pass" ${dis}>Passer</button>
      <button class="sx-btn" data-a="bag">Sac</button>
      <button class="sx-btn" data-a="log">Journal</button>`;
  }

  // ---------- Magasin ----------
  private shopHtml(): string {
    const g = this.g!;
    const pi = this.me;
    const p = g.players[pi];
    const s = p.shop;
    if (!s) return '';
    const lv = lvlOf(g, pi);
    const nextN = nextSpecialLevel(lv.n);
    const nsp = nextN === lv.n && lv.special ? lv.special : nextSpecialOf(g, pi);
    const spInfo = SPECIALS[nsp];
    const item = (it: ShopItem, i: number) => {
      const price = priceFor(g, pi, it.price);
      return `<button class="sx-item ${it.sold ? 'sold' : ''} ${this.selItem === i ? 'sel' : ''} k-${it.kind}" data-a="item" data-i="${i}" ${it.sold ? 'disabled' : ''}>
        <div class="sx-item-icon">${this.offerIcon(it)}</div>
        <span class="sx-item-name">${esc(this.offerName(it))}</span>
        <span class="sx-price ${price < it.price ? 'deal' : ''}">${it.sold ? 'Vendu' : `${price} $`}</span></button>`;
    };
    const sel = this.selItem !== null ? s.items[this.selItem] : null;
    const first = g.players.every((x) => x.total === 0) && lv.n === 1 && lv.used === 0 && lv.score === 0;
    return `<div class="sx-shop">
      <div class="sx-shop-head"><h2>Magasin</h2><span class="sx-money">${p.money} $</span>${g.players.length > 1 ? `<span class="pc-${pi}">${esc(p.name)}</span>` : ''}</div>
      <p class="sx-shop-sub">${first ? 'Vos achats sont actifs dès le niveau 1.' : `Prochain : niveau ${lv.n} — ${lv.target} points${g.mode === 'compet' ? `, récompense ${competReward(lv)} $ (−1 $ par tour)` : ` en ${lv.moves} coups`}.`}</p>
      <div class="sx-boss"><b>${spInfo.letter}</b><div><small>Niveau spécial ${nextN}</small><strong>${spInfo.name}</strong><span>${esc(spInfo.desc)}</span></div></div>
      <div class="sx-items">${s.items.slice(0, 3).map((it, i) => item(it, i)).join('')}</div>
      <div class="sx-items packs">${s.items.slice(3).map((it, i) => item(it, i + 3)).join('')}</div>
      ${sel && !sel.sold ? `<div class="sx-item-desc"><p>${this.offerDesc(sel)}</p>
        <button class="sx-btn gold" data-a="buy" ${p.money < priceFor(g, pi, sel.price) ? 'disabled' : ''}>Acheter ${priceFor(g, pi, sel.price)} $</button></div>` : '<p class="sx-hint">Touchez un article pour le détail.</p>'}
      ${this.powersHtml()}
      <div class="sx-shop-btns">
        <button class="sx-btn" data-a="reroll" ${p.money < s.reroll ? 'disabled' : ''}>Relancer ${s.reroll} $</button>
        <button class="sx-btn" data-a="bag">Mon sac</button>
        <button class="sx-btn gold" data-a="leave">${g.shopQueue.length > 1 ? 'Joueur suivant ▶' : g.mode === 'compet' && !first ? 'Reprendre la partie ▶' : `Niveau ${lv.n} ▶`}</button>
      </div>
      <p class="sx-status ${this.statusBad ? 'bad' : ''}">${esc(this.status)}</p>
    </div>`;
  }
  private offerName(o: Offer | ShopItem): string {
    switch (o.kind) {
      case 'tile': return o.tile.l === '?' ? 'Joker spécial' : `Tuile ${o.tile.l}`;
      case 'cell': return [o.cell.t ? CELL_TYPES[o.cell.t].name : '', o.cell.x ? CELL_TEX[o.cell.x].name : ''].filter(Boolean).join(' · ');
      case 'power': return POWERS[o.id].name;
      case 'program': return PROGRAMS[o.id].name;
      case 'upgrade': return `Amélioration ${o.letter}`;
      default: return { tile: 'Paquet lettres', cell: 'Paquet cases', power: 'Paquet pouvoirs', program: 'Paquet programmes', upgrade: 'Paquet améliorations' }[o.of];
    }
  }
  private offerIcon(o: Offer | ShopItem): string {
    const g = this.g!;
    switch (o.kind) {
      case 'tile': return tileHtml(g, o.tile, 'shop', false);
      case 'cell': return miniCell(o.cell);
      case 'power': return `<span class="sx-pw ${RARITY_CLS[POWERS[o.id].rarity]}">${POWERS[o.id].icon}</span>`;
      case 'program': return `<span class="sx-prog">${PROGRAMS[o.id].icon}${o.id === 'boostV' ? '<b>A</b>' : o.id === 'boostC' ? '<b>B</b>' : ''}</span>`;
      case 'upgrade': return `<span class="sx-up"><span class="tile">${o.letter}</span><b>⬆</b></span>`;
      default: {
        const mini = { tile: '<span class="tile">A</span><span class="tile">B</span><span class="tile">C</span>', cell: '<i class="mc b-MT"></i><i class="mc b-LD"></i><i class="mc b-LT"></i>',
          power: '<span>🤡</span><span>🎩</span><span>🃏</span>', program: '<span>💾</span><span>✨</span><span>🖊️</span>', upgrade: '<span class="tile">A</span><b>⬆</b>' }[o.of];
        return `<span class="sx-pack p-${o.of}"><b class="n">${o.size}</b><span class="mini">${mini}</span></span>`;
      }
    }
  }
  private offerDesc(o: Offer | ShopItem): string {
    switch (o.kind) {
      case 'tile': return `${esc(tileTitle(o.tile)).replace(/\n/g, '<br>')}<br><em>Ajoutée à votre sac.</em>`;
      case 'cell': return `${esc(cellInfo(o.cell))}<br><em>S’ajoute à la case de votre choix : un type remplace son type, une texture remplace sa texture, le reste est gardé.</em>`;
      case 'power': { const x = POWERS[o.id]; return `<b>${x.icon} ${esc(x.name)}</b> <small>(${x.rarity})</small><br>${esc(x.desc)}`; }
      case 'program': return `<b>${esc(PROGRAMS[o.id].name)}</b> : ${esc(PROGRAMS[o.id].desc)}`;
      case 'upgrade': return `Toutes vos tuiles ${o.letter} gagnent pour toujours leur valeur de départ : +${baseValue(o.letter)}.`;
      default: return `Ouvrez-le et choisissez un élément parmi ${o.size} (${packPrice(o.of, o.size)} $).`;
    }
  }

  // ---------- Actions en attente (paquet, case, programme) ----------
  private pendingHtml(): string {
    const g = this.g!;
    const pd = g.pending!;
    if (pd.type === 'cell') {
      return `<div class="sx-banner"><span>Touchez la case du plateau à améliorer avec :</span>${miniCell(pd.cell)}
        <button class="sx-btn small" data-a="skip">Renoncer</button></div>`;
    }
    if (pd.type === 'choose') {
      return `<div class="sx-modal"><div class="sx-card"><h2>${esc(pd.title)}</h2><p class="sx-hint">Choisissez-en un.</p>
        <div class="sx-offers">${pd.offers.map((o, i) => `<button class="sx-offer" data-a="offer" data-i="${i}">
          <div class="sx-item-icon">${this.offerIcon(o)}</div><b>${esc(this.offerName(o))}</b><small>${this.offerDesc(o)}</small></button>`).join('')}</div>
        <button class="sx-btn ghost" data-a="skip">Ne rien prendre</button></div></div>`;
    }
    const info = PROGRAMS[pd.id];
    const pool = pd.fromReserve ? g.players[g.pendingFor].rack : pd.drawn;
    const [min, max] = info.pick!;
    const letterGrid = pd.id === 'ecriture'
      ? `<div class="sx-letters">${[...AZ].map((l) => `<button class="tile ${this.progLetter === l ? 'selected' : ''}" data-a="prog-letter" data-l="${l}">${l}</button>`).join('')}</div>` : '';
    const n = this.progSel.length;
    return `<div class="sx-modal"><div class="sx-card"><h2>${info.icon} ${esc(info.name)}</h2><p>${esc(info.desc)}</p>
      <div class="rack sx-rack sx-prog-rack">${pool.filter((t) => t.l !== '#').map((t) => {
        const k = this.progSel.indexOf(t.id);
        return tileHtml(g, t, k >= 0 ? 'selected' : '').replace('<div ', `<div data-prog="${t.id}" title="${esc(tileTitle(t))}" `).replace('</div>', k >= 0 && max > 1 ? `<i class="ord">${k + 1}</i></div>` : '</div>');
      }).join('') || '<span class="sx-rack-note">Aucune tuile disponible</span>'}</div>
      ${letterGrid}
      <div class="sx-card-btns"><button class="sx-btn gold" data-a="prog-ok" ${n >= Math.min(min, pool.length) && n <= max ? '' : 'disabled'}>Valider${n ? ` (${n})` : ''}</button></div></div></div>`;
  }

  private overHtml(): string {
    const g = this.g!;
    return `<div class="sx-modal"><div class="sx-card end"><h2>${g.mode === 'compet' ? 'Fin de partie' : 'Partie terminée'}</h2><p>${esc(g.overText ?? '')}</p>
      ${g.players.map((p) => `<p class="sx-hint">${esc(p.name)} : ${p.total} points, ${p.powers.length} pouvoir${p.powers.length > 1 ? 's' : ''}</p>`).join('')}
      <div class="sx-card-btns"><button class="sx-btn gold" data-a="restart">Nouvelle partie</button><button class="sx-btn" data-a="modes">Autre mode</button><button class="sx-btn" data-a="exit">Retour au Scrabble</button></div></div></div>`;
  }
  private wonHtml(): string {
    return `<div class="sx-modal"><div class="sx-card end won"><h2>🏆 Victoire !</h2><p>Vous avez validé le niveau ${LAST_LEVEL}.</p>
      <div class="sx-card-btns"><button class="sx-btn ghost" data-a="menu">☰</button><button class="sx-btn gold" data-a="continue">Continuer (niveaux sans fin)</button><button class="sx-btn" data-a="finish">Terminer la partie</button></div></div></div>`;
  }

  // ---------- Évènements ----------
  private onClick(e: MouseEvent) {
    if (this.dragMoved) { this.dragMoved = false; return; }
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-a]');
    const a = el?.dataset.a;
    const g = this.g;
    if (a === 'exit') return this.exit();
    if (a === 'mode') {
      const mode = el!.dataset.mode as Mode;
      if (mode === 'solo') return this.start('solo');
      const names = this.root.querySelector<HTMLElement>('.sx-names')!;
      names.hidden = false;
      names.dataset.mode = mode;
      names.querySelector('.sx-names-title')!.textContent = mode === 'coop' ? '🤝 Multijoueur coopératif' : '⚔️ Multijoueur compétitif';
      return;
    }
    if (a === 'start2') {
      const n1 = this.root.querySelector<HTMLInputElement>('#sxN1')!.value.trim() || 'Joueur 1';
      const n2 = this.root.querySelector<HTMLInputElement>('#sxN2')!.value.trim() || 'Joueur 2';
      return this.start(this.root.querySelector<HTMLElement>('.sx-names')!.dataset.mode as Mode, [n1, n2]);
    }
    if (a === 'host') {
      const n1 = this.root.querySelector<HTMLInputElement>('#sxN1')!.value.trim() || 'Joueur 1';
      const mode = this.root.querySelector<HTMLElement>('.sx-names')!.dataset.mode as 'coop' | 'compet';
      lsSet('scrabble-fr-nom', n1);
      this.hide();
      return this.deps.net.host(mode, n1);
    }
    if (a === 'resume') { this.g = loadScralatro(); this.resetUi(); lsSet(ACTIVE_KEY, '1'); return this.render(); }
    if (!g) return;
    if (a === 'menu') { this.menuOpen = true; return this.render(); }
    if (a === 'menu-close') { this.menuOpen = false; return this.render(); }
    if (a === 'abandon') return this.abandon();
    if (a === 'restart') return this.restart();
    if (a === 'modes') { this.save(); return this.menu(); }
    if (a === 'quit') { this.save(); return this.exit(); }
    if (a === 'ready') { this.shownPlayer = this.me; this.deps.sound.turn(); return this.render(); }
    if (a === 'continue') return void this.act({ k: 'continue' });
    if (a === 'finish') return void this.act({ k: 'finish' });
    if (a === 'level-info') {
      const lv = lvlOf(g, this.me);
      return this.say(lv.special ? `${SPECIALS[lv.special].letter} ${SPECIALS[lv.special].name} : ${SPECIALS[lv.special].desc}` : `Niveau ${lv.n} : ${lv.target} points à atteindre.`);
    }
    if (a === 'power') { const uid = Number(el!.dataset.uid); this.selPower = this.selPower === uid ? null : uid; return this.render(); }
    if (a === 'bag') return this.showBag();
    if (a === 'log') return this.showLog();
    if (a === 'close-modal') { this.root.querySelector('.sx-extra')?.remove(); return; }
    if (this.busy || !this.canAct()) {
      if (a || target.closest('.sx-board .cell, .tile[data-id]')) this.say(this.net && !this.canAct() && g.phase !== 'over' ? 'Ce n’est pas à vous : patientez.' : this.status, this.statusBad);
      return;
    }
    if (a === 'pmove' && this.selPower !== null) return void this.act({ k: 'move', uid: this.selPower, d: Number(el!.dataset.d) as -1 | 1 });
    if (a === 'sell' && this.selPower !== null) return this.sell();
    if (a === 'reserve') return this.reserve();
    // Magasin.
    if (a === 'item') { this.selItem = Number(el!.dataset.i); return this.render(); }
    if (a === 'buy' && this.selItem !== null) return this.buy(this.selItem);
    if (a === 'reroll') { this.selItem = null; return void this.act({ k: 'reroll' }); }
    if (a === 'leave') return this.leave();
    if (a === 'offer' && g.pending?.type === 'choose') {
      this.progSel = []; this.progLetter = '';
      return void this.act({ k: 'offer', i: Number(el!.dataset.i) });
    }
    if (a === 'skip') return void this.act({ k: 'skip' });
    if (a === 'prog-letter') { this.progLetter = el!.dataset.l!; return this.render(); }
    if (a === 'prog-ok') return this.runProgram();
    const progTile = target.closest<HTMLElement>('[data-prog]');
    if (progTile && g.pending?.type === 'program') {
      const id = Number(progTile.dataset.prog);
      const max = PROGRAMS[g.pending.id].pick![1];
      const k = this.progSel.indexOf(id);
      if (k >= 0) this.progSel.splice(k, 1);
      else { if (this.progSel.length >= max) this.progSel.shift(); this.progSel.push(id); }
      return this.render();
    }
    // Plateau : pose d'une case achetée.
    const cell = target.closest<HTMLElement>('.sx-board .cell');
    if (cell && g.pending?.type === 'cell') return void this.act({ k: 'cell', r: Number(cell.dataset.r), c: Number(cell.dataset.c) });
    if (g.phase !== 'play') return;
    // Jeu.
    if (a === 'play') return void this.play();
    if (a === 'recall') { this.pend.clear(); return this.render(); }
    if (a === 'shuffle') {
      const free = this.rackOrder.filter((id) => !this.pend.has(id));
      for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
      this.rackOrder = [...free, ...this.rackOrder.filter((id) => this.pend.has(id))];
      this.deps.sound.shuffle();
      return this.render();
    }
    if (a === 'exch') { this.pend.clear(); this.exch = this.exch ? null : new Set(); this.say(this.exch ? 'Touchez les lettres à échanger.' : ''); return this.render(); }
    if (a === 'exch-ok') return void this.exchange();
    if (a === 'pass') return void this.pass();
    const tile = target.closest<HTMLElement>('.tile[data-id]');
    if (tile) return void this.onTile(Number(tile.dataset.id));
    if (cell && this.sel !== null) return void this.placeAt(this.sel, Number(cell.dataset.r), Number(cell.dataset.c));
  }

  private say(msg: string, bad = false) {
    this.status = msg;
    this.statusBad = bad;
    const el = this.root.querySelectorAll<HTMLElement>('.sx-status');
    el.forEach((x) => { x.textContent = msg; x.classList.toggle('bad', bad); });
  }

  private async onTile(id: number) {
    if (this.busy) return;
    if (this.exch) {
      const t = this.g!.players[this.me].rack.find((x) => x.id === id);
      if (t?.l === '#') return this.say('Une tuile verrou ne peut pas être échangée.', true);
      if (this.exch.has(id)) this.exch.delete(id); else this.exch.add(id);
      return this.render();
    }
    if (this.pend.has(id)) { this.pend.delete(id); this.sel = null; return this.render(); }
    this.sel = this.sel === id ? null : id;
    this.render();
  }

  private async placeAt(id: number, r: number, c: number) {
    const g = this.g!;
    const t = g.players[this.me].rack.find((x) => x.id === id);
    if (!t || g.board[r][c] || [...this.pend.values()].some((q) => q.r === r && q.c === c)) return;
    if (t.l === '#') return this.say('Une tuile verrou ne peut pas être jouée.', true);
    let as: string | undefined;
    if (t.l === '?') {
      const l = await this.pickLetter('Lettre du joker');
      if (!l) return;
      as = l;
    }
    this.pend.set(id, { r, c, as });
    this.sel = null;
    this.deps.sound.tiles(1, 0);
    this.render();
  }

  private pickLetter(title: string): Promise<string | null> {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'sx-modal sx-extra';
      box.innerHTML = `<div class="sx-card"><h2>${esc(title)}</h2><div class="sx-letters">${[...AZ].map((l) => `<button class="tile" data-l="${l}">${l}</button>`).join('')}</div>
        <button class="sx-btn ghost" data-l="">Annuler</button></div>`;
      box.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-l]');
        if (!b) return;
        e.stopPropagation();
        box.remove();
        resolve(b.dataset.l || null);
      });
      this.root.appendChild(box);
    });
  }
  private pickNumber(title: string, text: string): Promise<number> {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'sx-modal sx-extra';
      box.innerHTML = `<div class="sx-card"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="sx-letters">${Array.from({ length: 26 }, (_, i) => `<button class="tile" data-n="${i}">${i}</button>`).join('')}</div></div>`;
      box.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-n]');
        if (!b) return;
        e.stopPropagation();
        box.remove();
        resolve(Number(b.dataset.n));
      });
      this.root.appendChild(box);
    });
  }

  private reqs(): Req[] { return [...this.pend].map(([id, q]) => ({ id, ...q })); }

  private async updatePreview() {
    const tok = ++this.previewTok;
    const out = this.root.querySelector<HTMLElement>('#sxPreview');
    const g = this.g;
    if (!out || !g) return;
    if (g.phase !== 'play') { out.innerHTML = ''; return; }
    if (this.exch) { out.innerHTML = '<span class="muted">Mode échange</span>'; return; }
    if (!this.pend.size) {
      const p = g.players[this.me];
      const lv = lvlOf(g, this.me);
      const hints = [lv.special === 'rho' && p.rho !== undefined ? 'Ρ Tuile à jouer : celle entourée en rouge.' : '',
        has(g, this.me, 'idole') ? `🌟 Voyelle de l’idole : ${p.idole}` : ''].filter(Boolean).join(' · ');
      out.innerHTML = `<span class="muted">${hints || 'Glissez vos lettres sur le plateau, ou touchez une lettre puis une case.'}</span>`;
      return;
    }
    const reqs = this.reqs();
    const geo = geometry(g, this.me, reqs);
    if (!geo.ok) { out.innerHTML = `<span class="bad">${esc(geo.error)}</span>`; return; }
    out.innerHTML = `<span class="words">${geo.words.map((w) => w.word).join(' · ')}</span><span class="muted">…</span>`;
    const v = await validate(g, this.me, geo.words, this.deps.lex);
    if (tok !== this.previewTok || g !== this.g) return;
    if (!v.ok) {
      out.innerHTML = `<span class="words">${geo.words.map((w) => (v.invalid.includes(w.word) ? `<s class="bad">${w.word}</s>` : w.word)).join(' · ')}</span><span class="bad">absent du dictionnaire</span>`;
      return;
    }
    const res = previewScore(g, this.me, reqs, v.infos);
    const random = reqs.some((q) => { const t = g.players[this.me].rack.find((x) => x.id === q.id); return t?.font === 'casino'; })
      || v.infos.some((w) => w.cells.some(([r, c]) => g.board[r][c]?.font === 'casino'));
    out.innerHTML = `<span class="words">${v.infos.map((w) => `${w.word}${w.via ? ` <small>(${esc(w.via)})</small>` : ''}`).join(' · ')}</span><span class="score">${random ? '≈ ' : ''}${res.score} pts</span>`;
  }

  // ---------- Jouer ----------
  private async play() {
    const g = this.g!;
    if (this.busy || !this.pend.size || !this.canAct()) return;
    const pi = this.me;
    const reqs = this.reqs();
    const geo = geometry(g, pi, reqs);
    if (!geo.ok) { this.deps.sound.invalid(); return this.say(geo.error, true); }
    this.busy = true;
    try {
      // En ligne, le serveur vérifie les mots avec la liste de la partie.
      if (!this.net) {
        const v = await validate(g, pi, geo.words, this.deps.lex);
        if (!v.ok) { this.deps.sound.invalid(); return this.say(`Mot${v.invalid.length > 1 ? 's' : ''} absent${v.invalid.length > 1 ? 's' : ''} du dictionnaire : ${v.invalid.join(', ')}`, true); }
      }
      const p = g.players[pi];
      let crypto: number | null = null;
      if (has(g, pi, 'cryptographe') && p.crypto === null && !p.played) {
        crypto = await this.pickNumber('🔐 Le cryptographe', 'Choisissez le décalage des lettres marquantes pour ce niveau (0 : aucun).');
      }
      const sent = { k: 'play' as const, reqs, crypto };
      const ok = await this.act(sent);
      if (ok && !this.net) { this.pend.clear(); this.sel = null; }
    } finally {
      if (!this.net) this.busy = false;
      if (this.g === g) this.render();
    }
  }

  private async pass() {
    if (this.busy || !this.canAct()) return;
    if (!confirm('Passer votre tour ? Cela consomme un coup.')) return;
    this.pend.clear();
    await this.act({ k: 'pass' });
  }

  private async exchange() {
    if (this.busy || !this.exch || !this.canAct()) return;
    const ids = [...this.exch];
    this.exch = null;
    await this.act({ k: 'exchange', ids });
  }

  /** Après un tour : niveau réussi, fin de partie, ou tour suivant. */
  private async afterTurn(end: TurnEnd) {
    const g = this.g!;
    if (end.cleared) await this.notice('Plateau vidé', `Les deux joueurs ont passé ou échangé : les tuiles retournent dans les sacs. ${g.clears}/2 — au troisième, la partie s’arrête.`);
    if (end.levelDone) {
      const d = end.levelDone;
      this.deps.sound.end(true);
      const rect = this.root.querySelector('.sx-board')?.getBoundingClientRect();
      if (rect) this.deps.fx.confetti(rect);
      await this.notice(`${g.players.length > 1 && g.mode === 'compet' ? `${g.players[d.player].name} : n` : 'N'}iveau réussi !`,
        `<ul class="sx-reward">${d.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="sx-total-reward">${d.reward >= 0 ? '+' : ''}${d.reward} $</p>`, true);
    }
    if (end.over) this.deps.sound.end(g.mode === 'compet');
    this.selItem = null;
  }

  private notice(title: string, body: string, html = false): Promise<void> {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'sx-modal sx-extra';
      box.innerHTML = `<div class="sx-card"><h2>${esc(title)}</h2>${html ? body : `<p>${esc(body)}</p>`}<div class="sx-card-btns"><button class="sx-btn gold">Continuer</button></div></div>`;
      box.querySelector('button')!.addEventListener('click', (e) => { e.stopPropagation(); box.remove(); resolve(); });
      this.root.appendChild(box);
    });
  }

  /** Décompte du coup : lignes de calcul une à une, puis le total. */
  private async showBreakdown(res: MoveResult, end: TurnEnd) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const box = document.createElement('div');
    box.className = 'sx-count';
    box.innerHTML = '<ul></ul><div class="sx-count-total"></div>';
    this.root.appendChild(box);
    let skip = false;
    box.addEventListener('click', () => { skip = true; });
    const ul = box.querySelector('ul')!;
    const lines = [...res.lines.filter((l) => l.cls !== 'total'), ...end.lines.map((text) => ({ text, cls: 'info' as const }))];
    for (let i = 0; i < lines.length; i++) {
      const li = document.createElement('li');
      li.className = lines[i].cls ?? '';
      li.textContent = lines[i].text;
      ul.appendChild(li);
      if (!skip && !reduced) { this.deps.sound.tick(i); await delay(lines[i].cls === 'word' ? 380 : 260); }
    }
    const tot = box.querySelector<HTMLElement>('.sx-count-total')!;
    const score = res.score + end.extra;
    if (res.bingo) this.deps.sound.bingo(); else this.deps.sound.total(score);
    await new Promise<void>((done) => this.deps.fx.tween(0, res.score, skip || reduced ? 0 : 500, (v) => { tot.textContent = `${v}`; }, done));
    if (end.extra) tot.textContent = `${res.score} ${end.extra > 0 ? '+' : '−'} ${Math.abs(end.extra)}`;
    tot.classList.add('pop');
    const board = this.root.querySelector<HTMLElement>('.sx-board');
    if (board && res.score > 0) this.deps.fx.float(`+${res.score}`, board.getBoundingClientRect(), 'total big');
    await Promise.race([delay(skip || reduced ? 500 : 1500), new Promise((r) => box.addEventListener('click', r, { once: true }))]);
    box.remove();
  }

  // ---------- Pouvoirs, réserve, magasin ----------
  private sell() {
    const g = this.g!;
    const uid = this.selPower!;
    const x = g.players[this.me].powers.find((y) => y.uid === uid);
    if (!x || !confirm(`Vendre ${POWERS[x.id].name} pour ${Math.max(1, Math.floor(x.price / 2))} $ ?`)) return;
    this.selPower = null;
    void this.act({ k: 'sell', uid });
  }
  private reserve() {
    if (this.busy || !this.canAct()) return;
    this.pend.clear();
    this.progSel = []; this.progLetter = '';
    void this.act({ k: 'reserve' });
  }
  private buy(i: number) {
    this.selItem = null;
    this.progSel = []; this.progLetter = '';
    void this.act({ k: 'buy', i });
  }
  private runProgram() {
    const ids = this.progSel, letter = this.progLetter || undefined;
    void this.act(letter ? { k: 'program', ids, letter } : { k: 'program', ids }).then((ok) => {
      if (ok) { this.progSel = []; this.progLetter = ''; }
    });
  }
  private leave() {
    this.selItem = null; this.selPower = null; this.pend.clear(); this.exch = null;
    void this.act({ k: 'leave' });
  }

  /** Abandon : la partie s'arrête (en ligne, pour les deux joueurs). */
  private abandon() {
    const g = this.g!;
    if (!confirm(this.net ? 'Abandonner la partie ? Elle s’arrête aussi pour votre partenaire.' : 'Abandonner la partie en cours ?')) return;
    this.menuOpen = false;
    if (g.phase === 'over') return this.render();
    void this.act({ k: 'abandon' });
  }
  /** Nouvelle partie dans le même mode (mêmes joueurs). */
  private restart() {
    const g = this.g!;
    const live = g.phase !== 'over';
    if (this.net) {
      if (live && !confirm('Recommencer une nouvelle partie ? La partie en cours s’arrête aussi pour votre partenaire.')) return;
      this.menuOpen = false;
      this.busy = true;
      this.net.send({ type: 'sx-restart' });
      return this.render();
    }
    if (live && !confirm('Abandonner la partie en cours et en recommencer une ?')) return;
    this.start(g.mode, g.players.map((p) => p.name), false);
  }

  private showBag() {
    const g = this.g!;
    const p = g.players[this.me];
    const all = [...p.bag, ...p.rack];
    const special = all.filter((t) => t.tex || t.ed || t.font || t.pas.length || t.sty.length || t.bonus || t.l === '#');
    const counts = new Map<string, number>();
    for (const t of p.bag) counts.set(t.l, (counts.get(t.l) ?? 0) + 1);
    const ups = Object.entries(p.up).filter(([, v]) => v);
    const box = document.createElement('div');
    box.className = 'sx-modal sx-extra';
    box.innerHTML = `<div class="sx-card wide"><h2>${g.players.length > 1 ? `Sac de ${esc(p.name)}` : 'Votre sac'}</h2>
      <p class="sx-hint">${plural(p.bag.length, 'tuile')} dans le sac, ${plural(all.length, 'tuile')} en tout (hors plateau).</p>
      <div class="sx-bag-counts">${[...counts].sort().map(([l, n]) => `<span><b>${l === '?' ? 'Joker' : l === '#' ? '🔒' : l}</b>${n}</span>`).join('')}</div>
      ${ups.length ? `<p class="sx-hint">Améliorations : ${ups.map(([l, v]) => `${l} +${v}`).join(', ')}</p>` : ''}
      <h3>Tuiles spéciales</h3>
      <div class="sx-bag-special">${special.map((t) => tileHtml(g, t, '', false).replace('<div ', `<div title="${esc(tileTitle(t))}" `)).join('') || '<span class="sx-hint">Aucune pour l’instant.</span>'}</div>
      <div class="sx-card-btns"><button class="sx-btn gold" data-a="close-modal">Fermer</button></div></div>`;
    this.root.appendChild(box);
  }
  private showLog() {
    const g = this.g!;
    const box = document.createElement('div');
    box.className = 'sx-modal sx-extra';
    box.innerHTML = `<div class="sx-card wide"><h2>Journal</h2><ol class="sx-log">${[...g.log].reverse().map((e) => `<li class="${e.kind ?? ''} pc-${e.p}">
      ${g.players.length > 1 ? `<b>${esc(g.players[e.p]?.name ?? '')}</b> ` : ''}${esc(e.text)}${e.score !== undefined ? ` <span class="sc">+${e.score}</span>` : ''}</li>`).join('')}</ol>
      <div class="sx-card-btns"><button class="sx-btn gold" data-a="close-modal">Fermer</button></div></div>`;
    this.root.appendChild(box);
  }

  // ---------- Glisser-déposer ----------
  private dragMoved = false;
  private bindDrag() {
    let drag: { id: number; x: number; y: number; ghost: HTMLElement | null; src: HTMLElement } | null = null;
    this.root.addEventListener('pointerdown', (e) => {
      const g = this.g;
      if (!g || g.phase !== 'play' || this.busy || this.exch || g.pending || !this.canAct()) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('.tile[data-id]');
      if (!el || !el.closest('.sx-rack, .sx-board')) return;
      drag = { id: Number(el.dataset.id), x: e.clientX, y: e.clientY, ghost: null, src: el };
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
        const r = drag.src.getBoundingClientRect();
        drag.ghost = drag.src.cloneNode(true) as HTMLElement;
        drag.ghost.classList.add('ghost');
        drag.ghost.style.width = `${Math.max(40, r.width)}px`;
        drag.ghost.style.height = `${Math.max(40, r.height)}px`;
        document.body.appendChild(drag.ghost);
        drag.src.classList.add('dragging');
      }
      drag.ghost.style.transform = `translate(${e.clientX - 22}px, ${e.clientY - 44}px)`;
      document.querySelectorAll('.sx-board .cell.drop').forEach((c) => c.classList.remove('drop'));
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sx-board .cell');
      under?.classList.add('drop');
    });
    window.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      if (!d?.ghost) return;
      d.ghost.remove();
      d.src.classList.remove('dragging');
      this.dragMoved = true;
      setTimeout(() => { this.dragMoved = false; }, 0);
      document.querySelectorAll('.sx-board .cell.drop').forEach((c) => c.classList.remove('drop'));
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const cell = under?.closest<HTMLElement>('.sx-board .cell');
      if (cell) {
        const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
        const prev = this.pend.get(d.id);
        if (prev) this.pend.delete(d.id);
        if (this.g!.board[r][c] || [...this.pend.values()].some((q) => q.r === r && q.c === c)) { if (prev) this.pend.set(d.id, prev); return this.render(); }
        if (prev) { this.pend.set(d.id, { r, c, as: prev.as }); this.deps.sound.tiles(1, 0); return this.render(); }
        return void this.placeAt(d.id, r, c);
      }
      if (under?.closest('.sx-rack')) {
        this.pend.delete(d.id);
        // Réordonne le chevalet selon la position du dépôt.
        const tiles = [...this.root.querySelectorAll<HTMLElement>('.sx-rack .tile[data-id]')].filter((t) => Number(t.dataset.id) !== d.id);
        const after = tiles.find((t) => { const b = t.getBoundingClientRect(); return e.clientX < b.left + b.width / 2; });
        this.rackOrder = this.rackOrder.filter((id) => id !== d.id);
        const at = after ? this.rackOrder.indexOf(Number(after.dataset.id)) : this.rackOrder.length;
        this.rackOrder.splice(at < 0 ? this.rackOrder.length : at, 0, d.id);
      }
      this.render();
    });
  }

  /** Début de tour après rechargement (sécurité si une sauvegarde n'a pas d'effets de début de tour). */
  ensureTurn() { if (this.g?.phase === 'play' && this.g.players[this.g.cur].idole === undefined) beginTurn(this.g); }
}
