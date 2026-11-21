// Écran de challenge : suspense (musique trépidante, projecteurs, roulement de tambour), noir complet,
// puis la réaction — trois variantes pour un mot valide, trois pour un mot refusé.
// Tous les sons sont synthétisés (Web SceneAudio), y compris les bruits de foule.
import type { Fx, Sound } from './fx';

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export type Verdict = 'valid' | 'invalid';

interface Reaction {
  title: string;
  /** Classe CSS de la mise en lumière. */
  look: string;
  /** Sons de la réaction, à partir de l'instant `t`. */
  sound: (a: SceneAudio, t: number) => void;
  /** Effet visuel en plus (confettis…). */
  extra?: (el: HTMLElement, fx: Fx) => void;
}

const REACTIONS: Record<Verdict, Reaction[]> = {
  valid: [
    { title: 'VALIDE !', look: 'r-green', sound: (a, t) => { a.fanfare(t); a.cheer(t + 0.1, 2.2); } },
    {
      title: 'IL EXISTE !', look: 'r-gold',
      sound: (a, t) => { a.chime(t); a.applause(t + 0.15, 2.4); a.oohAah(t + 0.1); },
      extra: (_el, fx) => fx.confetti(new DOMRect(0, innerHeight * 0.1, innerWidth, innerHeight * 0.6)),
    },
    { title: 'LE MOT TIENT BON !', look: 'r-stadium', sound: (a, t) => { a.airHorn(t); a.cheer(t + 0.2, 2.4); a.applause(t + 0.6, 1.8); } },
  ],
  invalid: [
    { title: 'REFUSÉ !', look: 'r-alarm', sound: (a, t) => { a.buzzer(t); a.boo(t + 0.25, 2.2); } },
    {
      title: 'DÉMASQUÉ !', look: 'r-shatter',
      sound: (a, t) => { a.shatter(t); a.gasp(t + 0.12); a.murmur(t + 0.8, 1.8); },
      extra: (el) => el.querySelector('.cs-word')?.classList.add('shatter'),
    },
    { title: 'BLUFF RATÉ !', look: 'r-wobble', sound: (a, t) => { a.sadTrombone(t); a.laugh(t + 0.9, 1.8); } },
  ],
};

/** Petit synthétiseur pour la scène : musique de suspense, percussions et foule. */
class SceneAudio {
  private noiseBuf: AudioBuffer;
  private bus: GainNode;
  constructor(private ctx: AudioContext, out: AudioNode) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(out);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  get now() { return this.ctx.currentTime + 0.02; }

