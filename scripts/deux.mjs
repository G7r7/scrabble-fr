// Mots de deux lettres : liste usuelle du Scrabble francophone, la même pour toutes les listes du jeu
// (les lexiques contiennent des abréviations comme KM ou CL, et ignorent des mots de jeu comme QI ou KA).
export const DEUX = 'AA AE AH AI AN AS AU AY BA BE BI BU CA CE CI DA DE DO DU EH EN ES ET EU EX FA FI GO HA HE HI HO IF IL IN JE KA LA LE LI LU MA ME MI MU NA NE NI NO NU OC OD OF OH OM ON OR OS OU PI PU QI RA RE RI RU SA SE SI SU TA TE TU UD UN US UT VA VE VS VU WU XI YE'.split(' ');

/** Remplace les mots de deux lettres de `set` par la liste usuelle. */
export function fixTwoLetters(set) {
  for (const w of [...set]) if (w.length === 2) set.delete(w);
  for (const w of DEUX) set.add(w);
  return set;
}
