// Persistência local via IndexedDB. Um único object store "results" — cada
// registro é uma medição independente de um dos 3 testes. Tudo roda no
// dispositivo, sem serviços externos.

import type { SavedTestResult } from "../types/index.ts";

const DB_NAME = "guitar-analyser";
const DB_VERSION = 2;
const STORE_RESULTS = "results";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RESULTS)) {
        const store = db.createObjectStore(STORE_RESULTS, { keyPath: "id" });
        store.createIndex("testKind", "testKind", { unique: false });
      }
      // Stores de versões anteriores do app (instruments/sessions) não são
      // mais usados; deixamos como estão para não perder dados sem querer,
      // mas o app não os lê.
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveResult(result: SavedTestResult): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_RESULTS, "readwrite");
  tx.objectStore(STORE_RESULTS).put(result);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listResults(): Promise<SavedTestResult[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_RESULTS, "readonly");
  const result = await promisify(tx.objectStore(STORE_RESULTS).getAll());
  return (result as SavedTestResult[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteResult(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_RESULTS, "readwrite");
  tx.objectStore(STORE_RESULTS).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function generateId(): string {
  return crypto.randomUUID();
}

const INSTRUMENT_NAME_KEY = "guitar-analyser:lastInstrumentName";

export function getLastInstrumentName(): string {
  try {
    return localStorage.getItem(INSTRUMENT_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setLastInstrumentName(name: string): void {
  try {
    localStorage.setItem(INSTRUMENT_NAME_KEY, name);
  } catch {
    // ignore (localStorage indisponível)
  }
}
