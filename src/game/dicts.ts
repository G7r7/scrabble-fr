// Listes de mots au choix pour chaque partie. Toutes sont libres ; l'ODS (protégé) n'en fait pas partie,
// mais chacun peut importer le sien pour jouer en solo (« ods », jamais envoyé au serveur).
export type DictId = 'courant' | 'libre' | 'complet' | 'etendu';
/** Liste d'une partie : une des listes du jeu, ou le fichier importé par le joueur (solo uniquement). */
export type GameDict = DictId | 'ods';

export interface DictInfo {
  id: DictId; label: string; file: string; words: string; help: string;
  source: string; url: string; licence: string;
}

export const DICTS: DictInfo[] = [
  {
    id: 'courant', label: 'Mots courants', file: 'fr-courant.txt', words: '32 000',
    help: 'Les mots fréquents seulement : idéal pour débuter ou jouer en famille.',
    source: 'Lexique 3.83', url: 'http://www.lexique.org/', licence: 'CC BY-SA 4.0',
  },
  {
    id: 'libre', label: 'Libre', file: 'fr-libre.txt', words: '311 000',
    help: 'La liste habituelle du jeu, proche de l’ODS sans être identique.',
    source: 'an-array-of-french-words', url: 'https://github.com/words/an-array-of-french-words', licence: 'MIT',
  },
  {
    id: 'complet', label: 'Complète', file: 'fr-complet.txt', words: '408 000',
    help: 'Toutes les formes du lexique du correcteur Grammalecte : soigné et très complet.',
    source: 'Grammalecte 7.7', url: 'https://grammalecte.net/', licence: 'MPL 2.0',
  },
  {
    id: 'etendu', label: 'Étendue', file: 'fr-etendu.txt', words: '644 000',
    help: 'Le plus grand lexique libre, mots rares et littéraires compris.',
    source: 'Morphalou 3.1 (ATILF / CNRS)', url: 'https://www.ortolang.fr/market/lexicons/morphalou', licence: 'LGPL-LR',
  },
];
export const DEFAULT_DICT: DictId = 'libre';

export const dictOf = (v: unknown): DictId | null => (DICTS.some((d) => d.id === v) ? (v as DictId) : null);
export const dictInfo = (id: DictId) => DICTS.find((d) => d.id === id)!;

/**
 * Liste perso : un modèle (une des listes du jeu) plus des mots ajoutés et retirés. Une partie garde ce
 * résumé (et non la liste entière) : c'est léger, et le serveur peut arbitrer avec.
 */
export interface Lexicon { name: string; base: DictId; add: string[]; remove: string[] }
/** Liste perso enregistrée dans le navigateur. */
export interface CustomList extends Lexicon { id: string; updated: number }
/** En ligne, la liste perso accompagne chaque état de partie : on limite le nombre de changements. */
export const LEXICON_ONLINE_MAX = 2000;

const WORD = /^[A-Z]{2,15}$/;
/** Résumé valide (mots normalisés, sans doublons), ou null. */
export function cleanLexicon(x: unknown, max = Infinity): Lexicon | null {
  if (!x || typeof x !== 'object') return null;
  const l = x as Record<string, unknown>;
  const base = dictOf(l.base);
  if (!base || !Array.isArray(l.add) || !Array.isArray(l.remove)) return null;
  const add = [...new Set(l.add.filter((w): w is string => typeof w === 'string' && WORD.test(w)))];
  const remove = [...new Set(l.remove.filter((w): w is string => typeof w === 'string' && WORD.test(w)))];
  if (add.length + remove.length > max) return null;
  const name = typeof l.name === 'string' ? l.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '';
  return { name: name || 'Liste perso', base, add, remove };
}

/** Clé courte qui identifie le contenu d'un résumé (pour ne pas recharger la même liste). */
export function lexiconKey(l: Lexicon): string {
  let h = 0;
  for (const w of [...l.add, '|', ...l.remove]) for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0;
  return `${l.base}+${l.add.length}-${l.remove.length}-${(h >>> 0).toString(36)}`;
}

/** Applique le résumé aux mots du modèle (triés, sans doublons). */
export function applyLexicon(baseWords: string[], l: Lexicon): string[] {
  const out = new Set(baseWords);
  for (const w of l.remove) out.delete(w);
  for (const w of l.add) out.add(w);
  return [...out].sort();
}
