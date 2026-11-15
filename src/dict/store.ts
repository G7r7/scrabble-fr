// Stockage local (IndexedDB) du fichier ODS importé : il ne quitte jamais le navigateur.
const DB = 'scrabble-fr', STORE = 'dict', KEY = 'ods';

export interface StoredDict { name: string; count: number; text: string }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
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
