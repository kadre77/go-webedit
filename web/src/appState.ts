// App state: the tree, which folders are expanded, which files turned
// out to be binary this session, and the open Tabs (which one is active,
// which one, if any, is the Preview Tab, and each one's Draft and revision).
// It also owns the Save Conflict and outside-change rules.

import { Text } from "@codemirror/state";
import { type Accessor, batch, createEffect, createMemo, createSignal, on } from "solid-js";
import { api, ApiError, type OpenedFile, type TreeEntry } from "./api";

/** Dropbox paths are case-insensitive: compare and key paths through this. */
export const pathKey = (path: string) => path.toLowerCase();

export type TreeNode = {
  path: string;
  name: string;
  kind: "file" | "folder";
  depth: number;
  children: TreeNode[];
  // Why a file can't be opened, if it can't.
  unopenable?: "too-large" | "binary";
};

const byFoldersThenName = (a: TreeNode, b: TreeNode) =>
  a.kind !== b.kind
    ? a.kind === "folder"
      ? -1
      : 1
    : a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** Builds the nested tree from the flat listing. */
function buildTree(entries: TreeEntry[], binary: ReadonlySet<string>): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, TreeNode>(); // lower-case path -> node
  const depth = (p: string) => p.split("/").length - 1;
  const sorted = [...entries].sort((a, b) => depth(a.path) - depth(b.path));
  for (const e of sorted) {
    const slash = e.path.lastIndexOf("/");
    const node: TreeNode = {
      path: e.path,
      name: e.path.slice(slash + 1),
      kind: e.kind,
      depth: depth(e.path),
      children: [],
    };
    if (e.kind === "file") {
      if (binary.has(pathKey(e.path))) node.unopenable = "binary";
      else if (!e.openable) node.unopenable = e.reason ?? "too-large";
    } else {
      folders.set(pathKey(e.path), node);
    }
    const parent = slash < 0 ? undefined : folders.get(pathKey(e.path.slice(0, slash)));
    (parent?.children ?? root).push(node);
  }
  const sortAll = (nodes: TreeNode[]) => {
    nodes.sort(byFoldersThenName);
    nodes.forEach((n) => sortAll(n.children));
  };
  sortAll(root);
  return root;
}

/** An open Text File. The editor keeps each Tab's editor state (cursor,
 * undo history) keyed by this object, so a reopened file is a new Tab. */
export type Tab = {
  readonly path: string;
  /** The file as it was opened. */
  readonly file: OpenedFile;
  /** The editor's content: the Draft, when it differs from what's saved. */
  readonly doc: Accessor<Text>;
  /** The Dropbox revision of the content last opened or saved. */
  readonly rev: Accessor<string>;
  /** Whether the Tab has a Draft. */
  readonly modified: Accessor<boolean>;
};

/** What the app state, but nothing else, can do to a Tab. */
type TabControls = {
  edit(doc: Text): void;
  saved(doc: Text, rev: string): void;
  /** Replaces the content with the file as Dropbox has it now, dropping
   * any Draft. */
  reload(file: OpenedFile): void;
};

const sameText = (a: Text, b: Text) => a === b || (a.length === b.length && a.eq(b));

const textOf = (file: OpenedFile) => Text.of(file.content.split("\n"));

function createTab(file: OpenedFile): [Tab, TabControls] {
  const opened = textOf(file);
  const [doc, setDoc] = createSignal(opened);
  const [saved, setSaved] = createSignal({ doc: opened, rev: file.rev });
  const [modified, setModified] = createSignal(false);
  const tab: Tab = { path: file.path, file, doc, rev: () => saved().rev, modified };
  return [
    tab,
    {
      edit(next) {
        batch(() => {
          setDoc(next);
          setModified(!sameText(next, saved().doc));
        });
      },
      saved(savedDoc, rev) {
        batch(() => {
          setSaved({ doc: savedDoc, rev });
          setModified(!sameText(doc(), savedDoc));
        });
      },
      reload(next) {
        const text = textOf(next);
        batch(() => {
          setSaved({ doc: text, rev: next.rev });
          setDoc(text);
          setModified(false);
        });
      },
    },
  ];
}

/** The last segment of a path. */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The message for a save that failed. The Draft is always kept. */
function saveFailure(tab: Tab, e: unknown) {
  const name = fileName(tab.path);
  const why = e instanceof Error ? e.message : String(e);
  return `Couldn't save ${name}: ${why} Your Draft is kept; save again to retry.`;
}

const parentFolders = (path: string) => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

/** A save Dropbox refused because the file changed there: the Tab, and the
 * revision Dropbox has now. */
export type SaveConflict = { tab: Tab; rev: string };

export type ConflictChoice = "overwrite" | "reload" | "copy" | "cancel";

