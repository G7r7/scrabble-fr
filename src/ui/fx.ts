// Effets sonores et animations. Tous les sons sont synthétisés (Web Audio) : aucun fichier à charger.
import { SIZE } from '../game/constants';
import type { FormedWord } from '../game/types';
import { Cathedral } from './cathedral';

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* rien */ } }

export type MusicMode = 'off' | 'jazz' | 'classique';

export class Sound {
  private ctx: AudioContext | null = null;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  sfxOn = lsGet('scrabble-fr-son') !== '0';
  /** Musique de fond : coupée, jazz (swing léger) ou classique (orchestre de cathédrale). */
  musicMode: MusicMode = (() => {
    const v = lsGet('scrabble-fr-musique');
    return v === '1' || v === 'jazz' ? 'jazz' : v === 'classique' ? 'classique' : 'off';
  })();
  get musicOn() { return this.musicMode !== 'off'; }
  /** Volume général (musique et effets), de 0 à 1. */
  volume = (() => { const v = Number(lsGet('scrabble-fr-volume')); return lsGet('scrabble-fr-volume') !== null && v >= 0 && v <= 1 ? v : 1; })();
  private masterGain!: GainNode;
  private music: Music | null = null;
  private cathedral: Cathedral | null = null;

  constructor() {
    // Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur.
    const unlock = () => {
      this.audio();
      if (this.musicOn) this.startMusic();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private audio(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      const master = this.ctx.createDynamicsCompressor();
      // Volume général après le compresseur : il règle tout, musique comme effets.
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.curve(this.volume);
      master.connect(this.masterGain).connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.5;
      this.sfxBus.connect(master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.16;
      this.musicBus.connect(master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Contexte audio et sortie des effets, si les sons sont activés (pour les scènes : challenge…). */
  stage(): { ctx: AudioContext; out: AudioNode } | null {
    if (!this.sfxOn) return null;
    const ctx = this.audio();
    return ctx ? { ctx, out: this.sfxBus } : null;
  }
  /** Baisse la musique de fond pendant une scène. */
  duck(on: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? 0.02 : 0.16, t + (on ? 0.3 : 1.2));
  }

  /** Courbe d'écoute : le curseur suit mieux l'oreille qu'une progression linéaire. */
  private curve(v: number) { return v * v; }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    lsSet('scrabble-fr-volume', String(this.volume));
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.masterGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.curve(this.volume), t + 0.05);
  }

  setSfx(on: boolean) { this.sfxOn = on; lsSet('scrabble-fr-son', on ? '1' : '0'); }
  setMusic(mode: MusicMode) {
    this.musicMode = mode;
    lsSet('scrabble-fr-musique', mode === 'off' ? '0' : mode);
    if (mode !== 'jazz') this.music?.stop();
    if (mode !== 'classique') this.cathedral?.stop();
    if (mode !== 'off') this.startMusic();
  }
  /** Bouton musique : coupée → jazz → classique → coupée. */
  cycleMusic(): MusicMode {
    const order: MusicMode[] = ['off', 'jazz', 'classique'];
    this.setMusic(order[(order.indexOf(this.musicMode) + 1) % order.length]);
    return this.musicMode;
  }
  private startMusic() {
    const ctx = this.audio();
    if (!ctx) return;
    if (this.musicMode === 'jazz') {
      this.music ??= new Music(ctx, this.musicBus);
      this.music.start();
    } else if (this.musicMode === 'classique') {
      this.cathedral ??= new Cathedral(ctx, this.musicBus);
      this.cathedral.start();
    }
  }

  /** Note simple avec enveloppe. */
  private tone(freq: number, at: number, dur: number, type: OscillatorType = 'triangle', vol = 0.5, out?: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(out ?? this.sfxBus);
    o.start(at);
    o.stop(at + dur + 0.05);
    return o;
  }

  /** Claquement de tuile en bois : bruit filtré + petit choc grave. */
  private clack(at: number, pitch = 1, vol = 0.6) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 * pitch;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(bp).connect(g).connect(this.sfxBus);
    src.start(at);
    this.tone(180 * pitch, at, 0.06, 'sine', vol * 0.5);
  }

  private now(): number | null {
    if (!this.sfxOn) return null;
    const ctx = this.audio();
    return ctx ? ctx.currentTime + 0.01 : null;
  }

  place() { const t = this.now(); if (t !== null) this.clack(t, 1); }
  pickup() { const t = this.now(); if (t !== null) this.clack(t, 1.5, 0.35); }
  /** Effleurement discret : les lettres du chevalet s'écartent. */
  slide() { const t = this.now(); if (t !== null) this.clack(t, 1.9, 0.12); }
  shuffle() {
    const t = this.now();
    if (t !== null) for (let i = 0; i < 5; i++) this.clack(t + i * 0.045 + Math.random() * 0.02, 1.2 + Math.random() * 0.5, 0.3);
  }
  /** Pose des lettres d'un coup, une par une. */
  tiles(n: number, step: number) {
    const t = this.now();
    if (t !== null) for (let i = 0; i < n; i++) this.clack(t + (i * step) / 1000, 0.95 + i * 0.03, 0.45);
  }
  /** Décompte : chaque mot monte d'un cran dans la gamme. */
  tick(i: number) {
    const t = this.now();
    if (t === null) return;
    const scale = [72, 74, 76, 79, 81, 84, 86, 88, 91];
    const n = scale[Math.min(i, scale.length - 1)];
    this.tone(midi(n), t, 0.25, 'triangle', 0.35);
    this.tone(midi(n + 12), t, 0.12, 'sine', 0.12);
  }
  total(score: number) {
    const t = this.now();
    if (t === null) return;
    const notes = score >= 30 ? [72, 76, 79, 84] : [76, 84];
    notes.forEach((n, i) => this.tone(midi(n), t + i * 0.07, 0.5, 'triangle', 0.3));
    // Petit scintillement de pièces pour les beaux coups.
    if (score >= 20) for (let i = 0; i < 6; i++) this.tone(midi(96 + (i % 3) * 3), t + 0.2 + i * 0.05, 0.1, 'sine', 0.08);
  }
  bingo() {
    const t = this.now();
    if (t === null) return;
    const fan = [60, 64, 67, 72, 67, 72, 76, 79, 84];
    fan.forEach((n, i) => {
      this.tone(midi(n), t + i * 0.09, i === fan.length - 1 ? 0.9 : 0.2, 'square', 0.12);
      this.tone(midi(n), t + i * 0.09, i === fan.length - 1 ? 0.9 : 0.2, 'triangle', 0.25);
    });
  }
  invalid() {
    const t = this.now();
    if (t === null) return;
    const o = this.tone(150, t, 0.25, 'sawtooth', 0.15);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
  }
  /** Mot du thème (mode fantasy) : pluie de notes cristallines. */
  sparkle() {
    const t = this.now();
    if (t === null) return;
    [88, 91, 95, 100, 103].forEach((n, i) => this.tone(midi(n), t + 0.05 + i * 0.05, 0.25, 'sine', 0.1));
  }
  /** Mot maléfique démasqué : grondement grave et accord dissonant qui descend. */
  evil() {
    const t = this.now();
    if (t === null) return;
    const o = this.tone(55, t, 1.2, 'sawtooth', 0.12);
    o.frequency.exponentialRampToValueAtTime(38, t + 1.1);
    for (const [n, dt] of [[63, 0], [64, 0.04], [70, 0.08]] as const) {
      const v = this.tone(midi(n), t + dt, 0.9, 'triangle', 0.1);
      v.frequency.exponentialRampToValueAtTime(midi(n - 3), t + 0.9);
    }
  }
  /** « CHALLENGE ! » : roulement de tambour puis coup de cymbale grave. */
  challenge() {
    const t = this.now();
    if (t === null) return;
    for (let i = 0; i < 8; i++) this.clack(t + i * 0.05, 0.6 + i * 0.05, 0.25 + i * 0.04);
    this.tone(midi(43), t + 0.42, 0.6, 'sawtooth', 0.18);
    this.tone(midi(50), t + 0.42, 0.6, 'square', 0.1);
  }
  /** Verdict du challenge : fanfare (gagné) ou trombone triste (raté). */
  verdict(win: boolean) {
    const t = this.now();
    if (t === null) return;
    const notes = win ? [67, 72, 76, 79] : [62, 61, 60, 55];
    notes.forEach((n, i) => this.tone(midi(n), t + i * (win ? 0.08 : 0.2), i === notes.length - 1 ? 0.6 : 0.2, win ? 'triangle' : 'sawtooth', win ? 0.3 : 0.14));
  }
  soft() { const t = this.now(); if (t !== null) this.tone(midi(67), t, 0.2, 'sine', 0.2); }
  turn() {
    const t = this.now();
    if (t === null) return;
    this.tone(midi(79), t, 0.35, 'sine', 0.25);
    this.tone(midi(84), t + 0.12, 0.5, 'sine', 0.25);
  }
  end(won: boolean) {
    const t = this.now();
    if (t === null) return;
    const notes = won ? [60, 64, 67, 72, 76, 79, 84] : [67, 63, 60, 55];
    notes.forEach((n, i) => this.tone(midi(n), t + i * (won ? 0.1 : 0.18), won && i === notes.length - 1 ? 1.2 : 0.35, 'triangle', 0.3));
  }
}

/**
 * Musique de fond : un petit ragtime original, en boucle (basse « oom-pah », accords, mélodie swinguée).
 * Planifiée avec un léger temps d'avance sur l'horloge audio, pour rester régulière.
 */
class Music {
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private step = 0;
  private bus: GainNode;
  private static BPM = 116;
  // Accords par demi-mesure : [basse fondamentale, quinte, notes de l'accord].
  private static CHORDS: Record<string, [number, number, number[]]> = {
    C6: [48, 55, [64, 67, 69, 72]], A7: [45, 52, [61, 64, 67, 69]], Dm7: [50, 45, [62, 65, 69, 72]],
    G7: [43, 50, [59, 62, 65, 67]], F6: [41, 48, [62, 65, 69, 72]], E7: [40, 47, [62, 64, 68, 71]],
  };
  private static PROG = [
    'C6', 'C6', 'A7', 'A7', 'Dm7', 'Dm7', 'G7', 'G7', 'C6', 'C6', 'A7', 'A7', 'Dm7', 'G7', 'C6', 'C6',
    'F6', 'F6', 'C6', 'C6', 'E7', 'E7', 'A7', 'A7', 'Dm7', 'Dm7', 'G7', 'G7', 'Dm7', 'G7', 'C6', 'G7',
  ];
  // Mélodie : 8 croches par mesure (null = silence).
  private static MELODY: (number | null)[] = [
    76, null, 79, null, 81, 79, 76, null, null, 73, 76, 79, 81, null, 79, null,
    77, null, 74, 77, 81, null, 77, null, 79, 77, 74, 71, 74, null, null, null,
    76, null, 79, null, 84, null, 81, 79, 76, null, 73, 76, 79, null, 76, null,
    77, 81, 77, 74, 79, 77, 74, 71, 72, null, 76, 79, 72, null, null, null,
    81, null, 77, 81, 84, null, 81, null, 79, null, 76, 79, 84, null, 79, null,
    80, null, 76, 80, 83, 81, 80, null, 81, null, 76, 79, 81, null, null, 79,
    77, null, 81, null, 77, 74, 77, null, 79, 77, 74, 71, 74, 76, 77, 79,
    81, 79, 77, 74, 79, null, 77, 74, 72, null, 76, null, 79, 74, 71, null,
  ];

