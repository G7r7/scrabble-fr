import { BLANK, BONUS, CENTER, RACK_SIZE, SIZE, letterValue } from '../game/constants';
import { evaluatePlacement } from '../game/rules';
import { shuffle } from '../game/bag';
import {
  AI, HUMAN, exchange, loadGame, newGame, pass, playMove, saveGame, winnerText, type GameState,
} from '../game/game';
import type { Placement } from '../game/types';
import type { Level } from '../ai/player';
import { Engine } from '../engine';
import { clearOds, loadOds, saveOds } from '../dict/store';
import { normalizeWord } from '../dict/normalize.js';

interface RackTile { id: number; letter: string }
interface PendingTile extends RackTile { r: number; c: number; assigned: string }
interface DictInfo { source: 'libre' | 'ods'; count: number; name: string }

const BONUS_LABEL: Record<string, string> = { MT: 'Mot<br>×3', MD: 'Mot<br>×2', LT: 'Lettre<br>×3', LD: 'Lettre<br>×2' };
const LEVELS: Level[] = ['facile', 'moyen', 'difficile'];
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
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

  private el = {} as Record<
    'board' | 'rack' | 'preview' | 'scores' | 'bag' | 'history' | 'actions' | 'dict' | 'status' | 'level',
    HTMLElement
  >;

  constructor(private root: HTMLElement) {}

  async start() {
    this.root.innerHTML = TEMPLATE;
    for (const k of ['board', 'rack', 'preview', 'scores', 'bag', 'history', 'actions', 'dict', 'status', 'level'] as const) {
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
    this.syncRack();
    this.render();
    if (this.game.current === AI && !this.game.over) void this.aiTurn();
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
    if (this.busy) return;
    if (!this.game.over && this.game.history.length > 0 && !confirm('Abandonner la partie en cours ?')) return;
    this.game = newGame((this.el.level as HTMLSelectElement).value as Level);
    this.pending = [];
    this.tiles = [];
    this.exchangeMode = false;
    this.selected = null;
    $(this.root, '#endDialog').classList.remove('open');
    this.afterTurn();
  }

  /** Aligne les tuiles affichées sur le chevalet réel, en conservant l'ordre choisi par le joueur. */
  private syncRack() {
    const rack = [...this.game.players[HUMAN].rack];
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
    return !this.busy && !this.game.over && this.game.current === HUMAN;
  }

  private async play() {
    if (!this.canAct() || !this.pending.length) return;
    const ps = this.placements();
    const res = evaluatePlacement(this.game.board, ps);
    if (!res.ok) return this.setStatus(res.error, true);
    const invalid = await this.engine.invalidWords(res.words.map((w) => w.word));
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
    this.tiles = this.tiles.filter((t) => !this.exchangeSel.has(t.id));
    exchange(this.game, letters);
    this.exchangeMode = false;
    this.exchangeSel.clear();
    this.setStatus(`Vous échangez ${letters.length} lettre${letters.length > 1 ? 's' : ''}.`);
    this.afterTurn();
  }

  private afterTurn() {
    saveGame(this.game);
    this.syncRack();
    this.render();
    if (this.game.over) return this.showEnd();
    if (this.game.current === AI) void this.aiTurn();
  }

  private async aiTurn() {
    this.busy = true;
    this.render();
    try {
      const g = this.game;
      const [d] = await Promise.all([
        this.engine.aiMove(g.board, g.players[AI].rack, g.bag.length, g.level),
        delay(700),
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
    $(d, '#endTitle').textContent = winnerText(this.game);
    const [h, a] = this.game.players;
    $(d, '#endDetail').textContent =
      `Lettres restantes — vous : ${h.rack.join(' ') || 'aucune'} · ordinateur : ${a.rack.join(' ') || 'aucune'}`;
    d.classList.add('open');
  }

  // ---------- Tuiles ----------

  private async placeTile(id: number, r: number, c: number) {
    if (!this.canAct() || this.exchangeMode) return;
    if (this.game.board[r][c] || this.pending.some((p) => p.r === r && p.c === c)) return;
    const onBoard = this.pending.find((p) => p.id === id);
    if (onBoard) {
      onBoard.r = r; onBoard.c = c;
    } else {
      const i = this.tiles.findIndex((t) => t.id === id);
      if (i < 0) return;
      const t = this.tiles[i];
      let assigned = t.letter;
      if (t.letter === BLANK) {
        const chosen = await this.pickBlankLetter();
        if (!chosen) return;
        assigned = chosen;
      }
      this.tiles.splice(i, 1);
      this.pending.push({ ...t, r, c, assigned });
    }
    this.selected = null;
    this.render();
  }

  private returnTile(id: number, beforeId?: number) {
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
    const at = beforeId === undefined ? -1 : this.tiles.findIndex((t) => t.id === beforeId);
    if (at < 0) this.tiles.push(tile);
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
      else if (a === 'recall') { this.recallAll(); this.render(); }
      else if (a === 'shuffle') { shuffle(this.tiles); this.render(); }
      else if (a === 'exchange') this.toggleExchange();
      else if (a === 'confirm-exchange') this.confirmExchange();
      else if (a === 'pass') this.doPass();
    });
    $(this.root, '#newGame').addEventListener('click', () => this.startNewGame());
    $(this.root, '#endNew').addEventListener('click', () => this.startNewGame());
    $(this.root, '#endClose').addEventListener('click', () => $(this.root, '#endDialog').classList.remove('open'));
    this.el.level.addEventListener('change', () => {
      const l = (this.el.level as HTMLSelectElement).value as Level;
      try { localStorage.setItem('scrabble-fr-niveau', l); } catch { /* rien */ }
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

  private bindDrag() {
    type Drag = { id: number; x: number; y: number; src: HTMLElement; ghost: HTMLElement | null; pointer: number };
    let drag: Drag | null = null;

    this.root.addEventListener('pointerdown', (e) => {
      const tileEl = (e.target as HTMLElement).closest<HTMLElement>('.tile[data-id]');
      if (!tileEl || e.button > 0) return;
      drag = { id: +tileEl.dataset.id!, x: e.clientX, y: e.clientY, src: tileEl, ghost: null, pointer: e.pointerId };
      tileEl.setPointerCapture(e.pointerId);
    });

    this.root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        if (!this.canAct() || this.exchangeMode) return;
        const r = drag.src.getBoundingClientRect();
        const size = Math.max(r.width, 40);
        drag.ghost = drag.src.cloneNode(true) as HTMLElement;
        drag.ghost.classList.add('ghost');
        drag.ghost.style.width = drag.ghost.style.height = `${size}px`;
        document.body.appendChild(drag.ghost);
        drag.src.classList.add('dragging');
      }
      const s = drag.ghost.offsetWidth;
      drag.ghost.style.transform = `translate(${e.clientX - s / 2}px, ${e.clientY - s * 0.9}px)`;
      this.highlightDrop(e.clientX, e.clientY);
    });

    const end = (e: PointerEvent, cancelled = false) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const d = drag;
      drag = null;
      this.highlightDrop(-1, -1);
      if (!d.ghost) {
        if (!cancelled) this.onTileClick(d.id);
        return;
      }
      d.ghost.remove();
      d.src.classList.remove('dragging');
      if (cancelled) return this.render();
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const cell = target?.closest<HTMLElement>('.cell');
      if (cell) return void this.placeTile(d.id, +cell.dataset.r!, +cell.dataset.c!);
      if (target?.closest('#rack')) {
        const before = target.closest<HTMLElement>('#rack .tile[data-id]');
        const beforeId = before ? +before.dataset.id! : undefined;
        return this.returnTile(d.id, beforeId === d.id ? undefined : beforeId);
      }
      this.render();
    };
    this.root.addEventListener('pointerup', (e) => end(e));
    this.root.addEventListener('pointercancel', (e) => end(e, true));

    this.el.board.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell');
      if (!cell || cell.querySelector('.tile')) return;
      if (this.selected !== null) void this.placeTile(this.selected, +cell.dataset.r!, +cell.dataset.c!);
    });
  }

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
      .join('') + '<div class="rack-spacer"></div>';
    this.el.rack.classList.toggle('exchange', this.exchangeMode);

    const [h, a] = g.players;
    const turn = (i: number) => (!g.over && g.current === i ? 'turn' : '');
    this.el.scores.innerHTML = `
      <div class="player ${turn(HUMAN)}"><span class="name">Vous</span><span class="pts">${h.score}</span></div>
      <div class="player ${turn(AI)}"><span class="name">Ordinateur${this.busy ? ' <i class="thinking">réfléchit</i>' : ''}</span><span class="pts">${a.score}</span></div>`;
    this.el.bag.textContent = `${g.bag.length} jeton${g.bag.length > 1 ? 's' : ''} dans le sac`;

    this.el.history.innerHTML = g.history.length
      ? [...g.history].reverse().map((e) => `<li class="${e.player === HUMAN ? 'me' : 'ai'} k-${e.kind}">
          <span class="who">${e.kind === 'end' ? '' : e.player === HUMAN ? 'Vous' : 'Ordi'}</span>
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

    this.renderDict();
    void this.updatePreview();
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
    if (this.game.current !== HUMAN) { out.innerHTML = '<span class="muted">Au tour de l’ordinateur…</span>'; return setPlayable(false); }
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
        `<span class="bad">absent du dictionnaire</span>`;
      setPlayable(false);
    } else setPlayable(this.canAct());
  }

  private setStatus(msg: string, error = false) {
    this.el.status.textContent = msg;
    this.el.status.className = error ? 'bad' : '';
  }
}

const TEMPLATE = `
<header class="top">
  <h1>Scrabble <em>FR</em></h1>
  <div class="top-actions">
    <label class="level">Niveau
      <select id="level">
        <option value="facile">Facile</option>
        <option value="moyen">Moyen</option>
        <option value="difficile">Difficile</option>
      </select>
    </label>
    <button class="btn" id="newGame">Nouvelle partie</button>
  </div>
</header>
<main class="layout">
  <section class="play">
    <div id="board" class="board" aria-label="Plateau"></div>
    <div id="preview" class="preview" aria-live="polite"></div>
    <div id="rack" class="rack" aria-label="Chevalet"></div>
    <div id="actions" class="actions"></div>
    <p id="status" aria-live="polite"></p>
  </section>
  <aside class="side">
    <div id="scores" class="scores"></div>
    <p id="bag" class="bag"></p>
    <h2>Historique</h2>
    <ol id="history" class="history"></ol>
    <form id="dict" class="dict">
      <h2>Dictionnaire</h2>
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
  </aside>
</main>
<div id="loading" class="overlay open"><div class="card"><div class="spinner"></div><p>Chargement du dictionnaire…</p></div></div>
<div id="blankDialog" class="overlay"><div class="card">
  <h2>Lettre du joker</h2><div class="letters"></div>
  <button class="btn" data-cancel>Annuler</button>
</div></div>
<div id="endDialog" class="overlay"><div class="card">
  <h2 id="endTitle"></h2><p id="endDetail" class="muted"></p>
  <div class="row"><button class="btn primary" id="endNew">Nouvelle partie</button><button class="btn" id="endClose">Voir le plateau</button></div>
</div></div>
`;
