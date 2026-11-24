// Stockage local (IndexedDB) : photos, préréglages, journal des retouches
const DB = 'retouche-ouinon', VER = 1;
let dbp;
const open = () => dbp || (dbp = new Promise((res, rej) => {
  const r = indexedDB.open(DB, VER);
  r.onupgradeneeded = () => { const d = r.result; for (const s of ['photos', 'presets', 'journal']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const tx = async (s, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(s, mode), st = t.objectStore(s); const r = fn(st); t.oncomplete = () => res(r && r.result !== undefined ? r.result : undefined); t.onerror = () => rej(t.error); }); };
export const put = (s, v) => tx(s, 'readwrite', st => st.put(v));
export const get = (s, id) => tx(s, 'readonly', st => st.get(id));
export const all = (s) => tx(s, 'readonly', st => st.getAll());
export const del = (s, id) => tx(s, 'readwrite', st => st.delete(id));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export async function persist() { try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { } }
