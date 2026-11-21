// Musique « classique » : orchestre de cathédrale, mystérieux et lumineux, composé à la volée.
// Rien n'est enregistré : un plan d'une dizaine de sections (≈ 18 minutes) est tiré au hasard — tonalités,
// modes anciens, enchaînements d'accords, instrumentation, mélodies —, puis un autre, et ainsi de suite :
// la musique ne se répète jamais à l'identique. Tout passe dans une longue réverbération de cathédrale.

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(l: readonly T[]): T => l[Math.floor(Math.random() * l.length)];

/** Modes : intervalles de la gamme depuis la tonique. */
const MODES = {
  eolien: [0, 2, 3, 5, 7, 8, 10],
  dorien: [0, 2, 3, 5, 7, 9, 10],
  phrygien: [0, 1, 3, 5, 7, 8, 10],
  ionien: [0, 2, 4, 5, 7, 9, 11],
} as const;
type Mode = keyof typeof MODES;

type Texture = 'mystere' | 'choeur' | 'cordes' | 'orgue' | 'tutti';
export interface Section { texture: Texture; root: number; mode: Mode; chords: number[][]; bars: number; peak: number }

/** Enchaînements d'accords (degrés de la gamme, 0 = tonique) : petite chaîne de Markov modale. */
const NEXT: Record<number, number[]> = {
  0: [3, 5, 4, 6, 2, 3, 5],
  1: [4, 6, 0],
  2: [5, 3, 0],
  3: [0, 4, 6, 1, 5],
  4: [0, 5, 3, 0],
  5: [3, 1, 4, 6, 2],
  6: [0, 2, 5, 3],
};

/** Accord sur le degré `deg` : notes de la gamme (fondamentale, tierce, quinte, parfois septième ou quarte suspendue). */
function chordOf(root: number, mode: Mode, deg: number, flavor: 'triade' | 'sept' | 'sus' | 'picardie'): number[] {
  const sc = MODES[mode];
  const at = (k: number) => root + sc[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7);
  if (flavor === 'picardie') return [root, root + 4, root + 7]; // accord majeur final : la lumière
  if (flavor === 'sus') return [at(0), at(3), at(4)];
  if (flavor === 'sept') return [at(0), at(2), at(4), at(6)];
  return [at(0), at(2), at(4)];
}

function makeSection(prev: Section | null, texture: Texture): Section {
  // Modulation lente : à la quinte, à la quarte, au relatif, ou on reste.
  let root = prev ? prev.root + pick([0, 0, 5, -5, 7, -7, 3, -3]) : pick([50, 52, 53, 55, 57]);
  while (root > 57) root -= 12;
  while (root < 45) root += 12;
  const mode: Mode = texture === 'tutti' ? pick(['dorien', 'eolien', 'ionien']) : pick(['eolien', 'eolien', 'dorien', 'phrygien', 'dorien']);
  const bars = texture === 'tutti' ? 16 : pick([20, 24, 24, 28]);
  const chords: number[][] = [];
  let deg = 0;
  for (let i = 0; i < bars; i++) {
    const end = i === bars - 1, beforeEnd = i === bars - 2;
    if (end) deg = 0; else if (beforeEnd) deg = pick([4, 3, 6]); else if (i > 0) deg = pick(NEXT[deg]);
    const flavor = end && Math.random() < 0.6 ? 'picardie' : Math.random() < 0.18 ? 'sus' : Math.random() < 0.3 ? 'sept' : 'triade';
    chords.push(chordOf(root, mode, deg, flavor));
  }
  return { texture, root, mode, chords, bars, peak: texture === 'tutti' ? 1 : rnd(0.55, 0.85) };
}

