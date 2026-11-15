// Partagé entre le script Node et l'application.
/** Normalise un mot : majuscules, sans accents, A–Z uniquement, 2–15 lettres. Renvoie null sinon. */
export function normalizeWord(raw) {
  let w = raw.trim();
  if (!w) return null;
  w = w.replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE');
  w = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (!/^[A-Z]{2,15}$/.test(w)) return null;
  return w;
}
