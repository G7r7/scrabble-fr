// Génère public/dict/fr-libre.txt à partir de la liste libre (MIT)
// « an-array-of-french-words ». Un mot par ligne, A–Z, 2 à 15 lettres.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { normalizeWord } from '../src/dict/normalize.js';

const require = createRequire(import.meta.url);
const words = require('an-array-of-french-words');

const out = new Set();
for (const w of words) {
  if (/[-' ]/.test(w)) continue; // mots composés : interdits au Scrabble
  const n = normalizeWord(w);
  if (n) out.add(n);
}
// Mots de 2 lettres : la liste libre contient des abréviations (KM, CL…) et
// ignore des mots de jeu courants (QI, KA…). On la remplace par la liste
// usuelle des deux-lettres du Scrabble francophone.
const DEUX = 'AA AE AH AI AN AS AU AY BA BE BI BU CA CE CI DA DE DO DU EH EN ES ET EU EX FA FI GO HA HE HI HO IF IL IN JE KA LA LE LI LU MA ME MI MU NA NE NI NO NU OC OD OF OH OM ON OR OS OU PI PU QI RA RE RI RU SA SE SI SU TA TE TU UD UN US UT VA VE VS VU WU XI YE'.split(' ');
for (const w of [...out]) if (w.length === 2) out.delete(w);
for (const w of DEUX) out.add(w);
const sorted = [...out].sort();
mkdirSync('public/dict', { recursive: true });
writeFileSync('public/dict/fr-libre.txt', sorted.join('\n') + '\n');
console.log(`fr-libre.txt : ${sorted.length} mots`);
