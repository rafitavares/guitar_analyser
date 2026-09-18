// Persistência local via IndexedDB. Dois object stores: "instruments" e
// "sessions". Tudo roda no dispositivo, sem serviços externos.

import type { Instrument, Session } from "../types/index.ts";

const DB_NAME = "guitar-analyser";
const DB_VERSION = 1;
const STORE_INSTRUMENTS = "instruments";
const STORE_SESSIONS = "sessions";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_INSTRUMENTS)) {
        db.createObjectStore(STORE_INSTRUMENTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const store = db.createObjectStore(STORE_SESSIONS, { keyPath: "id" });
        store.createIndex("instrumentId", "instrumentId", { unique: false });
      }
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

export async function saveInstrument(instrument: Instrument): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_INSTRUMENTS, "readwrite");
  tx.objectStore(STORE_INSTRUMENTS).put(instrument);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listInstruments(): Promise<Instrument[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_INSTRUMENTS, "readonly");
  const result = await promisify(tx.objectStore(STORE_INSTRUMENTS).getAll());
  return result as Instrument[];
}

export async function getInstrument(id: string): Promise<Instrument | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_INSTRUMENTS, "readonly");
  const result = await promisify(tx.objectStore(STORE_INSTRUMENTS).get(id));
  return result as Instrument | undefined;
}

export async function saveSession(session: Session): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_SESSIONS, "readwrite");
  tx.objectStore(STORE_SESSIONS).put(session);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listSessions(): Promise<Session[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_SESSIONS, "readonly");
  const result = await promisify(tx.objectStore(STORE_SESSIONS).getAll());
  return (result as Session[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listSessionsForInstrument(instrumentId: string): Promise<Session[]> {
  const all = await listSessions();
  return all.filter((s) => s.instrumentId === instrumentId);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_SESSIONS, "readonly");
  const result = await promisify(tx.objectStore(STORE_SESSIONS).get(id));
  return result as Session | undefined;
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_SESSIONS, "readwrite");
  tx.objectStore(STORE_SESSIONS).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function generateId(): string {
  return crypto.randomUUID();
}
