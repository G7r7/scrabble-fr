// Génère public/dict/fr-libre.txt à partir de la liste libre (MIT)
// « an-array-of-french-words ». Un mot par ligne, A–Z, 2 à 15 lettres.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { normalizeWord } from '../src/dict/normalize.js';
import { fixTwoLetters } from './deux.mjs';

const require = createRequire(import.meta.url);
const words = require('an-array-of-french-words');

const out = new Set();
for (const w of words) {
  if (/[-' ]/.test(w)) continue; // mots composés : interdits au Scrabble
  const n = normalizeWord(w);
  if (n) out.add(n);
}
fixTwoLetters(out);
const sorted = [...out].sort();
mkdirSync('public/dict', { recursive: true });
writeFileSync('public/dict/fr-libre.txt', sorted.join('\n') + '\n');
console.log(`fr-libre.txt : ${sorted.length} mots`);