  /** Coupe tout (fin de scène). */
  fadeOut(dur = 0.4) {
    const t = this.ctx.currentTime;
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(0, t + dur);
    setTimeout(() => this.bus.disconnect(), dur * 1000 + 100);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, hold: number, release: number) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0008, t + attack + hold + release);
  }

  osc(type: OscillatorType, freq: number, t: number, dur: number, vol: number, filter?: number, attack = 0.01) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    let node: AudioNode = o;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      node = o.connect(f);
    }
    node.connect(g).connect(this.bus);
    this.env(g, t, vol, attack, Math.max(0, dur - attack - 0.05), 0.12);
    o.start(t);
    o.stop(t + dur + 0.2);
    return o;
  }

  noise(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, attack = 0.005, release = 0.1) {
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.noiseBuf;
    src.loop = true;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(g).connect(this.bus);
    this.env(g, t, vol, attack, Math.max(0, dur - attack), release);
    src.start(t, Math.random());
    src.stop(t + dur + release + 0.1);
    return { src, f, g };
  }

  // ---------- Suspense ----------

  /** Musique trépidante : basse martelée en doubles croches, cordes en trémolo qui montent, timbales. */
  suspense(t: number, dur: number) {
    const bpm = 152, s16 = 60 / bpm / 4;
    const bass = [40, 40, 52, 40, 40, 51, 40, 50, 40, 40, 52, 40, 43, 42, 41, 40];
    const steps = Math.floor(dur / s16);
    for (let i = 0; i < steps; i++) {
      const at = t + i * s16;
      const k = i / steps; // de plus en plus fort et brillant
      this.osc('sawtooth', midi(bass[i % 16]), at, s16 * 0.8, 0.07 + k * 0.09, 300 + k * 900);
      if (i % 16 === 0) this.timpani(at, 0.25 + k * 0.2);
      if (i % 4 === 0) this.heartbeat(at, 0.18 + k * 0.15);
    }
    // Cordes : accord tenu en trémolo, qui monte d'un demi-ton à chaque mesure.
    const bar = s16 * 16;
    for (let b = 0; b * bar < dur; b++) {
      for (const n of [64, 67, 71]) {
        const at = t + b * bar, len = Math.min(bar, dur - b * bar);
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = midi(n + b);
        lfo.frequency.value = 13;
        lg.gain.value = 0.03;
        lfo.connect(lg).connect(g.gain);
        g.gain.setValueAtTime(0.02 + b * 0.012, at);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 2400;
        o.connect(f).connect(g).connect(this.bus);
        o.start(at); lfo.start(at);
        o.stop(at + len); lfo.stop(at + len);
      }
    }
    this.drumRoll(t + dur - 1.6, 1.6);
  }

  timpani(t: number, vol: number) {
    const o = this.osc('sine', 90, t, 0.6, vol);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.5);
    this.noise(t, 0.05, vol * 0.4, 'lowpass', 400);
  }
  heartbeat(t: number, vol: number) {
    for (const [dt, v] of [[0, vol], [0.16, vol * 0.7]] as const) {
      const o = this.osc('sine', 60, t + dt, 0.14, v);
      o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.12);
    }
  }
  /** Roulement de tambour qui s'accélère et enfle. */
  drumRoll(t: number, dur: number) {
    let at = t, gap = 0.07;
    while (at < t + dur) {
      const k = (at - t) / dur;
      this.noise(at, 0.03, 0.12 + k * 0.25, 'bandpass', 1800 + k * 800, 0.8);
      at += gap;
      gap = Math.max(0.025, gap * 0.95);
    }
  }

  // ---------- Réactions : mot valide ----------

  fanfare(t: number) {
    [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36], [72, 0.6]].forEach(([n, dt], i) => {
      for (const d of [0, 7]) this.osc('sawtooth', midi(n + (d ? 12 : 0)) * (d ? 1.003 : 1), t + dt, i === 4 ? 1.1 : 0.2, 0.08, 2600);
    });
  }
  chime(t: number) {
    [84, 88, 91, 96, 100].forEach((n, i) => this.osc('sine', midi(n), t + i * 0.06, 0.6, 0.12));
  }
  airHorn(t: number) {
    for (const [dt, len] of [[0, 0.25], [0.32, 0.25], [0.64, 0.7]]) {
      for (const f of [233, 466, 699]) this.osc('sawtooth', f, t + dt, len, 0.06, 3000, 0.02);
    }
  }
  /** Vivats : souffle de foule (bruit filtré) qui enfle, et quelques sifflets. */
  cheer(t: number, dur: number) {
    this.noise(t, dur, 0.35, 'bandpass', 900, 0.6, 0.35, 0.8);
    this.noise(t, dur, 0.2, 'bandpass', 2400, 0.8, 0.3, 0.8);
    for (let i = 0; i < 4; i++) {
      const at = t + 0.2 + Math.random() * dur * 0.6;
      const o = this.osc('sine', 1300, at, 0.45, 0.05);
      o.frequency.linearRampToValueAtTime(2100 + Math.random() * 400, at + 0.3);
    }
  }
  /** Applaudissements : une pluie de petits claquements. */
  applause(t: number, dur: number) {
    for (let at = t; at < t + dur; at += 0.012 + Math.random() * 0.02) {
      const k = Math.min(1, (t + dur - at) / 0.8);
      this.noise(at, 0.012, (0.06 + Math.random() * 0.08) * k, 'highpass', 1200 + Math.random() * 1500);
    }
  }
  /** « Ooooh… aaah ! » de la foule. */
  oohAah(t: number) {
    const a = this.noise(t, 0.9, 0.22, 'bandpass', 450, 3, 0.2, 0.3);
    a.f.frequency.linearRampToValueAtTime(900, t + 0.9);
  }

  // ---------- Réactions : mot refusé ----------

  buzzer(t: number) {
    for (const f of [110, 116, 220]) this.osc('square', f, t, 0.9, 0.06, 1400);
  }
  /** Huées : « ouuuh » grave qui descend. */
  boo(t: number, dur: number) {
    for (const base of [118, 131, 147, 165]) {
      const o = this.osc('sawtooth', base * (0.98 + Math.random() * 0.04), t + Math.random() * 0.15, dur, 0.035, 520, 0.3);
      o.frequency.linearRampToValueAtTime(base * 0.8, t + dur);
    }
    this.noise(t, dur, 0.15, 'lowpass', 600, 0.7, 0.3, 0.6);
  }
  shatter(t: number) {
    this.noise(t, 0.08, 0.6, 'highpass', 2500, 0.7, 0.002, 0.5);
    for (let i = 0; i < 14; i++) this.osc('sine', 2800 + Math.random() * 4500, t + Math.random() * 0.35, 0.12, 0.05);
  }
  /** Cri de surprise : la foule retient son souffle. */
  gasp(t: number) {
    const g = this.noise(t, 0.35, 0.35, 'bandpass', 1600, 1.2, 0.05, 0.5);
    g.f.frequency.linearRampToValueAtTime(2300, t + 0.3);
  }
  /** Brouhaha : murmures qui montent et descendent. */
  murmur(t: number, dur: number) {
    const m = this.noise(t, dur, 0.12, 'bandpass', 700, 1.5, 0.3, 0.6);
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 3.3;
    lg.gain.value = 0.06;
    lfo.connect(lg).connect(m.g.gain);
    lfo.start(t); lfo.stop(t + dur + 0.6);
  }
  sadTrombone(t: number) {
    [[58, 0, 0.35], [57, 0.4, 0.35], [56, 0.8, 0.35], [55, 1.2, 1.0]].forEach(([n, dt, len], i) => {
      const o = this.osc('sawtooth', midi(n), t + dt, len, 0.09, 900, 0.04);
      if (i === 3) {
        const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
        lfo.frequency.value = 6;
        lg.gain.value = 4;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t + dt); lfo.stop(t + dt + len + 0.2);
      }
    });
  }
  /** Rires : « ha ha ha » de plusieurs voix décalées. */
  laugh(t: number, dur: number) {
    for (let v = 0; v < 5; v++) {
      const rate = 0.13 + Math.random() * 0.06, f = 900 + Math.random() * 800;
      for (let at = t + Math.random() * 0.2; at < t + dur; at += rate) {
        const k = 1 - (at - t) / dur;
        this.noise(at, 0.06, 0.12 * k, 'bandpass', f, 4, 0.01, 0.06);
      }
    }
  }
}