export function createAppState() {
  const [entries, setEntries] = createSignal<TreeEntry[]>([]);
  const [binary, setBinary] = createSignal<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [tabs, setTabs] = createSignal<readonly Tab[]>([]);
  const [activeKey, setActiveKey] = createSignal<string>();
  const [previewKey, setPreviewKey] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  const [conflict, setConflict] = createSignal<SaveConflict>();

  const controls = new WeakMap<Tab, TabControls>();
  // Tabs being saved, so a second Ctrl+S doesn't send the same save twice.
  const saving = new WeakSet<Tab>();

  // For each Tab with a Draft, the outside revision the Owner was last told
  // about, so a focus check doesn't repeat the notice.
  const noticed = new WeakMap<Tab, string>();
  let checking = false;

  // Opens in flight, so a double click (which also clicks twice) fetches once.
  const pending = new Map<string, Promise<OpenedFile>>();

  // The last open asked for: an earlier one that loads after it is dropped.
  let latestOpen = 0;

  const isAt = (key: string | undefined) => (t: Tab) => pathKey(t.path) === key;
  const indexOf = (path: string) => tabs().findIndex(isAt(pathKey(path)));
  const activeTab = createMemo(() => tabs().find(isAt(activeKey())));

  // Reveal the file in the tree when its Tab becomes active. Only then: the
  // Owner may still collapse its folders afterwards.
  createEffect(
    on(activeTab, (tab) => {
      if (!tab) return;
      const open = expanded();
      const missing = parentFolders(tab.path).filter((p) => !open.has(pathKey(p)));
      if (missing.length) setExpanded(new Set([...open, ...missing.map(pathKey)]));
    }),
  );

  const activateAt = (index: number) => {
    const tab = tabs()[index];
    if (tab) setActiveKey(pathKey(tab.path));
  };

  const pin = (path: string) => {
    if (previewKey() === pathKey(path)) setPreviewKey(undefined);
  };

  const fetchFile = (path: string) => {
    const key = pathKey(path);
    let p = pending.get(key);
    if (!p) {
      p = api.openFile(path).finally(() => pending.delete(key));
      pending.set(key, p);
    }
    return p;
  };

  const tree = createMemo(() => buildTree(entries(), binary()));

  /** The rows currently visible in the sidebar, in order. */
  const visibleRows = createMemo(() => {
    const rows: TreeNode[] = [];
    const open = expanded();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        rows.push(n);
        if (n.kind === "folder" && open.has(pathKey(n.path))) walk(n.children);
      }
    };
    walk(tree());
    return rows;
  });

  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const isOpen = (tab: Tab) => tabs().includes(tab);

  /** Saves the Tab's current Draft over rev. A Save Conflict opens the
   * conflict dialog; any other failure keeps the Draft and says why. */
  async function saveOver(tab: Tab, rev: string) {
    const doc = tab.doc();
    saving.add(tab);
    try {
      const res = await api.saveFile(tab.path, doc.toString(), rev);
      controls.get(tab)?.saved(doc, res.rev);
      setError(undefined);
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict" && e.rev) {
        setError(undefined);
        setConflict({ tab, rev: e.rev });
      } else {
        setError(saveFailure(tab, e));
      }
    } finally {
      saving.delete(tab);
    }
  }

  /** Replaces the Tab's content with the file as Dropbox has it now. */
  async function reloadTab(tab: Tab) {
    const file = await api.openFile(tab.path);
    if (isOpen(tab)) controls.get(tab)?.reload(file);
  }

  async function loadTree() {
    try {
      setEntries(await api.tree());
      setError(undefined);
    } catch (e) {
      report(e);
    }
  }

  /** Opens a file by path and activates its Tab. Unless `pinned`, a file
   * that isn't open yet goes into the Preview Tab, replacing the one there.
   * Returns whether the Tab is now open; a failure is reported. */
  async function openPath(path: string, { pinned = false } = {}): Promise<boolean> {
    const ticket = ++latestOpen;
    try {
      const file = indexOf(path) < 0 ? await fetchFile(path) : undefined;
      if (ticket !== latestOpen) return indexOf(path) >= 0;
      const key = pathKey(path);
      batch(() => {
        // Checked again after the fetch: another open may have got there first.
        if (file && indexOf(path) < 0) {
          const [tab, control] = createTab(file);
          controls.set(tab, control);
          const previewPath = previewKey();
          const preview = previewPath ? indexOf(previewPath) : -1;
          const next = [...tabs()];
          if (!pinned && preview >= 0) next[preview] = tab;
          else next.push(tab);
          setTabs(next);
          if (!pinned) setPreviewKey(key);
        } else if (pinned) {
          pin(path);
        }
        setActiveKey(key);
      });
      setError(undefined);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "binary-file") {
        setBinary(new Set(binary()).add(pathKey(path)));
      }
      report(e);
      return false;
    }
  }

  /** Saves the Tab's Draft as a copy next to its file and opens the copy.
   * Only once the copy is open does the Tab go back to Dropbox's version:
   * the Draft then lives on in the copy. */
  async function saveAsCopy(tab: Tab) {
    const copy = await api.saveCopy(tab.path, tab.doc().toString());
    await loadTree();
    if (await openPath(copy.path, { pinned: true })) await reloadTab(tab);
  }

  /** Checks one Tab's file for a change made outside the app. */
  async function checkTab(tab: Tab) {
    if (saving.has(tab)) return;
    const known = tab.rev();
    const rev = await api.checkFile(tab.path);
    // A save that finished meanwhile moved the Tab on: this answer is stale.
    if (rev === known || tab.rev() !== known || saving.has(tab) || !isOpen(tab)) return;
    if (!tab.modified()) {
      const file = await api.openFile(tab.path);
      // The Owner may have started typing meanwhile: then it has a Draft.
      if (!tab.modified() && !saving.has(tab) && isOpen(tab)) controls.get(tab)?.reload(file);
      else if (isOpen(tab)) noticeOutsideChange(tab, rev);
      return;
    }
    noticeOutsideChange(tab, rev);
  }

  function noticeOutsideChange(tab: Tab, rev: string) {
    if (noticed.get(tab) === rev) return;
    noticed.set(tab, rev);
    setError(
      `${fileName(tab.path)} changed in Dropbox since you opened it. Your Draft is kept; ` +
        "saving it will ask whether to overwrite, reload or save a copy.",
    );
  }

  return {
    visibleRows,
    tabs,
    activeTab,
    error,
    isExpanded: (path: string) => expanded().has(pathKey(path)),
    isActive: (path: string) => activeKey() === pathKey(path),
    isPreview: (path: string) => previewKey() === pathKey(path),
    pin,
    activate: (path: string) => activateAt(indexOf(path)),
    /** Activates the Tab `delta` places along, wrapping around. */
    cycle(delta: number) {
      const n = tabs().length;
      if (n) activateAt((((indexOf(activeKey() ?? "") + delta) % n) + n) % n);
    },
    /** Activates the Tab at a 0-based position, if there is one. */
    activateAt,

    /** Records an edit made in a Tab's editor. Editing the Preview Tab pins it. */
    edit(tab: Tab, doc: Text) {
      batch(() => {
        controls.get(tab)?.edit(doc);
        pin(tab.path);
      });
    },

    /** Saves the active Tab's Draft to Dropbox over the revision it was
     * opened at. A Save Conflict opens the conflict dialog; any other failure
     * keeps the Draft and reports why. */
    async save() {
      const tab = activeTab();
      if (!tab || !tab.modified() || saving.has(tab) || conflict()) return;
      await saveOver(tab, tab.rev());
    },

    /** The Save Conflict waiting for the Owner's choice, if any. */
    conflict,

    /** Resolves the Save Conflict with the Owner's choice: overwrite Dropbox's
     * version with the Draft, reload Dropbox's version over the Draft, save
     * the Draft as a copy next to the file (and open it, the Tab going back
     * to Dropbox's version), or cancel and keep the Draft as it is. */
    async resolveConflict(choice: ConflictChoice) {
      const c = conflict();
      if (!c) return;
      setConflict(undefined);
      const { tab } = c;
      if (choice === "cancel" || !isOpen(tab)) return;
      try {
        if (choice === "overwrite") return await saveOver(tab, c.rev);
        if (choice === "reload") {
          await reloadTab(tab);
          setError(undefined);
          return;
        }
        await saveAsCopy(tab);
      } catch (e) {
        report(e);
      }
    },

    /** Checks every open Tab for changes made in Dropbox: one without a
     * Draft quietly reloads, one with a Draft keeps it and the Owner is
     * told. Run when the window regains focus. */
    async checkOutsideChanges() {
      if (checking) return;
      checking = true;
      try {
        // A failed check (offline, file deleted) says nothing; saving reports it.
        await Promise.all(tabs().map((tab) => checkTab(tab).catch(() => {})));
      } finally {
        checking = false;
      }
    },

    /** Closes a Tab; the Tab to its right (else its left) becomes active. A
     * Tab with a Draft closes only if the Owner confirms discarding it. */
    close(path: string) {
      const i = indexOf(path);
      if (i < 0) return;
      const tab = tabs()[i];
      if (tab.modified() && !confirm(`Discard your Draft of ${fileName(tab.path)}?`)) return;
      const key = pathKey(path);
      batch(() => {
        const rest = tabs().filter((_, j) => j !== i);
        setTabs(rest);
        pin(path);
        if (activeKey() === key) {
          const next = rest[Math.min(i, rest.length - 1)];
          setActiveKey(next && pathKey(next.path));
        }
      });
    },

    /** Loads (or reloads) the tree from Dropbox. */
    loadTree,

    toggleFolder(path: string) {
      const key = pathKey(path);
      const next = new Set(expanded());
      if (!next.delete(key)) next.add(key);
      setExpanded(next);
    },

    closeActive() {
      const tab = activeTab();
      if (tab) this.close(tab.path);
    },

    /** Opens a file from the tree; see openPath. */
    async open(node: TreeNode, options: { pinned?: boolean } = {}) {
      if (node.kind === "file" && !node.unopenable) await openPath(node.path, options);
    },
  };
}

export type AppState = ReturnType<typeof createAppState>;
