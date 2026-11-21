// Génère les listes de mots supplémentaires du jeu à partir de lexiques libres téléchargés à part
// (ils ne sont pas dans le dépôt) :
//
//   node scripts/build-dicts.mjs <Lexique383.tsv> <lexique-grammalecte-fr-v7.7.txt> <Morphalou3.1_CSV.csv>
//
// - Mots courants (public/dict/fr-courant.txt) : Lexique 3.83, formes d'au moins 1 occurrence par million
//   (films ou livres). http://www.lexique.org/databases/Lexique383/Lexique383.tsv — CC BY-SA 4.0
// - Complète (public/dict/fr-complet.txt) : lexique des formes fléchies de Grammalecte 7.7, sans noms propres.
//   https://grammalecte.net/dic/lexique-grammalecte-fr-v7.7.zip — MPL 2.0
// - Étendue (public/dict/fr-etendu.txt) : Morphalou 3.1 (ATILF / CNRS), sans noms propres ni locutions.
//   https://repository.ortolang.fr/api/content/morphalou/latest/Morphalou3.1_formatCSV_toutEnUn.zip — LGPL-LR
//
// Un mot par ligne, A–Z sans accents, 2 à 15 lettres ; les mots de deux lettres suivent la liste usuelle.
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { normalizeWord } from '../src/dict/normalize.js';
import { fixTwoLetters } from './deux.mjs';

const [lexique, grammalecte, morphalou] = process.argv.slice(2);
if (!morphalou) { console.error('Usage : node scripts/build-dicts.mjs <Lexique383.tsv> <grammalecte.txt> <Morphalou3.1_CSV.csv>'); process.exit(1); }

async function* lines(path) {
  for await (const line of createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })) yield line;
}
/** Forme acceptable : pas de mot composé, pas de nom propre ni de sigle (majuscule initiale). */
function add(set, raw) {
  if (!raw || /[-' .]/.test(raw) || raw[0] !== raw[0].toLowerCase()) return;
  const w = normalizeWord(raw);
  if (w) set.add(w);
}
function save(file, set) {
  const sorted = [...fixTwoLetters(set)].sort();
  writeFileSync(`public/dict/${file}`, sorted.join('\n') + '\n');
  console.log(`${file} : ${sorted.length} mots`);
}

// Lexique 3 : ortho, …, freqfilms2 (col. 9), freqlivres (col. 10), en occurrences par million.
{
  const set = new Set();
  let head = null;
  for await (const line of lines(lexique)) {
    const c = line.split('\t');
    if (!head) { head = c; continue; }
    const films = +c[head.indexOf('freqfilms2')], livres = +c[head.indexOf('freqlivres')];
    if (Math.max(films, livres) >= 1) add(set, c[head.indexOf('ortho')]);
  }
  save('fr-courant.txt', set);
}

// Grammalecte : colonnes id, fid, Flexion, Lemme, Étiquettes… ; on écarte noms propres (npr), prénoms (prn), patronymes.
{
  const set = new Set();
  let started = false;
  for await (const line of lines(grammalecte)) {
    const c = line.split('\t');
    if (!started) { started = c[0] === 'id' && c[2] === 'Flexion'; continue; }
    const tag = (c[4] ?? '').split(' ')[0];
    if (['npr', 'prn', 'patr', 'nompr'].includes(tag)) continue;
    add(set, c[2]);
  }
  save('fr-complet.txt', set);
}

// Morphalou : lignes « lemme » (catégorie en col. 3, locution en col. 5) suivies de lignes de flexions (graphie en col. 10).
{
  const set = new Set();
  let started = false, skip = false;
  for await (const line of lines(morphalou)) {
    const c = line.split(';');
    if (!started) { started = c[0] === 'GRAPHIE'; continue; }
    if (c[0]) skip = /propre/i.test(c[2]) || !!c[4];
    if (!skip) add(set, c[9]);
  }
  save('fr-etendu.txt', set);
}
