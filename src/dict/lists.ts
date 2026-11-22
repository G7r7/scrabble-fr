// Listes perso enregistrées dans le navigateur (IndexedDB) : seulement le modèle et les différences.
import type { CustomList } from '../game/dicts';
import { LISTS, tx } from './store';

export async function loadLists(): Promise<CustomList[]> {
  try {
    const all = await tx<CustomList[]>('readonly', (s) => s.getAll(), LISTS);
    return all.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  } catch { return []; }
}
export async function saveList(l: CustomList): Promise<void> {
  try { await tx('readwrite', (s) => s.put({ ...l, updated: Date.now() }), LISTS); } catch { /* stockage indisponible */ }
}
export async function deleteList(id: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(id), LISTS); } catch { /* rien */ }
}
export const newListId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
