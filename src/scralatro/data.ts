// SCRALATRO : catalogue des tuiles pouvoir, programmes, niveaux spéciaux, effets de tuiles et de cases.

export type Mode = 'solo' | 'coop' | 'compet';
export type Texture = 'bronze' | 'argent' | 'or' | 'bois' | 'verre' | 'papier' | 'pierre';
export type Edition = 'holo' | 'poly' | 'toxique';
export type Font = 'casino' | 'console' | 'western' | 'calli' | 'infection';
export type Pastille = 'jaune' | 'rouge' | 'bleue' | 'violette' | 'verte';
export type Style = 'gras' | 'italique' | 'souligne';
export type CellType = 'MD' | 'MT' | 'MQ' | 'LD' | 'LT' | 'LQ' | 'RND' | 'DEP' | 'P10' | 'P20' | 'P30' | 'ROUE' | 'MQM';
export type CellTex = 'eau' | 'air' | 'terre' | 'feu';
export type Rarity = 'commun' | 'peu commun' | 'rare';

export interface Info { name: string; icon: string; desc: string }

export const TEXTURES: Record<Texture, Info & { price: number }> = {
  bronze: { name: 'Bronze', icon: '🥉', price: 1, desc: '+1 point pour chaque lettre du mot.' },
  argent: { name: 'Argent', icon: '🥈', price: 2, desc: '×1,5 sur le score du mot.' },
  or: { name: 'Or', icon: '🥇', price: 3, desc: '×2 sur le score du mot.' },
  bois: { name: 'Bois', icon: '🪵', price: 1, desc: 'Échanger uniquement des lettres en bois ne termine pas le tour.' },
  verre: { name: 'Verre', icon: '🥃', price: 2, desc: '+10. 1 chance sur 3 de se briser lorsqu’elle est posée.' },
  papier: { name: 'Papier', icon: '📄', price: 2, desc: '×2 sur le score du mot. Se déchire après avoir été posée 3 fois.' },
  pierre: { name: 'Pierre', icon: '🪨', price: 2, desc: '×1,5 au score du tour si la lettre reste sur le chevalet.' },
};
export const EDITIONS: Record<Edition, Info & { price: number }> = {
  holo: { name: 'Holographique', icon: '🌈', price: 2, desc: 'Ajoute 5 points à une autre lettre aléatoire du chevalet lorsqu’elle est piochée.' },
  poly: { name: 'Polychrome', icon: '🎨', price: 2, desc: '+3 de valeur pour le reste de la partie chaque fois qu’elle est remise dans le sac par un échange.' },
  toxique: { name: 'Toxique', icon: '☣️', price: 0, desc: 'Retire 10 points par tour tant qu’elle reste sur le chevalet.' },
};
export const FONTS: Record<Font, Info & { price: number }> = {
  casino: { name: 'Casino', icon: '🎰', price: 2, desc: '1 chance sur 2 : ×2 sur le score du mot, sinon −5 points.' },
  console: { name: 'Console', icon: '👾', price: 2, desc: '+5 de valeur chaque fois qu’elle est sélectionnée par un programme.' },
  western: { name: 'Western', icon: '🤠', price: 1, desc: 'Si elle n’a pas été posée ce coup, se déplace sur une case voisine libre après chaque coup. Un nouveau mot formé rapporte ses points.' },
  calli: { name: 'Calligraphie', icon: '✒️', price: 2, desc: '×2 sur le score du mot si elle en est la première lettre.' },
  infection: { name: 'Infection', icon: '🦠', price: 0, desc: 'À la fin de chaque tour de qui l’a infectée, posée sur le plateau : +5 points, 1 chance sur 5 d’être détruite, puis contamine les tuiles voisines.' },
};
export const PASTILLES: Record<Pastille, Info & { price: number }> = {
  jaune: { name: 'Pastille jaune', icon: '🟡', price: 2, desc: '+3 $ lorsque la tuile est jouée dans un mot.' },
  rouge: { name: 'Pastille rouge', icon: '🔴', price: 3, desc: 'Redéclenche l’effet de la tuile (gains d’argent et risque de casse du verre compris).' },
  bleue: { name: 'Pastille bleue', icon: '🔵', price: 2, desc: '+8 $ lorsque la lettre est échangée.' },
  violette: { name: 'Pastille violette', icon: '🟣', price: 2, desc: '+6 $ lorsque la lettre reste sur le chevalet à la fin du tour.' },
  verte: { name: 'Pastille verte', icon: '🟢', price: 2, desc: '+12 $ lorsque la lettre reste sur le chevalet à la fin du niveau.' },
};
export const STYLES: Record<Style, Info & { price: number }> = {
  gras: { name: 'Gras', icon: '𝐁', price: 1, desc: '×2 sur le score du mot si toutes ses lettres sont en gras.' },
  italique: { name: 'Italique', icon: '𝐼', price: 1, desc: '+10 si toutes les lettres du mot sont en italique.' },
  souligne: { name: 'Souligné', icon: 'U̲', price: 1, desc: 'Vous regagnez les points du mot si toutes ses lettres sont soulignées.' },
};