  constructor(private ctx: AudioContext, out: GainNode) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
  }

  start() {
    if (this.timer) return;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(1, t + 1.5);
    this.next = t + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(0, t + 0.6);
  }

  private note(n: number, at: number, dur: number, type: OscillatorType, vol: number) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = midi(n);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(this.bus);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** Une croche à la fois ; swing : la croche « en l'air » est retardée. */
  private schedule() {
    const beat = 60 / Music.BPM;
    while (this.next < this.ctx.currentTime + 0.25) {
      const i = this.step % Music.MELODY.length;   // croche dans la boucle
      const eighth = i % 2;                        // 0 = sur le temps, 1 = en l'air
      const beatInBar = Math.floor(i / 2) % 4;
      const half = Math.floor(i / 4);              // demi-mesure
      const [root, fifth, chord] = Music.CHORDS[Music.PROG[half % Music.PROG.length]];
      const t = this.next;

      if (eighth === 0) {
        if (beatInBar % 2 === 0) this.note(beatInBar === 0 ? root : fifth, t, beat * 0.9, 'triangle', 0.55);
        else for (const n of chord) this.note(n, t, beat * 0.35, 'triangle', 0.09);
      }
      const m = Music.MELODY[i];
      if (m !== null) {
        this.note(m, t, beat * 0.55, 'square', 0.035);
        this.note(m, t, beat * 0.7, 'triangle', 0.14);
      }

      this.next += eighth === 0 ? beat * 0.62 : beat * 0.38;
      this.step++;
    }
  }
}

