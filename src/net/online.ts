// Liaison avec le serveur de jeu (dossier server/), qui garde les parties et arbitre les coups.
import type { ClientMsg, ServerMsg } from './protocol';

const RELAY_URL: string = import.meta.env.VITE_RELAY_URL ?? 'ws://localhost:8787';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode(): string {
  const a = crypto.getRandomValues(new Uint8Array(6));
  return [...a].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}
export const newToken = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const isCode = (s: string) => /^[A-Z0-9]{6}$/.test(s);

/** Fermetures définitives envoyées par le serveur (voir CLOSE dans protocol.ts). */
const FATAL: Record<number, string> = {
  4000: 'Requête refusée par le serveur.',
  4001: 'Ce code est déjà pris.',
  4003: 'Cette partie est déjà complète.',
  4004: 'Partie introuvable : vérifiez le lien. Elle a peut-être expiré ou été quittée par les deux joueurs.',
  4005: 'Cette partie a été ouverte dans un autre onglet.',
  4029: 'Serveur saturé, réessayez dans un instant.',
};
export const CODE_TAKEN = FATAL[4001];

export interface LinkHandlers {
  /** Connecté au serveur. */
  onOpen?: () => void;
  /** L'adversaire vient d'arriver ou de partir. */
  onPeer: (online: boolean) => void;
  onMessage: (msg: ServerMsg) => void;
  /** `fatal` : la liaison est abandonnée (pas de reconnexion). */
  onError: (text: string, fatal: boolean) => void;
}

/** Liaison d'un joueur au serveur, avec reconnexion automatique. */
export class GameLink {
  private ws: WebSocket | null = null;
  private closed = false;
  private retries = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  peerOnline = false;

  constructor(
    public code: string, token: string, create: boolean, private h: LinkHandlers,
  ) {
    this.url = `${RELAY_URL}?code=${code}&token=${token}${create ? '&create=1' : ''}`;
    this.connect();
  }
  private url: string;

  private connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => { this.retries = 0; this.h.onOpen?.(); };
    ws.onmessage = (e) => {
      let msg: unknown;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === '_peer') {
        this.peerOnline = !!(msg as { online?: unknown }).online;
        return this.h.onPeer(this.peerOnline);
      }
      this.h.onMessage(msg as ServerMsg);
    };
    ws.onclose = (e) => {
      if (ws !== this.ws || this.closed) return;
      this.ws = null;
      if (this.peerOnline) { this.peerOnline = false; this.h.onPeer(false); }
      if (FATAL[e.code]) {
        this.closed = true;
        return this.h.onError(FATAL[e.code], true);
      }
      // Coupure réseau : on réessaie, de plus en plus lentement (jusqu'à 15 s).
      const first = this.retries === 0;
      this.retries++;
      if (first) this.h.onError('Connexion au serveur perdue, reconnexion…', false);
      this.timer = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** Math.min(this.retries, 4)));
    };
  }

  get connected() { return this.ws?.readyState === WebSocket.OPEN; }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(bye?: ClientMsg) {
    if (bye) this.send(bye);
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    setTimeout(() => ws?.close(1000), 100);
  }
}
