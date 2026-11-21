// Messages échangés entre les navigateurs et le serveur de jeu (dossier server/).
// Le serveur garde les parties et arbitre chaque coup ; les navigateurs n'en reçoivent qu'une vue
// (sans le chevalet adverse ni l'ordre du sac).
import type { GameState, Variant } from '../game/game';
import type { Action } from '../game/remote';
import type { ThemeId } from '../game/themes';
import type { DictId } from '../game/dicts';

/** Options choisies par la personne qui crée la partie. */
export interface GameOptions { variant: Variant | null; theme?: ThemeId | null; dict?: DictId | null }

export type ClientMsg =
  /** Envoyé à chaque connexion ; `options` n'est lu qu'à la création de la partie. */
  | { type: 'hello'; name: string; options?: GameOptions }
  | { type: 'action'; action: Action }
  | { type: 'rematch' }
  /** Le joueur quitte la partie pour de bon. */
  | { type: 'bye' };

export type ServerMsg =
  /** Partie créée, personne ne l'a encore rejointe. */
  | { type: 'waiting' }
  | { type: 'state'; state: GameState; you: 0 | 1 }
  | { type: 'error'; message: string }
  /** L'adversaire a quitté la partie. */
  | { type: 'left' }
  /** Présence de l'adversaire (connecté ou non). */
  | { type: '_peer'; online: boolean };

/** Codes de fermeture de la connexion (définitifs : le navigateur ne se reconnecte pas). */
export const CLOSE = {
  BAD_REQUEST: 4000, CODE_TAKEN: 4001, ROOM_FULL: 4003, NOT_FOUND: 4004, REPLACED: 4005, BUSY: 4029,
} as const;

export const cleanName = (s: unknown) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) : '';