export const CELL_TYPES: Record<CellType, Info & { price: number; label: string; weight: number }> = {
  MD: { name: 'Mot compte double', icon: '×2', label: 'Mot<br>×2', price: 3, weight: 10, desc: 'Le mot compte double.' },
  MT: { name: 'Mot compte triple', icon: '×3', label: 'Mot<br>×3', price: 5, weight: 6, desc: 'Le mot compte triple.' },
  MQ: { name: 'Mot compte quadruple', icon: '×4', label: 'Mot<br>×4', price: 7, weight: 3, desc: 'Le mot compte quadruple.' },
  LD: { name: 'Lettre compte double', icon: '×2', label: 'Lettre<br>×2', price: 2, weight: 12, desc: 'La lettre compte double.' },
  LT: { name: 'Lettre compte triple', icon: '×3', label: 'Lettre<br>×3', price: 3, weight: 8, desc: 'La lettre compte triple.' },
  LQ: { name: 'Lettre compte quadruple', icon: '×4', label: 'Lettre<br>×4', price: 4, weight: 5, desc: 'La lettre compte quadruple.' },
  RND: { name: 'Bonus aléatoire', icon: '🎲', label: '🎲', price: 3, weight: 7, desc: 'Devient un bonus aléatoire parmi MD, MT, LD ou LT, qui change après chaque coup.' },
  DEP: { name: 'Case départ', icon: '★', label: '★', price: 2, weight: 3, desc: 'Le premier mot du niveau peut passer par n’importe quelle case départ.' },
  P10: { name: '+10 points', icon: '+10', label: '+10', price: 2, weight: 8, desc: '+10 points au mot quand une lettre y est posée.' },
  P20: { name: '+20 points', icon: '+20', label: '+20', price: 3, weight: 5, desc: '+20 points au mot quand une lettre y est posée.' },
  P30: { name: '+30 points', icon: '+30', label: '+30', price: 4, weight: 3, desc: '+30 points au mot quand une lettre y est posée.' },
  ROUE: { name: 'Roue', icon: '🎡', label: '🎡', price: 5, weight: 3, desc: 'Quand une lettre y est posée, ajoute une amélioration aléatoire sur trois cases de base du plateau.' },
  MQM: { name: 'MQ mouvant', icon: '×4↔', label: 'Mot<br>×4', price: 6, weight: 3, desc: 'Mot compte quadruple. Se déplace sur une case vide voisine après chaque coup.' },
};
export const CELL_TEX: Record<CellTex, Info & { price: number }> = {
  eau: { name: 'Eau', icon: '💧', price: 2, desc: 'Le mot compte ×1,5 si une voyelle est posée sur la case.' },
  air: { name: 'Air', icon: '🌬️', price: 2, desc: 'La lettre compte ×1,5 si une voyelle est posée sur la case.' },
  terre: { name: 'Terre', icon: '⛰️', price: 2, desc: 'Le mot compte ×1,5 si une consonne est posée sur la case.' },
  feu: { name: 'Feu', icon: '🔥', price: 2, desc: 'La lettre compte ×1,5 si une consonne est posée sur la case.' },
};

export type PowerId =
  | 'clown' | 'hurleur' | 'dormeur' | 'hesitant' | 'etonne' | 'ninja' | 'photographe' | 'profFr' | 'profMath' | 'profAng'
  | 'sportif' | 'gamer' | 'biologiste' | 'medecin' | 'cancre' | 'dyslexique' | 'disparu' | 'hawaien' | 'georgien'
  | 'extraverti' | 'introverti' | 'bavard' | 'muet' | 'begue' | 'vendeur' | 'mecano' | 'jumelles' | 'feministe'
  | 'masculiniste' | 'bijoutier' | 'bucheron' | 'verrier' | 'maladroit' | 'nain' | 'idole' | 'eboueur' | 'sauveteur'
  | 'optimiste' | 'elitiste' | 'cupide' | 'inconnue' | 'zorro' | 'sourcier' | 'beatboxer' | 'scatman' | 'magicien'
  | 'bleu' | 'duo' | 'trio' | 'quatuor' | 'quintet' | 'sextet' | 'gagnant' | 'tricheur' | 'etranger' | 'perroquet'
  | 'assassin' | 'collectionneur' | 'maya' | 'voyelliste' | 'consonniste' | 'gentil' | 'british' | 'pessimiste'
  | 'denicheur' | 'jongleur' | 'tailleur' | 'croupier' | 'vieux' | 'souriant' | 'paysan' | 'chanceux' | 'bombardier'
  | 'gorgone' | 'mineur' | 'cryptographe' | 'erudit' | 'entraineur' | 'nettoyeur' | 'zombie' | 'desinfecteur';

export interface PowerInfo extends Info { rarity: Rarity }
const P = (name: string, icon: string, rarity: Rarity, desc: string): PowerInfo => ({ name, icon, rarity, desc });

export const POWERS: Record<PowerId, PowerInfo> = {
  clown: P('Le clown', '🤡', 'commun', 'X1. Les suites de HA sont valides (HA, HAHA…). +2 au multiplicateur pour chaque HA présent sur le plateau.'),
  hurleur: P('Le hurleur', '😱', 'commun', 'X1. Les suites de A suivies d’un H sont valides (AH, AAH…). +2 au multiplicateur pour chacune présente sur le plateau.'),
  dormeur: P('Le dormeur', '😴', 'peu commun', 'X1. Les suites de Z sont valides (ZZ, ZZZ…). +2 au multiplicateur pour chacune présente sur le plateau.'),
  hesitant: P('L’hésitant', '😶', 'commun', 'X1. Les suites de E sont valides (EE, EEE…). +0,5 au multiplicateur pour chacune présente sur le plateau.'),
  etonne: P('L’étonné', '😮', 'commun', 'X1. Les suites de O suivies d’un H sont valides (OOH, OOOH…). +0,5 au multiplicateur pour chacune présente sur le plateau.'),
  ninja: P('Le ninja', '🥷', 'peu commun', 'X1. Un Y suivi d’au moins un A est valide (YA, YAAA…). +2 au multiplicateur pour chacune présente sur le plateau.'),
  photographe: P('Le photographe', '📸', 'peu commun', 'Les mots avec un I peuvent l’écrire plusieurs fois de suite (OUISTIITIII). +2 au multiplicateur pour chaque suite d’au moins deux I sur le plateau.'),
  profFr: P('Le professeur de français', '📚', 'peu commun', 'X4 si le mot joué est un verbe conjugué.'),
  profMath: P('Le professeur de mathématique', '📐', 'commun', 'X2 si les tuiles du mot joué ont au moins 3 valeurs différentes.'),
  profAng: P('Le professeur d’anglais', '💂', 'peu commun', 'X4 si le mot est également valide en anglais.'),
  sportif: P('Le sportif', '⚽', 'peu commun', 'X5 si le mot est dans le thème du sport.'),
  gamer: P('Le gamer', '🎮', 'peu commun', 'X5 si le mot est dans le thème des jeux vidéo.'),
  biologiste: P('Le biologiste', '🌿', 'peu commun', 'X5 si le mot est dans le thème des plantes et animaux.'),
  medecin: P('Le médecin', '🩺', 'peu commun', 'X5 si le mot est dans le thème de la médecine.'),
  cancre: P('Le cancre', '🙈', 'peu commun', 'Un mot est valide même si une seule de ses lettres est fausse (XOT pour MOT). Une fois par niveau.'),
  dyslexique: P('Le dyslexique', '🔀', 'peu commun', 'Un mot est valide même si deux lettres voisines sont inversées (OMT pour MOT).'),
  disparu: P('Le disparu', '👻', 'peu commun', 'X3 si le mot ne contient aucune des lettres E, S, A, R, T et I.'),
  hawaien: P('L’hawaïen', '🌺', 'commun', 'X3 si le mot contient au moins 3 voyelles.'),
  georgien: P('Le géorgien', '🏔️', 'commun', 'X3 si le mot contient au moins 4 consonnes.'),
  extraverti: P('L’extraverti', '🎉', 'commun', 'X3 si le mot contient au moins 5 lettres.'),
  introverti: P('L’introverti', '🫣', 'commun', 'X3 si le mot contient 3 lettres ou moins.'),
  bavard: P('Le bavard', '💬', 'commun', 'X3 si vous jouez au moins 4 mots sur le même coup.'),
  muet: P('Le muet', '🤐', 'commun', 'X1. +2 au multiplicateur pour chaque tour joué sans poser de tuile durant ce niveau (tour passé ou lettres échangées).'),
  begue: P('Le bègue', '🗯️', 'commun', 'X3 si vous jouez au moins 3 mots de deux lettres sur le même coup.'),
  vendeur: P('Le vendeur', '🛒', 'peu commun', 'Quand vous le vendez, obtenez une copie d’une tuile pouvoir aléatoire que vous possédez.'),
  mecano: P('Le mécano', '🔧', 'peu commun', 'À la fin du niveau, ajoute une amélioration aléatoire sur une case aléatoire du plateau.'),
  jumelles: P('Les jumelles', '👯', 'commun', 'X4 si le mot joué est au pluriel.'),
  feministe: P('La féministe', '♀️', 'commun', 'X4 si le mot joué est genré au féminin.'),
  masculiniste: P('Le masculiniste', '♂️', 'commun', 'X3 si le mot joué est genré au masculin.'),
  bijoutier: P('Le bijoutier', '💍', 'peu commun', 'X4 si le mot contient au moins deux tuiles de bronze, d’argent ou d’or.'),
  bucheron: P('Le bûcheron', '🪓', 'commun', 'X4 si le mot contient au moins une tuile en bois.'),
  verrier: P('Le verrier', '🏺', 'commun', 'X4 si le mot contient au moins une tuile en verre.'),
  maladroit: P('Le maladroit', '🫨', 'peu commun', 'X1. +1 au multiplicateur pour chaque tuile en verre détruite.'),
  nain: P('Le nain', '🧔', 'commun', 'X1. +0,1 au multiplicateur pour chaque tuile de valeur 1 posée.'),
  idole: P('L’idole', '🌟', 'peu commun', 'X2 pour chaque voyelle désignée posée. La voyelle change à chaque coup.'),
  eboueur: P('L’éboueur', '🧹', 'commun', 'X1. +0,5 au multiplicateur pour chaque lettre défaussée pendant ce niveau.'),
  sauveteur: P('Le sauveteur', '🛟', 'peu commun', 'S’il ne vous reste plus de coup, se détruit et valide le niveau.'),
  optimiste: P('L’optimiste', '😄', 'commun', 'X5 sur le dernier coup du niveau.'),
  elitiste: P('L’élitiste', '🧐', 'peu commun', 'X4 si le tour rapporte 50 points ou plus (avant son propre effet).'),
  cupide: P('Le cupide', '💰', 'commun', 'X3 si vous avez au moins 20 $.'),
  inconnue: P('L’inconnue', '❓', 'rare', 'Le X peut être utilisé comme une lettre joker.'),
  zorro: P('Le Zorro', '🗡️', 'peu commun', 'Quand vous jouez un Z, ajoute une amélioration aléatoire sur une lettre aléatoire de votre chevalet.'),
  sourcier: P('Le sourcier', '🪄', 'peu commun', 'Quand vous jouez un Y, ajoute une amélioration aléatoire sur une case voisine libre.'),
  beatboxer: P('Le beatboxer', '🎤', 'peu commun', 'Les suites de P, T, K, Q, C, S et Z sont valides (PTCSK). Ces lettres valent +10 dans les mots qui ne contiennent qu’elles.'),
  scatman: P('Le scatman', '🎷', 'peu commun', 'Les suites de S, K, D, B, P, A, I, O, U et Y sont valides (SKIBIDDY). Ces lettres valent +10 dans les mots qui ne contiennent qu’elles.'),
  magicien: P('Le magicien', '🧙', 'peu commun', 'Les suites de A, B, C, D et R sont valides (ABRACA). Ces lettres valent +15 dans les mots qui ne contiennent qu’elles.'),
  bleu: P('Le bleu', '🫐', 'peu commun', 'Les suites de A, B, D et E sont valides (BADADA). Ces lettres valent +15 dans les mots qui ne contiennent qu’elles.'),
  duo: P('Le duo', '2️⃣', 'commun', 'X2 si le mot contient exactement deux lettres.'),
  trio: P('Le trio', '3️⃣', 'commun', 'X3 si le mot contient exactement trois lettres.'),
  quatuor: P('Le quatuor', '4️⃣', 'commun', 'X4 si le mot contient exactement quatre lettres.'),
  quintet: P('Le quintet', '5️⃣', 'peu commun', 'X5 si le mot contient exactement cinq lettres.'),
  sextet: P('Le sextet', '6️⃣', 'peu commun', 'X6 si le mot contient exactement six lettres.'),
  gagnant: P('Le gagnant', '🏆', 'peu commun', '+100 points en plus du score des mots si vous faites un scrabble.'),
  tricheur: P('Le tricheur', '🃏', 'rare', 'Un scrabble se fait en posant six tuiles de votre chevalet en un seul coup.'),
  etranger: P('L’*tranger', '🧳', 'rare', 'Si votre premier coup du niveau forme un mot commençant par E, ce E est détruit et une lettre de votre chevalet devient en or.'),
  perroquet: P('Le perroquet', '🦜', 'peu commun', 'X3 si le mot est déjà présent sur le plateau.'),
  assassin: P('L’assassin', '🔪', 'peu commun', 'Si vous ne posez qu’une seule lettre, elle est détruite et vous gagnez 6 $.'),
  collectionneur: P('Le collectionneur', '🗃️', 'peu commun', 'X1. +0,25 au multiplicateur pour chaque lettre ajoutée à votre sac.'),
  maya: P('Le maya', '🗿', 'peu commun', 'Toutes vos tuiles O deviennent en or lorsqu’elles sont jouées.'),
  voyelliste: P('Le voyelliste', '🅰️', 'commun', 'Vos voyelles marquent 10 points de plus lorsqu’elles sont jouées.'),
  consonniste: P('Le consonniste', '🅱️', 'commun', 'Vos consonnes marquent 10 points de plus lorsqu’elles sont jouées.'),
  gentil: P('Le gentil', '😇', 'peu commun', 'X2. −1 à la taille de votre chevalet.'),
  british: P('La british', '🫖', 'rare', '+50 points pour chaque T sur votre chevalet.'),
  pessimiste: P('Le pessimiste', '😞', 'peu commun', 'X1. +1 au multiplicateur pour chaque voyelle détruite.'),
  denicheur: P('Le dénicheur', '🔍', 'commun', '50 % de réduction sur votre premier achat dans chaque magasin.'),
  jongleur: P('Le jongleur', '🤹', 'rare', '+1 à la taille de votre chevalet.'),
  tailleur: P('Le tailleur de pierre', '⚒️', 'peu commun', '+10 points par mot joué pour chaque lettre en pierre dans votre sac.'),
  croupier: P('Le croupier', '🎲', 'peu commun', 'X1. +0,5 au multiplicateur chaque fois qu’une lettre Casino réussit son effet.'),
  vieux: P('Le vieux', '👴', 'commun', 'X4. −0,05 au multiplicateur par lettre jouée.'),
  souriant: P('Le souriant', '😊', 'commun', 'X1. +0,5 au multiplicateur pour chaque I sur le plateau.'),
  paysan: P('Le paysan', '🧑‍🌾', 'rare', 'X4 si vous avez au moins 28 cases LD sur votre plateau.'),
  chanceux: P('Le chanceux', '🍀', 'peu commun', 'Les cases roue ajoutent des améliorations sur 5 cases supplémentaires.'),
  bombardier: P('Le bombardier', '💣', 'peu commun', 'À la fin de chaque niveau réussi, ajoute une amélioration aléatoire sur une case de base aléatoire.'),
  gorgone: P('La gorgone', '🐍', 'peu commun', 'Quand vous jouez un P, une tuile aléatoire de votre chevalet devient en pierre.'),
  mineur: P('Le mineur', '⛏️', 'peu commun', '+5 $ chaque fois que vous posez une tuile de bronze, d’argent ou d’or.'),
  cryptographe: P('Le cryptographe', '🔐', 'rare', 'À votre premier coup du niveau, choisissez n (0 à 25). Les lettres marquantes sont ensuite décalées de n (ZUT → BWV avec 2), pour le reste de la partie.'),
  erudit: P('L’érudit', '🎓', 'peu commun', 'Quand vous posez un A, sa valeur augmente de 15 points pour toujours.'),
  entraineur: P('L’entraîneur', '🏋️', 'peu commun', 'Chaque tuile que vous posez gagne 4 points de valeur pour toujours.'),
  nettoyeur: P('Le nettoyeur', '🧽', 'rare', 'Quand vous réussissez un niveau, les tuiles de votre dernier coup deviennent des jokers.'),
  zombie: P('Le zombie', '🧟', 'peu commun', 'Au début de chacun de vos tours, 1 chance sur 10 d’infecter une tuile aléatoire du plateau. Le zombie disparaît alors.'),
  desinfecteur: P('Le désinfecteur', '🧴', 'peu commun', 'X1. Au début de vos tours, désinfecte toutes les tuiles du plateau et de votre chevalet et retire les éditions toxiques. +0,5 au multiplicateur par tuile soignée.'),
};
export const POWER_IDS = Object.keys(POWERS) as PowerId[];
export const POWER_PRICE: Record<Rarity, number> = { commun: 4, 'peu commun': 6, rare: 8 };
export const RARITY_WEIGHT: Record<Rarity, number> = { commun: 70, 'peu commun': 25, rare: 5 };
export const MAX_POWERS = 7;

