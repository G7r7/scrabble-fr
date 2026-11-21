// Construit src/game/themes.data.ts : mots des thèmes du mode fantasy présents dans le dictionnaire libre,
// avec leurs pluriels (et formes en -E, -ES, -X…) quand le dictionnaire les connaît.
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeWord } from '../src/dict/normalize.js';
import { THEMES } from './themes-src.mjs';

const dict = new Set(readFileSync(new URL('../public/dict/fr-libre.txt', import.meta.url), 'utf8').split(/\r?\n/));
const SUFFIXES = ['', 'S', 'X'];
const out = {};
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
  out[id] = [...set].sort();
  console.log(id, out[id].length);
}
const body = Object.entries(out).map(([id, ws]) => `  ${id}: '${ws.join(' ')}',`).join('\n');
writeFileSync(new URL('../src/game/themes.data.ts', import.meta.url),
  `// Généré par \`npm run themes\` (scripts/build-themes.mjs) : ne pas modifier à la main.\nexport const THEME_WORDS: Record<string, string> = {\n${body}\n};\n`);
