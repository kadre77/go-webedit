// Draft store: keeps Drafts, the open Tabs and the active Tab in this
// browser's IndexedDB, so unsaved work survives a reload, crash or closed
// browser tab. Every storage call is wrapped: when IndexedDB is unavailable
// or fails, the store keeps what it's given in memory for this page only, and
// the app carries on without errors.

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
  saveDraft(path: string, draft: StoredDraft): void;
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
      (db) => (opened = { db }),
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
      return (await requestResult(op(db.transaction(store, mode).objectStore(store)))) as T | undefined;
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
    saveDraft(path, draft) {
      const key = pathKey(path);
      memory.set(key, draft);
      void run(draftsStore, "readwrite", (s) => s.put(draft, key));
    },
    dropDraft(path) {
      const key = pathKey(path);
      memory.delete(key);
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
