// Garde l'écran allumé tant que l'appli est affichée (Screen Wake Lock API) : sur téléphone, la réflexion
// d'un coup ou l'attente de l'adversaire ne doivent pas mettre l'écran en veille.
// Le verrou est rendu par le navigateur dès que la page est masquée : on le redemande à son retour.
// Certains navigateurs (Safari) n'acceptent la demande qu'après un geste : on réessaie au toucher suivant.

let lock: WakeLockSentinel | null = null;
let pending = false;

async function acquire() {
  if (lock || pending || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  pending = true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch { /* refusé (économie d'énergie, pas de geste…) : nouvel essai au prochain toucher */ }
  pending = false;
}

export function keepScreenOn() {
  if (!('wakeLock' in navigator)) return;
  void acquire();
  document.addEventListener('visibilitychange', () => void acquire());
  for (const ev of ['pointerdown', 'keydown'] as const) document.addEventListener(ev, () => void acquire(), { passive: true });
}
