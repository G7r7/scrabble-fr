// Notifications du navigateur et installation de l'appli (PWA).
// Les notifications ne s'affichent que si la page n'est pas sous les yeux du joueur
// (onglet en arrière-plan, fenêtre réduite ou appli installée en arrière-plan).

const PREF = 'scrabble-fr-notifs';
const ICON = `${import.meta.env.BASE_URL}icons/icon-192.png`;

function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* rien */ } }

let registration: ServiceWorkerRegistration | null = null;

/** Enregistre le service worker (nécessaire pour l'installation et pour les notifications sur Android). */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  } catch { /* navigation privée, http… : l'appli marche sans */ }
}

export const notifSupported = () => 'Notification' in window;

export class Notifier {
  /** Le joueur a demandé les notifications (et le navigateur les autorise). */
  get enabled() {
    return notifSupported() && Notification.permission === 'granted' && lsGet(PREF) === '1';
  }
  get blocked() { return notifSupported() && Notification.permission === 'denied'; }

  /** Bascule : demande l'autorisation la première fois. Renvoie l'état final. */
  async toggle(): Promise<boolean> {
    if (!notifSupported()) return false;
    if (this.enabled) { lsSet(PREF, '0'); return false; }
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    lsSet(PREF, perm === 'granted' ? '1' : '0');
    return this.enabled;
  }

  /** La page est-elle vue en ce moment ? */
  private get watched() { return document.visibilityState === 'visible' && document.hasFocus(); }

  /**
   * Affiche une notification si la page n'est pas regardée.
   * `tag` remplace une notification précédente du même type au lieu de les empiler.
   */
  async show(title: string, body: string, tag = 'scrabble-fr') {
    if (!this.enabled || this.watched) return;
    const opts: NotificationOptions & { renotify?: boolean } = {
      body, tag, renotify: true, icon: ICON, badge: ICON, lang: 'fr', data: { url: location.href },
    };
    this.setBadge(true);
    try {
      const reg = registration ?? (await navigator.serviceWorker?.getRegistration());
      if (reg) return await reg.showNotification(title, opts);
      const n = new Notification(title, opts);
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* refusé ou non pris en charge */ }
  }

  /** Pastille sur l'icône de l'appli installée (Chrome, Edge). */
  setBadge(on: boolean) {
    const nav = navigator as Navigator & { setAppBadge?: () => Promise<void>; clearAppBadge?: () => Promise<void> };
    try { void (on ? nav.setAppBadge?.() : nav.clearAppBadge?.())?.catch(() => {}); } catch { /* rien */ }
  }

  /** Ferme les notifications affichées dès que le joueur revient sur la page. */
  bindFocus() {
    const clear = async () => {
      if (!this.watched) return;
      this.setBadge(false);
      try {
        const reg = registration ?? (await navigator.serviceWorker?.getRegistration());
        for (const n of (await reg?.getNotifications()) ?? []) n.close();
      } catch { /* rien */ }
    };
    document.addEventListener('visibilitychange', clear);
    window.addEventListener('focus', clear);
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Bouton « Installer l'appli » : visible seulement quand Chrome propose l'installation. */
export function bindInstall(button: HTMLElement) {
  let deferred: BeforeInstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => { deferred = null; button.hidden = true; });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    button.hidden = true;
  });
}
