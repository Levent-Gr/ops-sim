export const DB_NAME = 'ops_sim_db';
export const DB_VER = 3;

// CPT terimi kullanıcı isteği üzerine tamamen kaldırıldı.
// Eski 'cpts' store'undaki kayıtlar v3 migration'da artık kullanılmıyor.
export const STORES = {
  config: 'config',
  deliveries: 'deliveries',
  history: 'history',
  charges: 'charges'
};

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.config)) db.createObjectStore(STORES.config);
      if (!db.objectStoreNames.contains(STORES.deliveries)) db.createObjectStore(STORES.deliveries, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.history)) db.createObjectStore(STORES.history, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.charges)) db.createObjectStore(STORES.charges, { keyPath: 'id' });
      // v3: eski 'cpts' store'unu temizle (CPT terimi kaldırıldı)
      if (db.objectStoreNames.contains('cpts')) db.deleteObjectStore('cpts');
    };
    req.onsuccess = e => { _db = e.target.result; res(_db); };
    req.onerror = e => rej(e.target.error);
  });
}

export function idbGet(store, key) {
  return openDB().then(db => new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  }));
}

export function idbPut(store, value, key) {
  return openDB().then(db => new Promise((res, rej) => {
    const os = db.transaction(store, 'readwrite').objectStore(store);
    const r = key !== undefined ? os.put(value, key) : os.put(value);
    r.onsuccess = () => res();
    r.onerror = e => rej(e.target.error);
  }));
}

export function idbDelete(store, key) {
  return openDB().then(db => new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    r.onsuccess = () => res();
    r.onerror = e => rej(e.target.error);
  }));
}

export function idbGetAll(store) {
  return openDB().then(db => new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  }));
}

export function idbClear(store) {
  return openDB().then(db => new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).clear();
    r.onsuccess = () => res();
    r.onerror = e => rej(e.target.error);
  }));
}
