// Draft store: keeps Drafts, the open Tabs and the active Tab in this
// browser's IndexedDB, so unsaved work survives a reload, crash or closed
// browser tab. Every storage call is wrapped: when IndexedDB is unavailable
// or fails, the store keeps what it's given in memory for this page only, and
// the app carries on without errors.
//
// A write to IndexedDB made as the page is left can be aborted when the page
// goes, so a Draft written then is also put, synchronously, in localStorage:
// the leaving journal. The next time the store opens it moves the journal's
// Drafts into IndexedDB, and only then serves reads.

import { isUnder, movedPath, pathKey } from "./paths";

/** A Draft as stored: the content, and the revision of the file it was
 * opened (or last saved) at, so saving it still checks for a Save Conflict. */
export type StoredDraft = { content: string; rev: string };

/** The open Tabs, in order, by path, and which one is active. */
export type StoredTabs = {
  tabs: { path: string; preview: boolean }[];
  active?: string;
};

export type DraftStore = {
  /** The Tabs that were open last time, if any were recorded. */
  openTabs(): Promise<StoredTabs | undefined>;
  saveOpenTabs(tabs: StoredTabs): void;
  /** The stored Draft of the file at path, if there is one. */
  draft(path: string): Promise<StoredDraft | undefined>;
  /** Stores the Draft. `leaving` says the page is being left or hidden, so
   * it must land before the page goes. */
  saveDraft(path: string, draft: StoredDraft, leaving?: boolean): void;
  dropDraft(path: string): void;
  /** Moves every Draft at or under `from` to the same place under `to`. */
  moveDrafts(from: string, to: string): void;
  /** Drops every Draft at or under path. */
  dropDrafts(path: string): void;
};

const dbName = "webedit";
// The object stores: Drafts by path key, and the open Tabs under one key.
const draftsStore = "drafts";
const tabsStore = "tabs";
const tabsKey = "open";
// The localStorage key of the leaving journal: Drafts by path key.
const journalKey = "webedit.leavingDrafts";

function readJournal(): Record<string, StoredDraft> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(journalKey) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, StoredDraft>) : {};
  } catch {
    return {};
  }
}

function writeJournal(journal: Record<string, StoredDraft>) {
  try {
    if (Object.keys(journal).length) localStorage.setItem(journalKey, JSON.stringify(journal));
    else localStorage.removeItem(journalKey);
  } catch {
    // Too big, or no localStorage: IndexedDB's own write is all there is.
  }
}

/** Moves the journal's Drafts into IndexedDB, then empties the journal. */
function applyJournal(db: IDBDatabase, journal: Record<string, StoredDraft>): Promise<void> {
  const entries = Object.entries(journal);
  if (!entries.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(draftsStore, "readwrite");
    const store = tx.objectStore(draftsStore);
    for (const [key, draft] of entries) store.put(draft, key);
    tx.oncomplete = () => {
      writeJournal({});
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const requestResult = (req: IDBRequest) =>
  new Promise<unknown>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(draftsStore);
      req.result.createObjectStore(tabsStore);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
}

export function createDraftStore(): DraftStore {
  // The in-memory copy: what the store holds when IndexedDB doesn't work, and
  // what reads fall back to when a read from IndexedDB fails.
  const memory = new Map<string, StoredDraft>();
  let memoryTabs: StoredTabs | undefined;

  // The Drafts written as the page was last left, until they're in
  // IndexedDB; kept in memory too when IndexedDB doesn't work.
  const journal = readJournal();
  for (const [key, draft] of Object.entries(journal)) memory.set(key, draft);
  /** Drops the journal entries `stale` picks: a later change supersedes them. */
  const forgetJournal = (stale: (key: string) => boolean) => {
    const keys = Object.keys(journal).filter(stale);
    if (!keys.length) return;
    keys.forEach((key) => delete journal[key]);
    writeJournal(journal);
  };

  let warned = false;
  const failed = (e: unknown) => {
    if (warned) return;
    warned = true;
    console.warn("Browser storage isn't working; Drafts are kept for this page only.", e);
  };

  // The database once open (undefined if it can't be), so that requests can
  // start at once: a write made as the page is left must not wait a tick.
  let opened: { db: IDBDatabase | undefined } | undefined;
  let opening: Promise<unknown>;
  try {
    opening = openDB().then(
      async (db) => {
        await applyJournal(db, { ...journal }).catch(failed);
        opened = { db };
      },
      (e) => (failed(e), (opened = { db: undefined })),
    );
  } catch (e) {
    failed(e);
    opened = { db: undefined };
    opening = Promise.resolve();
  }

  /** Runs one request against an object store. Requests start in the order
   * they're made, so a later write to a key lands after an earlier one. */
  async function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
    try {
      if (!opened) await opening;
      const db = opened?.db;
      if (!db) return undefined;
      const tx = db.transaction(store, mode);
      const req = op(tx.objectStore(store));
      // Commit a write at once, rather than when this task ends: a write made
      // as the page is left (flushing a Draft) must land before the page
      // goes, or the browser aborts it.
      if (mode === "readwrite") tx.commit();
      return (await requestResult(req)) as T | undefined;
    } catch (e) {
      failed(e);
      return undefined;
    }
  }

  return {
    async openTabs() {
      return (await run<StoredTabs>(tabsStore, "readonly", (s) => s.get(tabsKey))) ?? memoryTabs;
    },
    saveOpenTabs(tabs) {
      memoryTabs = tabs;
      void run(tabsStore, "readwrite", (s) => s.put(tabs, tabsKey));
    },
    async draft(path) {
      const key = pathKey(path);
      return (await run<StoredDraft>(draftsStore, "readonly", (s) => s.get(key))) ?? memory.get(key);
    },
    saveDraft(path, draft, leaving = false) {
      const key = pathKey(path);
      memory.set(key, draft);
      if (leaving) {
        journal[key] = draft;
        writeJournal(journal);
      } else forgetJournal((k) => k === key);
      void run(draftsStore, "readwrite", (s) => s.put(draft, key));
    },
    dropDraft(path) {
      const key = pathKey(path);
      memory.delete(key);
      forgetJournal((k) => k === key);
      void run(draftsStore, "readwrite", (s) => s.delete(key));
    },
    moveDrafts(from, to) {
      rewriteDrafts(from, (key) => movedPath(key, pathKey(from), pathKey(to)));
    },
    dropDrafts(path) {
      rewriteDrafts(path, () => undefined);
    },
  };

  /** Re-keys, or drops when `rekey` gives undefined, every Draft at or under
   * path, in memory and in one IndexedDB transaction. Drafts are keyed by
   * path key, so they are found by key range. */
  function rewriteDrafts(path: string, rekey: (key: string) => string | undefined) {
    const root = pathKey(path);
    forgetJournal((key) => isUnder(key, root));
    const moved = [...memory].filter(([key]) => isUnder(key, root));
    moved.forEach(([key]) => memory.delete(key));
    for (const [key, draft] of moved) {
      const next = rekey(key);
      if (next !== undefined) memory.set(next, draft);
    }
    void (async () => {
      try {
        if (!opened) await opening;
        const db = opened?.db;
        if (!db) return;
        const store = db.transaction(draftsStore, "readwrite").objectStore(draftsStore);
        const ranges = [IDBKeyRange.only(root), IDBKeyRange.bound(`${root}/`, `${root}0`, false, true)];
        const found: [string, StoredDraft][] = [];
        for (const range of ranges) {
          const [keys, values] = await Promise.all([requestResult(store.getAllKeys(range)), requestResult(store.getAll(range))]);
          (keys as string[]).forEach((key, i) => found.push([key, (values as StoredDraft[])[i]]));
        }
        for (const [key] of found) store.delete(key);
        for (const [key, draft] of found) {
          const next = rekey(key);
          if (next !== undefined) store.put(draft, next);
        }
      } catch (e) {
        failed(e);
      }
    })();
  }
}