export class ChallengeScene {
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(private sound: Sound, private fx: Fx) {}

  /** Durée totale (ms). */
  get duration() { return this.reduced ? 2200 : 6400; }

  /**
   * Joue la scène. `seed` choisit la variante de réaction (le même pour les deux joueurs en ligne),
   * `detail` : la conséquence (« … perd son tour »).
   */
  async play(verdict: Verdict, words: string[], detail: string, seed: number): Promise<void> {
    const r = REACTIONS[verdict][seed % REACTIONS[verdict].length];
    const el = document.createElement('div');
    el.className = 'cs';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <div class="cs-beam a"></div><div class="cs-beam b"></div><div class="cs-beam c"></div>
      <div class="cs-flash"></div>
      <div class="cs-center">
        <div class="cs-title">${[...'CHALLENGE !'].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')}</div>
        <div class="cs-word">${words.map((w) => `<span class="cs-w">${[...w].map((ch, i) =>
          `<b style="--i:${i};--rx:${(Math.random() - 0.5) * 300}px;--ry:${200 + Math.random() * 300}px;--rr:${(Math.random() - 0.5) * 540}deg">${esc(ch)}</b>`).join('')}</span>`).join('')}</div>
        <div class="cs-sub">Le dictionnaire délibère<span class="cs-dots"></span></div>
        <div class="cs-verdict"><div class="cs-big">${esc(r.title)}</div><div class="cs-detail">${esc(detail)}</div></div>
      </div>`;
    document.body.appendChild(el);
    const stage = this.sound.stage();
    const audio = stage ? new SceneAudio(stage.ctx, stage.out) : null;
    this.sound.duck(true);
    const suspense = this.reduced ? 0.9 : 3.6, black = this.reduced ? 0 : 0.45;
    if (audio) audio.suspense(audio.now, suspense);
    requestAnimationFrame(() => el.classList.add('in'));
    await wait(suspense * 1000 * 0.62);
    el.classList.add('tension');          // les projecteurs s'affolent
    await wait(suspense * 1000 * 0.38);
    el.classList.add('blackout');         // noir complet : une demi-seconde de silence
    await wait(black * 1000);
    el.classList.add('reveal', r.look, verdict);
    if (audio) r.sound(audio, audio.now);
    r.extra?.(el, this.fx);
    await wait(this.duration - (suspense + black) * 1000 - 450);
    el.classList.add('out');
    audio?.fadeOut(0.6);
    this.sound.duck(false);
    await wait(450);
    el.remove();
  }
}