export type ProgramId =
  | 'clonage' | 'poubelle' | 'ecriture' | 'plus' | 'fois' | 'etincelles' | 'verre' | 'sauver' | 'metal' | 'bois'
  | 'pierre' | 'papier' | 'pastilles' | 'gras' | 'italique' | 'souligne' | 'police' | 'gomme' | 'investissement'
  | 'trading' | 'transfert' | 'boostV' | 'boostC';

export interface ProgramInfo extends Info {
  /** Nombre de tuiles à choisir [min, max] ; null : aucun choix. */
  pick: [number, number] | null;
  /** Le programme remplit le chevalet avec des tuiles du sac. */
  draws: boolean;
}
const FILL = 'Remplissez votre chevalet avec des tuiles de votre sac puis ';
const G = (name: string, icon: string, pick: [number, number] | null, draws: boolean, desc: string): ProgramInfo => ({ name, icon, pick, draws, desc });
export const PROGRAMS: Record<ProgramId, ProgramInfo> = {
  clonage: G('Clonage', '⧉', [2, 2], true, `${FILL}sélectionnez-en exactement deux : la première devient une copie de la seconde.`),
  poubelle: G('Poubelle', '🗑️', [0, 2], true, `${FILL}sélectionnez-en deux ou moins : elles sont détruites.`),
  ecriture: G('Écriture', '🖊️', [1, 1], true, `${FILL}sélectionnez-en une : changez sa lettre pour celle de votre choix, en gardant ses autres caractéristiques.`),
  plus: G('Plus', '➕', [0, 3], true, `${FILL}sélectionnez-en trois ou moins : +5 sur leur valeur.`),
  fois: G('Fois', '✖️', [0, 3], true, `${FILL}sélectionnez-en trois ou moins : ×1,5 sur leur valeur.`),
  etincelles: G('Étincelles', '✨', [1, 1], true, `${FILL}sélectionnez-en une : 1 chance sur 2 de lui donner une édition aléatoire.`),
  verre: G('Verre', '🥃', [1, 1], true, `${FILL}sélectionnez-en une : elle devient en verre.`),
  sauver: G('Sauver', '💾', null, false, 'Place dans votre réserve une copie du dernier programme utilisé.'),
  metal: G('Métal', '🧈', [2, 2], true, `${FILL}sélectionnez-en deux : elles deviennent au hasard en bronze, en argent ou en or.`),
  bois: G('Bois', '🪵', [0, 3], true, `${FILL}sélectionnez-en trois ou moins : elles deviennent en bois.`),
  pierre: G('Pierre', '🪨', [1, 1], true, `${FILL}sélectionnez-en une : elle devient en pierre.`),
  papier: G('Papier', '📄', [1, 1], true, `${FILL}sélectionnez-en une : elle devient en papier.`),
  pastilles: G('Pastilles', '🔴', [2, 2], true, `${FILL}sélectionnez-en deux : chacune reçoit une pastille de couleur aléatoire.`),
  gras: G('Gras', '𝐁', [2, 2], true, `${FILL}sélectionnez-en deux : elles passent en gras.`),
  italique: G('Italique', '𝐼', [2, 2], true, `${FILL}sélectionnez-en deux : elles passent en italique.`),
  souligne: G('Souligné', 'U̲', [2, 2], true, `${FILL}sélectionnez-en deux : elles sont soulignées.`),
  police: G('Police', '🔤', null, false, 'Une tuile aléatoire de votre sac sans police reçoit une police aléatoire.'),
  gomme: G('Gomme', '⬜', [1, 1], true, `${FILL}sélectionnez-en une : elle devient un joker.`),
  investissement: G('Investissement', '💲', null, false, 'Gagnez la moitié de l’argent que vous avez.'),
  trading: G('Trading', '📈', null, false, 'Gagnez au hasard entre 0 et 20 $.'),
  transfert: G('Transfert', '🔗', [2, 2], true, `${FILL}sélectionnez-en deux : toutes les caractéristiques spéciales de la première passent à la seconde.`),
  boostV: G('Boost voyelles', '🚀', null, true, `${FILL}une tuile aléatoire est détruite. Ajoute 3 voyelles améliorées aléatoires.`),
  boostC: G('Boost consonnes', '🚀', null, true, `${FILL}une tuile aléatoire est détruite. Ajoute 3 consonnes améliorées aléatoires.`),
};
export const PROGRAM_IDS = Object.keys(PROGRAMS) as ProgramId[];
export const PROGRAM_PRICE = 3;
export const UPGRADE_PRICE = 3;

