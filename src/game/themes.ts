// Mode fantasy : un thème choisi pour la partie. Les mots du thème rapportent le double de leurs points,
// et le plateau prend les couleurs (animées) du thème.
import type { Move } from './types';
import { THEME_WORDS } from './themes.data';

export type ThemeId = 'culture' | 'jeux' | 'sports' | 'nature' | 'medecine';
export interface Theme { id: ThemeId; label: string; icons: string[] }

export const THEMES: Theme[] = [
  { id: 'culture', label: 'Films, livres & musique', icons: ['🎬', '📚', '🎵', '🎸', '🎭', '🎹'] },
  { id: 'jeux', label: 'Jeux vidéo', icons: ['🎮', '👾', '🕹️', '🏆', '💎', '⚔️'] },
  { id: 'sports', label: 'Sports', icons: ['⚽', '🏀', '🎾', '🏅', '🚴', '🏉'] },
  { id: 'nature', label: 'Plantes & animaux', icons: ['🌿', '🦊', '🌸', '🦋', '🍄', '🐢'] },
  { id: 'medecine', label: 'Médecine', icons: ['💊', '🩺', '🧬', '❤️', '🦴', '🩹'] },
];
/** Multiplicateur des mots du thème. */
export const THEME_MULT = 2;

export const themeOf = (v: unknown): ThemeId | null => (THEMES.some((t) => t.id === v) ? (v as ThemeId) : null);
export const themeInfo = (id: ThemeId) => THEMES.find((t) => t.id === id)!;

const sets = new Map<ThemeId, Set<string>>();
export function themeWords(id: ThemeId): Set<string> {
  let s = sets.get(id);
  if (!s) sets.set(id, (s = new Set(THEME_WORDS[id].split(' '))));
  return s;
}
export const isThemeWord = (id: ThemeId, word: string) => themeWords(id).has(word);

/** Le coup avec les mots du thème marqués et leurs points multipliés. */
export function applyTheme(id: ThemeId | null | undefined, move: Move): Move {
  if (!id) return move;
  let bonus = 0;
  const words = move.words.map((w) => {
    if (!isThemeWord(id, w.word)) return w;
    bonus += w.score * (THEME_MULT - 1);
    return { ...w, score: w.score * THEME_MULT, themed: true };
  });
  return bonus ? { ...move, words, score: move.score + bonus } : move;
}
