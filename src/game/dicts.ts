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

