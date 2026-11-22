// Stockage local (IndexedDB) du fichier ODS importé et des listes perso : rien ne quitte le navigateur.
const DB = 'scrabble-fr', STORE = 'dict', KEY = 'ods';

export interface StoredDict { name: string; count: number; text: string }

/** Listes perso (modèle + mots ajoutés et retirés), elles aussi gardées dans le navigateur. */
export const LISTS = 'listes';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(LISTS)) db.createObjectStore(LISTS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest, store = STORE): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function loadOds(): Promise<StoredDict | null> {
  try { return (await tx<StoredDict | undefined>('readonly', (s) => s.get(KEY))) ?? null; } catch { return null; }
}
export async function saveOds(d: StoredDict): Promise<void> {
  try { await tx('readwrite', (s) => s.put(d, KEY)); } catch { /* stockage indisponible : actif pour la session seulement */ }
}
export async function clearOds(): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* rien */ }
}