export type SpecialId =
  | 'alpha' | 'beta' | 'gamma' | 'delta' | 'epsilon' | 'zeta' | 'eta' | 'theta' | 'iota' | 'kappa' | 'lambda' | 'mu'
  | 'nu' | 'xi' | 'omicron' | 'pi' | 'rho' | 'sigma' | 'tau' | 'upsilon' | 'phi' | 'khi' | 'psi' | 'omega';
export interface SpecialInfo { letter: string; name: string; desc: string }
const S = (letter: string, name: string, desc: string): SpecialInfo => ({ letter, name, desc });
export const SPECIALS: Record<SpecialId, SpecialInfo> = {
  alpha: S('Α', 'Alpha', 'Annule les effets et la valeur des tuiles de voyelle.'),
  beta: S('Β', 'Bêta', 'Annule les effets et la valeur des tuiles de consonne.'),
  gamma: S('Γ', 'Gamma', 'Vous devez jouer au moins une lettre parmi K, W, X, Y et Z pour valider le niveau.'),
  delta: S('Δ', 'Delta', 'Les effets de textures, éditions, polices et pastilles de vos tuiles ne s’appliquent pas.'),
  epsilon: S('Ε', 'Epsilon', 'Les mots de moins de 4 lettres ne vous rapportent aucun point.'),
  zeta: S('Ζ', 'Zêta', 'Les effets des cases du plateau ne s’appliquent pas.'),
  eta: S('Η', 'Êta', 'Après chaque coup, une case spéciale aléatoire que vous possédez se déplace sur une case vide voisine.'),
  theta: S('Θ', 'Thêta', 'Après chaque coup, une tuile aléatoire posée sur le plateau perd 5 points de valeur, pour toujours (la valeur peut devenir négative).'),
  iota: S('Ι', 'Iota', 'Après chaque coup, une tuile aléatoire posée sur le plateau recule d’une lettre (B devient A) ; un A est détruit. Pour toujours.'),
  kappa: S('Κ', 'Kappa', 'Taille du chevalet −1.'),
  lambda: S('Λ', 'Lambda', 'Vous ne pouvez pas échanger vos tuiles.'),
  mu: S('Μ', 'Mu', 'Perdez 1 $ par tuile jouée.'),
  nu: S('Ν', 'Nu', 'Si vous posez au moins une tuile, ce coup doit atteindre l’objectif.'),
  xi: S('Ξ', 'Xi', 'Après chaque coup, une tuile verrou 🔒 s’ajoute à votre sac : elle ne peut être ni jouée ni échangée, et reste après le niveau.'),
  omicron: S('Ο', 'Omicron', 'Après chaque coup, une tuile de votre chevalet devient toxique, pour toujours.'),
  pi: S('Π', 'Pi', 'Les mots joués ne peuvent pas contenir deux fois la même lettre.'),
  rho: S('Ρ', 'Rhô', 'À chaque tour, une tuile du chevalet est désignée : si vous posez des tuiles, vous devez la jouer.'),
  sigma: S('Σ', 'Sigma', 'Si vous posez des tuiles, vous devez former au moins un mot de deux lettres, sinon ce tour ne rapporte rien.'),
  tau: S('Τ', 'Tau', 'Vous ne pouvez pas poser les tuiles E, A, I et S.'),
  upsilon: S('Υ', 'Upsilon', 'Vous devez vendre une de vos tuiles pouvoir pour valider le niveau (en coopération : chacun des deux).'),
  phi: S('Φ', 'Phi', 'Les tuiles déjà posées sur le plateau ne vous rapportent aucun point.'),
  khi: S('Χ', 'Khi', 'Si vous posez des tuiles, vous devez former au moins deux mots, sinon ce tour ne rapporte rien.'),
  psi: S('Ψ', 'Psi', 'Annule l’effet d’une tuile pouvoir aléatoire, qui change à chaque tour.'),
  omega: S('Ω', 'Oméga', 'Objectif de score bien plus élevé.'),
};
export const SPECIAL_IDS = Object.keys(SPECIALS) as SpecialId[];

