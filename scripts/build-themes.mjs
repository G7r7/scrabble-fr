// Construit src/game/themes.data.ts : mots des thèmes du mode fantasy présents dans l'une des listes du jeu,
// avec leurs pluriels (et formes en -S, -X, -AUX), et les formes conjuguées des verbes du thème.
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeWord } from '../src/dict/normalize.js';
import { JARGON, THEMES, VERBS } from './themes-src.mjs';

// Un mot du thème compte dès qu'une des listes le connaît : il ne sera joué que si la liste de la partie l'accepte.
const dict = new Set();
for (const f of ['fr-libre', 'fr-courant', 'fr-complet', 'fr-etendu']) {
  for (const w of readFileSync(new URL(`../public/dict/${f}.txt`, import.meta.url), 'utf8').split(/\r?\n/)) if (w) dict.add(w);
}

const SUFFIXES = ['', 'S', 'X'];

// Tous les temps simples (sans accents) : présent, imparfait, passé simple, futur, conditionnel, subjonctif présent
// et imparfait, participes.
const ER = ['ER', 'E', 'ES', 'ENT', 'ONS', 'EZ', 'AIS', 'AIT', 'IONS', 'IEZ', 'AIENT', 'AI', 'AS', 'A', 'AMES', 'ATES',
  'ERENT', 'ERAI', 'ERAS', 'ERA', 'ERONS', 'EREZ', 'ERONT', 'ERAIS', 'ERAIT', 'ERIONS', 'ERIEZ', 'ERAIENT', 'ASSE',
  'ASSES', 'AT', 'ASSIONS', 'ASSIEZ', 'ASSENT', 'ANT', 'EE', 'EES'];
const IR = ['IR', 'IS', 'IT', 'ISSONS', 'ISSEZ', 'ISSENT', 'ISSAIS', 'ISSAIT', 'ISSIONS', 'ISSIEZ', 'ISSAIENT', 'IMES',
  'ITES', 'IRENT', 'IRAI', 'IRAS', 'IRA', 'IRONS', 'IREZ', 'IRONT', 'IRAIS', 'IRAIT', 'IRIONS', 'IRIEZ', 'IRAIENT',
  'ISSE', 'ISSES', 'ISSANT', 'IE', 'IES'];

// Terminaisons devant lesquelles le radical change (il jette, il pagaie).
const MUTE = ['E', 'ES', 'ENT', 'ERAI', 'ERAS', 'ERA', 'ERONS', 'EREZ', 'ERONT', 'ERAIS', 'ERAIT', 'ERIONS', 'ERIEZ', 'ERAIENT'];

/**
 * Formes candidates d'un verbe du 1er ou du 2e groupe (les irréguliers sont écrits à la main).
 * `all` : verbe de jargon, toutes les formes régulières sont gardées sans consulter les listes.
 */
function conjugate(v, all = false) {
  const out = new Set([v]);
  const add = (stem, ends) => { for (const e of ends) out.add(stem + e); };
  if (v.endsWith('ER')) {
    const st = v.slice(0, -2);
    // nager → nageons, nageait
    add(st, st.endsWith('G') ? ER.filter((e) => !/^[AO]/.test(e)) : ER);
    if (st.endsWith('G')) add(`${st}E`, ER.filter((e) => /^[AO]/.test(e)));
    // jeter → jette, appeler → appelle
    if (/E[LT]$/.test(st)) add(st + st.at(-1), MUTE);
    // pagayer → pagaie
    if (st.endsWith('Y')) add(`${st.slice(0, -1)}I`, MUTE);
  } else if (v.endsWith('IR') && (all || dict.has(`${v.slice(0, -2)}ISSONS`))) {
    add(v.slice(0, -2), IR);
  }
  return out;
}

const out = {}, extra = {};
for (const [id, text] of Object.entries(THEMES)) {
  const set = new Set();
  for (const raw of text.split(/\s+/)) {
    const w = normalizeWord(raw);
    if (!w || w.length < 3) continue;
    for (const suf of SUFFIXES) {
      const f = w + suf;
      if (f.length <= 15 && dict.has(f) && (suf === '' || f.length >= 4)) set.add(f);
    }
    // pluriel en -AUX (cheval → chevaux)
    if (w.endsWith('AL') && dict.has(`${w.slice(0, -2)}AUX`)) set.add(`${w.slice(0, -2)}AUX`);
  }
  for (const raw of (VERBS[id] ?? '').split(/\s+/)) {
    const v = normalizeWord(raw);
    if (!v) continue;
    for (const f of conjugate(v)) if (f.length >= 3 && f.length <= 15 && dict.has(f)) set.add(f);
  }
  // Jargon : accepté même hors des listes du jeu.
  const jx = new Set();
  for (const raw of (JARGON[id]?.words ?? '').split(/\s+/)) {
    const w = normalizeWord(raw);
    if (!w || w.length < 3) continue;
    jx.add(w);
    if (w.length < 15) jx.add(`${w}S`);
  }
  for (const raw of (JARGON[id]?.verbs ?? '').split(/\s+/)) {
    const v = normalizeWord(raw);
    if (v) for (const f of conjugate(v, true)) if (f.length >= 3 && f.length <= 15) jx.add(f);
  }
  for (const w of jx) set.add(w);
  out[id] = [...set].sort();
  extra[id] = [...jx].filter((w) => !dict.has(w)).sort();
  console.log(id, out[id].length, `dont ${extra[id].length} hors des listes`);
}
const body = Object.entries(out).map(([id, ws]) => `  ${id}: '${ws.join(' ')}',`).join('\n');
writeFileSync(new URL('../src/game/themes.data.ts', import.meta.url),
  `// Généré par \`npm run themes\` (scripts/build-themes.mjs) : ne pas modifier à la main.\n` +
  `// Dans une partie à thème, tous ces mots sont valides, même absents de la liste de la partie.\n` +
  `export const THEME_WORDS: Record<string, string> = {\n${body}\n};\n`);