/** Plan d'environ 18 minutes : ouverture mystérieuse, puis des sections variées, deux sommets « tutti ». */
export function makePlan(prev: Section | null): Section[] {
  const order: Texture[] = ['mystere'];
  const pool: Texture[] = ['choeur', 'cordes', 'orgue', 'mystere', 'choeur', 'cordes', 'orgue'];
  while (order.length < 10) {
    const t = order.length === 5 || order.length === 9 ? 'tutti' : pick(pool.filter((x) => x !== order[order.length - 1]));
    order.push(t);
  }
  const plan: Section[] = [];
  for (const t of order) plan.push(makeSection(plan[plan.length - 1] ?? prev, t));
  return plan;
}

export class Cathedral {
  private bus: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private verb: ConvolverNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private plan: Section[] = [];
  private sec = 0;
  private bar = 0;
  private next = 0;
  /** Mélodie du soliste : hauteur courante (en midi). */
  private melody = 74;
  private static BEAT = 60 / 52;

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.32;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.85;
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(4);
    this.bus.connect(this.dry).connect(out);
    this.bus.connect(this.verb).connect(this.wet).connect(out);
  }

  /** Réponse impulsionnelle d'une grande nef : bruit stéréo qui décroît lentement, aigus amortis. */
  private impulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        lp += (Math.random() * 2 - 1 - lp) * (0.35 - 0.25 * (t / seconds)); // de plus en plus sourd
        d[i] = lp * Math.pow(1 - t / seconds, 2.2) * (t < 0.02 ? t / 0.02 : 1);
      }
    }
    return buf;
  }

  start() {
    if (this.timer) return;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(0.85, t + 4); // calé sur le volume du jazz
    if (!this.plan.length) { this.plan = makePlan(null); this.sec = 0; this.bar = 0; }
    this.next = t + 0.2;
    this.timer = setInterval(() => this.schedule(), 250);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(0, t + 1.5);
  }

  /** Programme les mesures à venir (2 s d'avance). */
  private schedule() {
    while (this.next < this.ctx.currentTime + 2) {
      let s = this.plan[this.sec];
      if (this.bar >= s.bars) {
        this.bar = 0;
        this.sec++;
        if (this.sec >= this.plan.length) { this.plan = makePlan(s); this.sec = 0; }
        s = this.plan[this.sec];
      }
      this.playBar(s, this.bar, this.next);
      this.bar++;
      this.next += Cathedral.BEAT * 4;
    }
  }

  /** Une mesure : l'accord est joué par les instruments de la section, avec une nuance en arche. */
  /** @internal (public pour les essais hors temps réel) */
  playBar(s: Section, i: number, t: number) {
    const B = Cathedral.BEAT, bar = B * 4;
    const chord = s.chords[i];
    const x = i / Math.max(1, s.bars - 1);
    // Arche : crescendo puis apaisement ; chaque texture est calée pour un volume d'ensemble homogène.
    const level = { mystere: 1.5, choeur: 1.4, cordes: 1.3, orgue: 1, tutti: 0.8 }[s.texture];
    const dyn = level * (0.35 + s.peak * 0.65 * Math.sin(Math.PI * Math.min(1, x * 1.1)));
    const first = i === 0, last = i === s.bars - 1;
    const len = last ? bar * 1.8 : bar * 1.05; // les accords se tuilent ; le dernier se prolonge
    const bass = chord[0] - 12;

    switch (s.texture) {
      case 'mystere':
        if (i % 2 === 0) this.drone(s.root - 12, t, bar * 2.1, 0.07 * dyn);
        this.pad(chord.map((n) => n + 12), t, len, 0.022 * dyn, 700);
        for (let k = 0; k < 4; k++) if (Math.random() < 0.7) this.harp(chord[k % chord.length] + 12 + (k > 2 ? 12 : 0), t + k * B * rnd(0.9, 1.1), 0.09 * dyn);
        if (Math.random() < 0.25) this.bell(pick(chord) + 24, t + B * pick([1, 2, 3]), 0.05);
        break;
      case 'choeur':
        this.choir(chord.map((n) => n + 12), t, len, 0.03 * dyn);
        this.bassNote(bass, t, len, 0.08 * dyn);
        if (i % 4 === 0 || Math.random() < 0.2) this.bell(chord[0] + 24, t, 0.06);
        if (Math.random() < 0.35) this.bell(pick(chord) + 36, t + B * 2.5, 0.03);
        break;
      case 'cordes':
        this.pad(chord, t, len, 0.03 * dyn, 1400);
        this.pad([chord[0] + 12, chord[chord.length - 1] + 12], t, len, 0.016 * dyn, 2200);
        this.bassNote(bass, t, len, 0.09 * dyn);
        this.soloBar(s, chord, t, 0.07 * dyn, last);
        break;
      case 'orgue':
        this.organ(chord, t, len, 0.05 * dyn);
        this.organ([bass], t, len, 0.07 * dyn);
        if (i % 2 === 1 && Math.random() < 0.6) {
          // Petite ligne de choral à la voix supérieure.
          this.organ([chord[chord.length - 1] + 12], t + B * 2, B * 2.1, 0.03 * dyn);
        }
        break;
      case 'tutti':
        this.pad(chord, t, len, 0.032 * dyn, 1800);
        this.choir(chord.map((n) => n + 12), t, len, 0.026 * dyn);
        this.organ([bass, chord[0]], t, len, 0.05 * dyn);
        this.bassNote(bass, t, len, 0.1 * dyn);
        if (first || last || i % 4 === 0) this.timpani(bass, t, 0.22 * dyn, last);
        if (i % 2 === 0) this.bell(chord[0] + 24, t, 0.05 * dyn);
        break;
    }
  }

  // ---------- Instruments ----------

  private voice(t: number, dur: number, vol: number, attack: number, release: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(this.bus);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, out: AudioNode, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.1);
    return o;
  }

  /** Cordes : deux dents de scie désaccordées, filtrées, à l'attaque lente. */
  private pad(notes: number[], t: number, dur: number, vol: number, bright: number) {
    for (const n of notes) {
      const g = this.voice(t, dur, vol, Math.min(1.8, dur * 0.35), Math.min(2, dur * 0.4));
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = bright;
      f.Q.value = 0.3;
      f.connect(g);
      this.osc('sawtooth', midi(n), t, dur, f, -7);
      this.osc('sawtooth', midi(n), t, dur, f, +7);
    }
  }

  /** Chœur « ah » : une dent de scie par note, passée dans trois formants en parallèle, léger vibrato. */
  private choir(notes: number[], t: number, dur: number, vol: number) {
    for (const n of notes) {
      const g = this.voice(t, dur, vol, Math.min(1.5, dur * 0.3), Math.min(2, dur * 0.4));
      const o = this.osc('sawtooth', midi(n), t, dur, g, rnd(-5, 5));
      o.disconnect();
      for (const [freq, q, amp] of [[730, 6, 1], [1100, 7, 0.6], [2600, 9, 0.25]] as const) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq;
        f.Q.value = q;
        const a = this.ctx.createGain();
        a.gain.value = amp * 3;
        o.connect(f).connect(a).connect(g);
      }
      const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      lfo.frequency.value = rnd(4.6, 5.4);
      lg.gain.value = 3;
      lfo.connect(lg).connect(o.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }
  }

  /** Orgue : jeux de fond 8', 4', quinte 2⅔' et 2' réunis dans une seule onde (un oscillateur par note). */
  private organWave: PeriodicWave | null = null;
  private organ(notes: number[], t: number, dur: number, vol: number) {
    this.organWave ??= this.ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.5, 0.22, 0.18]));
    for (const n of notes) {
      const g = this.voice(t, dur, vol * 1.6, 0.08, 0.5);
      const o = this.ctx.createOscillator();
      o.setPeriodicWave(this.organWave);
      o.frequency.value = midi(n);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private bassNote(n: number, t: number, dur: number, vol: number) {
    const g = this.voice(t, dur, vol, 0.6, 1);
    this.osc('triangle', midi(n), t, dur, g);
    this.osc('sine', midi(n + 12), t, dur, g);
  }

  private drone(n: number, t: number, dur: number, vol: number) {
    const g = this.voice(t, dur, vol, 2.5, 2.5);
    this.osc('sine', midi(n), t, dur, g);
    this.osc('sine', midi(n + 7), t, dur, g, 3);
  }

  /** Cloche : partiels inharmoniques qui s'éteignent lentement. */
  private bell(n: number, t: number, vol: number) {
    for (const [ratio, amp, decay] of [[1, 1, 5], [2, 0.5, 3.5], [2.76, 0.4, 2.5], [5.4, 0.2, 1.4]] as const) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * amp, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      g.connect(this.bus);
      this.osc('sine', midi(n) * ratio, t, decay, g);
    }
  }

  private harp(n: number, t: number, vol: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    g.connect(this.bus);
    this.osc('triangle', midi(n), t, 2.8, g);
    const h = this.ctx.createGain();
    h.gain.value = 0.3;
    h.connect(g);
    this.osc('sine', midi(n) * 2, t, 1.2, h);
  }

  private timpani(n: number, t: number, vol: number, roll: boolean) {
    const hits = roll ? 14 : 1;
    for (let k = 0; k < hits; k++) {
      const at = t + k * 0.07, v = roll ? vol * (0.3 + 0.7 * (k / hits)) : vol;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + (roll ? 0.5 : 2.2));
      g.connect(this.bus);
      const o = this.osc('sine', midi(n) * 1.02, at, 2.2, g);
      o.frequency.exponentialRampToValueAtTime(midi(n), at + 0.3);
    }
  }

  /** Soliste (hautbois) : phrase pas à pas sur la gamme, appuis sur les notes de l'accord, vibrato tardif. */
  private soloBar(s: Section, chord: number[], t: number, vol: number, last: boolean) {
    const B = Cathedral.BEAT;
    const scale: readonly number[] = MODES[s.mode];
    const inScale = (n: number) => scale.includes(((n - s.root) % 12 + 12) % 12);
    const tones = new Set(chord.map((n) => ((n % 12) + 12) % 12));
    // Rythme de la mesure : des valeurs longues, parfois une respiration.
    const rhythm = last ? [4] : pick([[2, 2], [1, 1, 2], [3, 1], [2, 1, 1], [4], [1.5, 0.5, 2]]);
    if (!last && Math.random() < 0.18) return; // silence : le soliste respire
    let at = t;
    for (const [k, d] of rhythm.entries()) {
      // Pas conjoint vers le haut ou le bas, ramené dans la tessiture ; appui sur une note de l'accord.
      let n = this.melody;
      for (let tries = 0; tries < 8; tries++) {
        const step = pick([-2, -1, -1, 1, 1, 2, -3, 3]);
        let c = this.melody + step;
        while (!inScale(c)) c += step > 0 ? 1 : -1;
        if (c < 67) c += 5;
        if (c > 84) c -= 5;
        n = c;
        if (k > 0 || tones.has(((c % 12) + 12) % 12)) break;
      }
      if (last) n = [...chord].map((x) => x + 24).reduce((a, b) => (Math.abs(b - this.melody) < Math.abs(a - this.melody) ? b : a));
      this.melody = n;
      this.oboe(n, at, d * B * 0.98, vol);
      at += d * B;
    }
  }

  private oboe(n: number, t: number, dur: number, vol: number) {
    const g = this.voice(t, dur + 0.3, vol, 0.12, 0.35);
    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 1300;
    f1.Q.value = 1.2;
    const f2 = this.ctx.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = 3200;
    f1.connect(f2).connect(g);
    const o = this.osc('sawtooth', midi(n), t, dur + 0.3, f1);
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 5.2;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(14, t + Math.min(0.8, dur)); // vibrato qui arrive après l'attaque
    lfo.connect(lg).connect(o.detune);
    lfo.start(t);
    lfo.stop(t + dur + 0.4);
  }
}