/** Mots valides à la fois en français (sans accents) et en anglais, pour le professeur d'anglais. */
export const ENGLISH = new Set(`
A AS AT AN AH AI AM ON OR OH OK IF IN IS IT US UN DO GO NO SO TO ME MY BE HE WE YE HI LA PA MA BOA
ABSENT ABSURDE ACCENT ACCEPT ACCES ACCORD ACE ACT ACTE ACTIF ACTION ACTIONS ACTIVE ADAPT ADMIRE ADORE ADULT ADULTE
AFFAIRE AGE AGENT AGENTS AGILE AIDE AIDES AIR AIRS ALBUM ALBUMS ALERT ALERTE ALIBI ALLIANCE ALLIE ALPHA ALTITUDE AMEN
AMPLE ANCIEN ANGLE ANGLES ANIMAL ANNEXE ANTENNE APPEL ARCHE ARCHIVE ARENA ARENE ARMES ARMS ART ARTS ARTICLE ARTISTE
ASPECT ASSET ASSURE ATLAS ATOME ATTACHE ATTENTION AUDIO AURA AUTO AUTOS AVENUE AVION BABY BADGE BAGAGE BAGUETTE BAL BALL
BALLE BALLET BAN BANANE BANANA BANDE BANDIT BANDS BANK BANS BAR BARON BARS BAS BASE BASES BASIN BASKET BASS BATTE
BATTERIE BEAU BEAUTE BEIGE BEST BIBLE BIG BIKE BINGO BISON BLAME BLANC BLEU BLOC BLOG BLOND BLONDE BLUE BLUES BLUFF BOB
BOMB BOMBE BON BOND BONE BONUS BOOM BORDER BOSS BOT BOUQUET BOUT BOX BOXE BRAVE BRAVO BRIDGE BRIEF BRILLIANT BRIOCHE
BRUNE BRUTAL BRUTE BUDGET BUFFET BUG BUS BUT CABLE CAFE CAGE CAKE CALM CALME CAMERA CAMP CAMPS CANAL CANCER CANDIDE CANE
CANNE CANON CANOE CAP CAPE CAPITAL CAPS CAR CARS CARE CARGO CARRIERE CARTE CASE CASES CASH CASINO CASTE CASUAL CAT CAUSE
CAVE CAVES CHAMPION CHANCE CHANGE CHAOS CHARGE CHARME CHART CHAT CHEF CHEFS CHERUB CHIC CHIPS CHOC CHOIR CHORUS CIGARE
CINEMA CIRCUIT CITE CIVIL CLAN CLASS CLASSE CLASSIC CLIENT CLIMAT CLUB CLUBS CODE CODES COIN COINS COL COMBAT COMET
COMETE COMMENT COMMERCE COMMON COMPACT COMPAS CONCERT CONE CONFORT CONSOLE CONTACT CONTENT CONTEXT CONTRE CONTROL
CORAL CORD CORE CORN CORPS CORRECT COST COSTUME COTE COUCH COUPLE COURAGE COURSE COUSIN COVER CRANE CRASH CREATURE
CREDIT CREME CRIME CRISE CRITIQUE CROCODILE CROIX CRUEL CRUSH CUBE CULTURE CURE CURIEUX CURRY CYCLE DAME DAMES DAN
DANCE DANGER DATE DATES DEBUT DECENT DECOR DEFICIT DEGRADE DELICATE DEMI DEMO DENSE DENT DEPOT DESERT DESIGN DESIR
DESSERT DETAIL DETECTIVE DEVISE DIAGRAM DIALOGUE DIAMANT DIET DIGNE DINER DIRECT DISCO DISCRET DISQUE DIVA DIVERS
DIVINE DOCTEUR DOCUMENT DOG DOME DOMINO DON DONE DONS DOS DOSE DOT DOUBLE DOUBT DRAGON DRAMA DRAME DRAP DUEL DUO DUNE
DUPLEX DURABLE DUTCH EAST ECHO EDITION EFFORT ELEGANT ELEMENT ELEPHANT ELITE EMAIL EMOTION ENORME ENTRE ENTREE
ENVIE EPIC ERRATA ERROR ESSAI ESSENCE ESTIME ETHIC EVENT EXACT EXAMEN EXCUSE EXIST EXIT EXOTIQUE EXPERT EXPORT EXTRA
FABLE FACE FACES FACT FAME FAMINE FAN FANS FARCE FAST FATAL FAUNE FAVORI FEMME FERME FIBRE FIGURE FILM FILMS FINAL
FINALE FINE FIRME FIT FIX FLAG FLAME FLASH FLAT FLEUR FLIRT FLORE FLOT FLUIDE FLUTE FOCUS FOLK FOND FONT FOOT FORCE
FORME FORT FORUM FOSSE FOU FRAGILE FRANC FRANCHISE FRAUDE FRESQUE FRONT FRUIT FUN FUNK FUR FUSION FUTUR GAG GALA GALE
GANG GANT GARAGE GAS GATE GAZ GEL GENE GENRE GENTLEMAN GESTE GIN GIRAFE GLACE GLOBAL GLOBE GLOIRE GLOSSAIRE GLUE GOAL
GOLF GORILLE GOSPEL GRACE GRADE GRAIN GRAND GRANDE GRANITE GRAPHIQUE GRATIN GRAVE GRAVITE GRILL GRIMACE GROS GROUP
GROUPE GUIDE GUITARE GUN HABIT HALL HALO HAMSTER HARPE HASARD HERBE HERO HEROS HIPPIE HIT HOBBY HOCKEY HOMME HOT HOTEL
HUMAN HUMBLE HUMOUR HYBRIDE HYMNE ICE ICON IDEAL IDEE IDIOT IDOLE IGNORE ILLUSION IMAGE IMAGES IMMENSE IMPACT IMPORT
INCIDENT INDEX INDIGO INFANT INFINI INFO INITIAL INSECTE INSTANT INSTINCT INTENSE INTERIEUR INVITE ION ISOLE ITEM JADE
JAM JAZZ JEAN JEANS JEEP JET JOB JOKER JOURNAL JUDO JUGE JUNGLE JUNIOR JURY KARATE KILO KIT KIWI LABEL LAC LAME LAMPE
LANCE LARGE LASER LATENT LAVA LAVE LEADER LEGAL LEGENDE LEMON LENT LESION LIBERAL LIBRE LICENCE LIEN LIFT LIGNE LIME
LIMIT LIMITE LINE LINGE LION LIONS LIST LISTE LITRE LOBBY LOCAL LOGO LONG LOOK LOT LOTION LOTS LOTUS LOUPE LOYAL LUNE
LUXE MACHINE MADAME MAGAZINE MAGIC MAIN MAJOR MAL MALE MAMAN MAN MANGO MANGUE MANIE MANIERE MAP MARCHE MARGE MARINE
MARK MARS MASQUE MASSE MASSIF MASTER MATCH MATE MATERIEL MATURE MAXIMUM MEDIA MEDICAL MEDIUM MELODIE MEMBRE MEMO MENTAL
MENU MERCI MERE MESSAGE METAL METEO METRO MICRO MIDI MILE MILLE MIME MINE MINES MINI MINIMUM MINUTE MIRAGE MISE MISSION
MIXTE MOBILE MODE MODEL MODELE MODERNE MODESTE MOMENT MONITOR MONSTER MONSTRE MONTAGE MONUMENT MORAL MORALE MORT MOSAIQUE
MOTEL MOTIF MOTION MOTOR MOUSE MOUSSE MUSE MUSEE MUSIC MUSIQUE MUTANT MUTE MYSTERE MYTHE NAIVE NATION NATIONAL NATIVE
NATURE NAVAL NEON NERVE NET NEUTRE NEVE NICHE NOBLE NOBLESSE NOMADE NOMINAL NON NORMAL NORMALE NOTE NOTES NOTION NOVICE
NUANCE NUCLEAR NUDE NUMERO OASIS OBJECT OBSCUR OBSERVE OCEAN OCTAVE ODE ODEUR OFFENSE OFFICE OFFICIEL OLIVE OMELETTE
OMEN ONCE ONE OPAQUE OPERA OPINION OPTION ORAL ORANGE ORBITE ORCHESTRE ORDINAIRE ORGANE ORGUE ORIGINAL ORNEMENT OUTRAGE
OVAL OVATION PACK PAGE PAGES PAIN PAIR PALACE PALE PALETTE PALME PAN PANDA PANEL PANIQUE PANORAMA PANTHERE PAPA PARADE
PARADIS PARC PARENT PARK PART PARTI PARTICULE PARTIE PARTISAN PARTS PAS PASSAGE PASSE PASSION PASTA PASTE PATIENT PATIO
PATRON PAUSE PAVE PAY PEAK PEDALE PELICAN PEN PENSION PERCHE PERFECT PERIL PERMANENT PERSONNE PET PETITE PHARMACIE
PHASE PHOTO PHRASE PIANO PIC PICS PIE PIECE PIG PILE PILOT PILOTE PIN PINE PINS PINT PIPE PIPES PIRATE PISTE PITIE PIZZA
PLACE PLAGE PLAN PLANE PLANET PLANS PLANTE PLASMA PLASTIQUE PLATE PLATEAU PLAY PLOMB PLUS POEM POEME POET POINT POINTS
POISON POLICE POLITE POLO POMPE PONT PONY POOL POP PORC PORT PORTE PORTS POSE POSER POSITION POST POSTE POT POTION POTS
POUR PRAIRIE PRATIQUE PRESENT PRESSE PRESTIGE PRETEXTE PRIME PRINCE PRINCESSE PRISE PRISON PRIVE PRIX PRO PROBLEME
PROCEDURE PRODUIT PROFIT PROFOND PROGRAMME PROGRES PROJET PROMPT PROSE PROTEST PROUD PROVINCE PUB PUBLIC PULL PULSE
PUNCH PUNK PUR PURE PUZZLE PYRAMIDE QUALITE QUART QUARTZ QUEST QUESTION QUEUE QUIZ RACE RACES RACINE RADAR RADIO RAGE
RAID RAIL RAISIN RALLYE RAMPE RANCH RANG RANGE RAP RAPIDE RARE RAT RATE RATION RATS RAY RAYON REACTION REAL REALISTE
REBELLE RECENT RECORD RECRUE REFLEXE REFUGE REGIME REGION REGLE RELATIF RELAX RELIEF RELIGION REMEDE RENDEZVOUS RENT
REPORT REPTILE RESERVE RESIDENT RESISTANCE RESPECT REST RESTE RESULTAT RETRO REVENUE REVUE RHUM RIDE RIFLE RIGIDE RING
RIP RISQUE RITE RITUEL RIVAL RIVE ROBE ROBOT ROC ROCK ROI ROLE ROMAN ROMANCE ROMANTIQUE ROSE ROSES ROT ROUGE ROUTE ROUTINE
ROYAL RUBY RUDE RUE RUGBY RUINE RUINES RUMEUR RUSE RUSH SABLE SABOTAGE SAC SAGE SAGA SAINT SALE SALON SALUT SAND
SANDWICH SANE SATIN SAUCE SAUNA SAVANT SAVE SCANDALE SCENE SCORE SCOUT SCRIPT SECRET SECTE SECTEUR SECTION SECURITE
SEMI SENILE SENS SENSATION SENSIBLE SERIE SERIES SERUM SERVICE SESSION SET SEXE SHAMPOOING SHOP SHORT SHOW SIGNAL SIGNE
SILENCE SIMPLE SINGLE SINGE SIRE SIREN SITE SITES SKI SLALOM SLAM SLIP SLOGAN SNOB SOCIAL SOFA SOFT SOL SOLAIRE SOLDE
SOLE SOLIDE SOLO SOLUTION SOMBRE SON SONATE SONG SONS SORT SOUPE SOURCE SOUVENIR SPA SPACE SPECIAL SPHERE SPIRALE SPORT
SPORTS SPRINT SQUARE STABLE STADE STAGE STAND STAR STARS STATION STATUE STATUT STOCK STOP STORE STRATEGIE STRESS STRICT
STRUCTURE STUDIO STUPIDE STYLE SUBTIL SUBTLE SUCCES SUGGESTION SUITE SUJET SUPER SUPERBE SUPPLICE SUPPORT SUPREME SUR
SURE SURFACE SURPRISE SYMBOLE SYSTEME TABLE TABLES TABLETTE TACT TACTIQUE TALC TALENT TANK TANGO TAPE TAPIS TARIF TART
TAXE TAXI TEAM TEMPLE TEMPO TENDRE TENNIS TENSION TENT TENTE TERMINAL TERRAIN TERRE TERRIBLE TEST TESTE TEXTE TEXTILE
THE THEME THEORIE THERAPIE THESE TICKET TIGRE TIMIDE TOAST TOILE TOMATE TON TONE TONIQUE TONS TOP TORT TORTURE TOTAL
TOTEM TOUR TOURISME TOURISTE TOURNOI TRACE TRACT TRACTEUR TRADITION TRAGEDIE TRAIN TRAIT TRAITE TRAM TRANSIT TRAP
TRAVAIL TREK TRIBU TRIBUNAL TRICK TRIO TRIPLE TRIVIAL TROMPETTE TROPHEE TROPIC TROT TRUCK TUBE TUBES TULIPE TUNNEL
TURBO TUTU TYPE TYPES TYPIQUE TYRAN UNIFORME UNION UNIQUE UNIT UNITE URBAIN URGENT URNE USAGE USE UTILE VAGUE VAIN
VALET VALIDE VALISE VAN VANILLE VASE VASTE VELOURS VENT VERB VERBE VERDICT VERSION VERTIGE VETERAN VETO VIA VIBRATION
VICE VICTIME VIDEO VIGNETTE VILLA VILLAGE VINE VINYL VIOLENCE VIOLET VIOLETTE VIP VIRAGE VIRAL VIRTUEL VIRUS VISA VISAGE
VISION VISITE VISUEL VITAL VITAMINE VODKA VOGUE VOLCAN VOLT VOLUME VOTE VOTES WAGON WESTERN WHISKY YACHT YOGA YOGI ZEN
ZERO ZEST ZIGZAG ZONE ZONES ZOO ZOOM
`.split(/\s+/).filter(Boolean));