/** Animations du plateau : pose des lettres, décompte mot par mot, total. */
export class Fx {
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  static TILE_STEP = 70;
  static WORD_STEP = 420;

  constructor(private sound: Sound) {}

  /** Durée totale de l'animation d'un coup (ms), pour caler le compteur de points. */
  duration(tiles: number, words: number) {
    return this.reduced ? 0 : tiles * Fx.TILE_STEP + 150 + words * Fx.WORD_STEP;
  }

  private tileAt(board: HTMLElement, r: number, c: number) {
    return board.children[r * SIZE + c]?.querySelector<HTMLElement>('.tile') ?? null;
  }

  /** Texte flottant au-dessus d'une case ou du centre du plateau. */
  float(text: string, rect: DOMRect, cls = '') {
    const el = document.createElement('div');
    el.className = `fx-float ${cls}`;
    el.textContent = text;
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top}px`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 3000);
  }

  async countMove(board: HTMLElement, cells: [number, number][], words: FormedWord[], score: number) {
    const bingo = cells.length === 7;
    if (this.reduced) {
      if (bingo) this.sound.bingo(); else this.sound.total(score);
      return;
    }
    // 1. Les lettres tombent une à une.
    this.sound.tiles(cells.length, Fx.TILE_STEP);
    cells.forEach(([r, c], i) => {
      const t = this.tileAt(board, r, c);
      if (!t) return;
      t.style.animationDelay = `${i * Fx.TILE_STEP}ms`;
      t.classList.add('pop');
      t.addEventListener('animationend', () => { t.classList.remove('pop'); t.style.animationDelay = ''; }, { once: true });
    });
    await wait(cells.length * Fx.TILE_STEP + 150);

    // 2. Décompte : chaque mot s'illumine avec son score.
    let sum = 0;
    for (const [k, w] of words.entries()) {
      sum += w.score;
      const tiles = w.cells.map(([r, c]) => this.tileAt(board, r, c)).filter((t): t is HTMLElement => !!t);
      for (const t of tiles) t.classList.add('count');
      const [lr, lc] = w.cells[w.cells.length - 1];
      const last = this.tileAt(board, lr, lc);
      if (w.themed) for (const t of tiles) t.classList.add('themed');
      if (last) this.float(w.themed ? `✦ ${w.word} ×2 +${w.score}` : `${w.word} +${w.score}`, last.getBoundingClientRect(), w.themed ? 'word themed' : 'word');
      if (w.themed) this.sound.sparkle();
      this.sound.tick(k);
      await wait(Fx.WORD_STEP);
      for (const t of tiles) t.classList.remove('count');
    }

    // 3. Total (et prime de scrabble).
    const b = board.getBoundingClientRect();
    const center = new DOMRect(b.left, b.top + b.height * 0.42, b.width, 0);
    if (bingo) {
      this.float('Scrabble ! +50', new DOMRect(b.left, b.top + b.height * 0.3, b.width, 0), 'bingo');
      this.sound.bingo();
      this.confetti(b);
    } else this.sound.total(score);
    this.float(`+${score}`, center, sum >= 30 || bingo ? 'total big' : 'total');
  }

  /** Durée du tampon animé (ms). */
  get stampMs() { return this.reduced ? 900 : 1900; }

  /**
   * Grand tampon au centre de l'écran : le titre claque lettre par lettre, puis le verdict.
   * `kind` : win (challenge réussi), fail (challenge raté), bad (pénalité hardcore).
   */
  stamp(title: string, sub: string, kind: 'win' | 'fail' | 'bad'): Promise<void> {
    const el = document.createElement('div');
    el.className = `fx-stamp ${kind}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="fx-stamp-title">${[...title].map((ch, i) =>
      `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')}</div><div class="fx-stamp-sub">${sub}</div>`;
    document.body.appendChild(el);
    if (title.startsWith('CHALLENGE')) {
      this.sound.challenge();
      setTimeout(() => this.sound.verdict(kind === 'win'), this.reduced ? 0 : 750);
    } else this.sound.invalid();
    return new Promise((resolve) => setTimeout(() => { el.remove(); resolve(); }, this.stampMs));
  }

  confetti(b: DOMRect) {
    const colors = ['#d2493a', '#2f80c4', '#f2a5a0', '#9cc9ec', '#f1dcae', '#3fb394'];
    for (let i = 0; i < 40; i++) {
      const el = document.createElement('div');
      el.className = 'fx-confetti';
      el.style.left = `${b.left + Math.random() * b.width}px`;
      el.style.top = `${b.top + b.height * 0.3}px`;
      el.style.background = colors[i % colors.length];
      el.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
      el.style.setProperty('--dy', `${120 + Math.random() * 260}px`);
      el.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
      el.style.animationDelay = `${Math.random() * 150}ms`;
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
      setTimeout(() => el.remove(), 3000);
    }
  }

  /** Compteur qui défile de `from` à `to` ; `frame` reçoit chaque valeur, `done` est appelé à la fin. */
  tween(from: number, to: number, delay: number, frame: (v: number) => void, done: () => void) {
    if (from === to) { frame(to); return; }
    const dur = this.reduced ? 0 : 600;
    setTimeout(() => {
      const t0 = performance.now();
      const step = (now: number) => {
        const p = dur ? Math.min(1, (now - t0) / dur) : 1;
        frame(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
        if (p < 1) requestAnimationFrame(step);
        else if (to > from && !this.reduced) done();
      };
      requestAnimationFrame(step);
    }, this.reduced ? 0 : delay);
  }
}
