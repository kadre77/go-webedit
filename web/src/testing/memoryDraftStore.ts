// A DraftStore kept in memory, for tests of the App state. It stands in for
// what the App state sees of draftStore.ts; the leaving journal behind it is
// covered by the e2e tests. Only tests import this.

import type { DraftStore, StoredDraft, StoredTabs } from "../draftStore";
import { isUnder, movedPath, pathKey } from "../paths";

export type MemoryDraftStore = DraftStore & {
  /** The stored Drafts, by path key. */
  readonly drafts: Map<string, StoredDraft & { path: string }>;
  /** The open Tabs last stored. */
  tabs: StoredTabs | undefined;
};

export function memoryDraftStore(tabs?: StoredTabs, drafts: Record<string, StoredDraft> = {}): MemoryDraftStore {
  const stored = new Map(Object.entries(drafts).map(([path, d]) => [pathKey(path), { ...d, path }]));
  const store: MemoryDraftStore = {
    drafts: stored,
    tabs,
    openTabs: async () => store.tabs,
    saveOpenTabs(next) {
      store.tabs = next;
    },
    draft: async (path) => {
      const d = stored.get(pathKey(path));
      return d && { content: d.content, rev: d.rev };
    },
    saveDraft(path, draft) {
      stored.set(pathKey(path), { ...draft, path });
    },
    dropDraft(path) {
      stored.delete(pathKey(path));
    },
    moveDrafts(from, to) {
      for (const d of [...stored.values()]) {
        if (!isUnder(d.path, from)) continue;
        stored.delete(pathKey(d.path));
        const path = movedPath(d.path, from, to);
        stored.set(pathKey(path), { ...d, path });
      }
    },
    dropDrafts(path) {
      for (const d of [...stored.values()]) if (isUnder(d.path, path)) stored.delete(pathKey(d.path));
    },
  };
  return store;
}
