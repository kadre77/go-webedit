// App state: the tree, which folders are expanded, which files turned
// out to be binary this session, and the open Tabs (which one is active,
// which one, if any, is the Preview Tab, and each one's Draft and revision).
// It also owns the Save Conflict and outside-change rules, and keeps Drafts
// and the open Tabs in the draft store so they survive a reload.

import { Text } from "@codemirror/state";
import { type Accessor, batch, createEffect, createMemo, createSignal, on } from "solid-js";
import { api, ApiError, type ChangedEntry, type OpenedFile, type TreeEntry } from "./api";
import { createDraftStore, type StoredDraft } from "./draftStore";
import { fileName, folderOf, isUnder, movedPath, pathKey } from "./paths";

export { pathKey };

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
    const node: TreeNode = {
      path: e.path,
      name: fileName(e.path),
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
    const parent = folders.get(pathKey(folderOf(e.path)));
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
  /** Where the file is now: it follows a rename or move. Reactive. */
  readonly path: string;
  /** The file as it was opened (at the path it had then). */
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
  /** The file was renamed or moved to path. */
  moved(path: string): void;
};

const sameText = (a: Text, b: Text) => a === b || (a.length === b.length && a.eq(b));

const textOf = (content: string) => Text.of(content.split("\n"));

/** A new Tab on the file, holding the stored Draft if there is one: the
 * Draft's content, and the revision it was opened at, so a file changed since
 * still raises a Save Conflict. onChange runs after every change to the Tab. */
function createTab(file: OpenedFile, draft: StoredDraft | undefined, onChange: (tab: Tab) => void): [Tab, TabControls] {
  const opened = textOf(file.content);
  const start = draft ? textOf(draft.content) : opened;
  const [doc, setDoc] = createSignal(start);
  const [saved, setSaved] = createSignal({ doc: opened, rev: draft?.rev ?? file.rev });
  const [modified, setModified] = createSignal(!sameText(start, opened));
  const [path, setPath] = createSignal(file.path);
  const tab: Tab = {
    get path() {
      return path();
    },
    file,
    doc,
    rev: () => saved().rev,
    modified,
  };
  return [
    tab,
    {
      edit(next) {
        batch(() => {
          setDoc(next);
          setModified(!sameText(next, saved().doc));
        });
        onChange(tab);
      },
      saved(savedDoc, rev) {
        batch(() => {
          setSaved({ doc: savedDoc, rev });
          setModified(!sameText(doc(), savedDoc));
        });
        onChange(tab);
      },
      reload(next) {
        const text = textOf(next.content);
        batch(() => {
          setSaved({ doc: text, rev: next.rev });
          setDoc(text);
          setModified(false);
        });
        onChange(tab);
      },
      moved(next) {
        setPath(next);
      },
    },
  ];
}

/** Stands in for a file that couldn't be opened, so its Draft can still be
 * shown in a Tab. */
const unopenedFile = (path: string, rev: string): OpenedFile => ({
  path,
  content: "",
  rev,
  lineEnding: "lf",
  trailingNewline: true,
  bom: false,
});

/** Whether a failure may pass if tried again: the server or Dropbox
 * couldn't be reached, or failed for its own reasons. */
const transient = (e: ApiError) => e.code === "network" || e.code === "dropbox-unavailable" || e.status >= 500;

/** A file loaded for a new Tab, with its stored Draft. A file that couldn't
 * be opened still loads if it has a Draft: then `unopened` says why. */
type Loaded =
  | { file: OpenedFile; draft?: StoredDraft; unopened?: undefined }
  | { file: OpenedFile; draft: StoredDraft; unopened: "gone" | ApiError };

/** How long typing pauses before the Draft is written to browser storage. */
const draftDelay = 300;


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

/** The entries with path added, and any of its parent folders missing from
 * them (Dropbox creates those), in place of anything already at path. */
function withEntry(entries: readonly TreeEntry[], entry: TreeEntry): TreeEntry[] {
  const known = new Set(entries.map((e) => pathKey(e.path)));
  const parents = parentFolders(entry.path)
    .filter((p) => !known.has(pathKey(p)))
    .map((p): TreeEntry => ({ path: p, kind: "folder" }));
  return [...entries.filter((e) => pathKey(e.path) !== pathKey(entry.path)), ...parents, entry];
}

/** The tree entry for a newly created file or folder. */
const createdEntry = (e: ChangedEntry): TreeEntry =>
  e.kind === "folder" ? { path: e.path, kind: "folder" } : { path: e.path, kind: "file", size: 0, openable: true };

/** A set of path keys with those at or under `from` moved under `to`. */
const movedKeys = (keys: ReadonlySet<string>, from: string, to: string) =>
  new Set([...keys].map((k) => movedPath(k, pathKey(from), pathKey(to))));

export function createAppState() {
  const store = createDraftStore();
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

  // Until the stored Tabs are restored, the open Tabs aren't written back,
  // so a slow restore can't overwrite them.
  const [restored, setRestored] = createSignal(false);

  // Draft writes waiting for typing to pause, by Tab.
  const draftWrites = new Map<Tab, ReturnType<typeof setTimeout>>();

  const isAt = (key: string | undefined) => (t: Tab) => pathKey(t.path) === key;
  const indexOf = (path: string) => tabs().findIndex(isAt(pathKey(path)));
  const activeTab = createMemo(() => tabs().find(isAt(activeKey())));

  /** Expands the folders above path, so it shows in the tree. */
  const reveal = (path: string) => {
    const open = expanded();
    const missing = parentFolders(path).filter((p) => !open.has(pathKey(p)));
    if (missing.length) setExpanded(new Set([...open, ...missing.map(pathKey)]));
  };

  // Reveal the file in the tree when its Tab becomes active. Only then: the
  // Owner may still collapse its folders afterwards.
  createEffect(on(activeTab, (tab) => tab && reveal(tab.path)));

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

  /** Every Text File in the tree, by path. */
  const textFiles = createMemo(() => {
    const paths: string[] = [];
    const walk = (nodes: TreeNode[]) =>
      nodes.forEach((n) => (n.kind === "folder" ? walk(n.children) : n.unopenable || paths.push(n.path)));
    walk(tree());
    return paths;
  });

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

  // Remembers the open Tabs and the active one, once those stored from last
  // time are back.
  createEffect(() => {
    if (!restored()) return;
    store.saveOpenTabs({
      tabs: tabs().map((t) => ({ path: t.path, preview: previewKey() === pathKey(t.path) })),
      active: activeTab()?.path,
    });
  });

  function cancelDraftWrite(tab: Tab) {
    clearTimeout(draftWrites.get(tab));
    draftWrites.delete(tab);
  }

  /** Writes the Tab's Draft now; `leaving` as for the draft store. */
  function writeDraft(tab: Tab, leaving = false) {
    cancelDraftWrite(tab);
    if (isOpen(tab) && tab.modified())
      store.saveDraft(tab.path, { content: tab.doc().toString(), rev: tab.rev() }, leaving);
  }

  /** Keeps the stored Draft in step with the Tab: written once typing
   * pauses, dropped at once when the Tab no longer has a Draft. */
  function storeDraft(tab: Tab) {
    cancelDraftWrite(tab);
    if (!tab.modified()) return store.dropDraft(tab.path);
    draftWrites.set(tab, setTimeout(() => writeDraft(tab), draftDelay));
  }

  /** Fetches a file for a new Tab, with its stored Draft. A file with a
   * Draft still loads when it's no longer in Dropbox, or Dropbox can't be
   * reached, so the Draft isn't lost from view. */
  async function load(path: string): Promise<Loaded> {
    const fetched = fetchFile(path).then(
      (file) => ({ file }),
      (error: unknown) => ({ error }),
    );
    const draft = await store.draft(path);
    const result = await fetched;
    if ("file" in result) return { file: result.file, draft };
    const { error } = result;
    if (!draft || !(error instanceof ApiError) || (error.code !== "not-found" && !transient(error))) throw error;
    const unopened = error.code === "not-found" ? "gone" : error;
    return { file: unopenedFile(path, draft.rev), draft, unopened };
  }

  /** Makes a Tab for a loaded file. A stored Draft that matches the opened
   * file is no Draft at all, and is dropped. */
  function tabFor({ file, draft, unopened }: Loaded): Tab {
    const [tab, control] = createTab(file, draft, storeDraft);
    controls.set(tab, control);
    if (draft && !unopened && !tab.modified()) store.dropDraft(file.path);
    return tab;
  }

  /** Tells the Owner about a Tab whose Draft came back from storage onto a
   * file that has changed or gone since, or that couldn't be opened. */
  function noticeRestored(tab: Tab, loaded: Loaded) {
    const name = fileName(tab.path);
    if (loaded.unopened === "gone") {
      setError(`${name} is no longer in Dropbox. Your Draft is kept here until you close its Tab.`);
    } else if (loaded.unopened) {
      setError(`Couldn't open ${name}: ${loaded.unopened.message} Your Draft is kept; save it once Dropbox is back.`);
    } else if (tab.modified() && tab.rev() !== loaded.file.rev) {
      noticeOutsideChange(tab, loaded.file.rev);
    }
  }

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
      const loaded = indexOf(path) < 0 ? await load(path) : undefined;
      if (ticket !== latestOpen) return indexOf(path) >= 0;
      const key = pathKey(path);
      // Checked again after the fetch: another open may have got there first.
      const tab = loaded && indexOf(path) < 0 ? tabFor(loaded) : undefined;
      batch(() => {
        if (tab) {
          // A Tab with a Draft is never a Preview Tab: the next click would drop it.
          const preview = !pinned && !tab.modified();
          const previewPath = previewKey();
          const previewAt = previewPath ? indexOf(previewPath) : -1;
          const next = [...tabs()];
          if (preview && previewAt >= 0) next[previewAt] = tab;
          else next.push(tab);
          setTabs(next);
          if (preview) setPreviewKey(key);
        } else if (pinned) {
          pin(path);
        }
        setActiveKey(key);
      });
      setError(undefined);
      if (tab && loaded) noticeRestored(tab, loaded);
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
    textFiles,
    tabs,
    activeTab,
    error,
    /** Shows a failure in the notice. */
    report,
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
      cancelDraftWrite(tab);
      store.dropDraft(tab.path);
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

    /** Creates an empty file at path, adds it to the tree and opens it in a
     * normal Tab. Fails (with an ApiError) if anything is at the path. */
    async createFile(path: string) {
      const created = await api.createFile(path);
      setEntries(withEntry(entries(), createdEntry(created)));
      await openPath(created.path, { pinned: true });
    },

    /** Creates a folder at path and shows it in the tree. Fails (with an
     * ApiError) if anything is at the path. */
    async createFolder(path: string) {
      const created = await api.createFolder(path);
      batch(() => {
        setEntries(withEntry(entries(), createdEntry(created)));
        reveal(created.path);
      });
    },

    /** Renames or moves a file or folder. Every open Tab and stored Draft
     * at or under it follows to the new path. Fails (with an ApiError) if the
     * destination is taken. */
    async move(from: string, to: string) {
      const moved = await api.move(from, to);
      to = moved.path;
      // The tree's own case for `from`, so the rest of each path keeps its case.
      from = entries().find((e) => pathKey(e.path) === pathKey(from))?.path ?? from;
      const follow = (p: string) => movedPath(p, from, to);
      store.moveDrafts(from, to);
      batch(() => {
        const kept = entries().filter((e) => !isUnder(e.path, from));
        const carried = entries()
          .filter((e) => isUnder(e.path, from))
          .map((e) => ({ ...e, path: follow(e.path) }));
        setEntries(carried.reduce(withEntry, kept));
        setExpanded(movedKeys(expanded(), from, to));
        setBinary(movedKeys(binary(), from, to));
        for (const tab of tabs()) {
          if (isUnder(tab.path, from)) controls.get(tab)?.moved(follow(tab.path));
        }
        const active = activeKey();
        if (active) setActiveKey(pathKey(follow(active)));
        const preview = previewKey();
        if (preview) setPreviewKey(pathKey(follow(preview)));
        reveal(to);
      });
      // Drafts waiting to be written go to the new path now.
      for (const tab of tabs()) if (isUnder(tab.path, to)) writeDraft(tab);
      setError(undefined);
    },

    /** Deletes a file or folder (into Dropbox's trash), closes the Tabs of
     * the files at or under it and drops their Drafts. The caller has asked
     * the Owner first. */
    async remove(path: string) {
      await api.deleteEntry(path);
      store.dropDrafts(path);
      batch(() => {
        setEntries(entries().filter((e) => !isUnder(e.path, path)));
        const gone = tabs().filter((t) => isUnder(t.path, path));
        gone.forEach(cancelDraftWrite);
        const rest = tabs().filter((t) => !gone.includes(t));
        if (gone.some((t) => pathKey(t.path) === activeKey())) {
          // The nearest Tab that's left, as when closing the active Tab.
          const at = tabs().findIndex(isAt(activeKey()));
          const next = tabs().slice(at).find((t) => rest.includes(t)) ?? rest[rest.length - 1];
          setActiveKey(next && pathKey(next.path));
        }
        const preview = previewKey();
        if (preview && isUnder(preview, path)) setPreviewKey(undefined);
        setTabs(rest);
      });
      setError(undefined);
    },

    /** The open Tabs at or under path that have Drafts. */
    draftsUnder: (path: string) => tabs().filter((t) => t.modified() && isUnder(t.path, path)),

    /** The folder new files go in by default: the active Tab's. */
    currentFolder: () => {
      const tab = activeTab();
      return tab ? folderOf(tab.path) : "";
    },

    /** Reopens the Tabs that were open when the app was last used in this
     * browser, with their Drafts, and makes the same one active. Tabs whose
     * files can't be opened any more are dropped, unless they have a Draft. */
    async restore() {
      try {
        const stored = await store.openTabs();
        if (!stored) return;
        const results = await Promise.all(
          stored.tabs.map((t) =>
            load(t.path).then(
              (loaded) => ({ ...t, loaded }),
              (e: unknown) => {
                // A file deleted, or turned binary, since is just not reopened.
                if (!(e instanceof ApiError && (e.code === "not-found" || e.code === "binary-file"))) report(e);
                return undefined;
              },
            ),
          ),
        );
        const opened: { tab: Tab; loaded: Loaded }[] = [];
        batch(() => {
          let preview: string | undefined;
          for (const result of results) {
            if (!result || indexOf(result.path) >= 0) continue;
            if (opened.some(({ tab }) => isAt(pathKey(result.path))(tab))) continue;
            const tab = tabFor(result.loaded);
            opened.push({ tab, loaded: result.loaded });
            if (result.preview && !tab.modified()) preview = pathKey(tab.path);
          }
          // Tabs opened while restoring stay, after the restored ones.
          setTabs([...opened.map((o) => o.tab), ...tabs()]);
          if (preview && !previewKey()) setPreviewKey(preview);
          if (!activeKey() && stored.active) activateAt(indexOf(stored.active));
          if (!activeKey()) activateAt(0);
        });
        for (const { tab, loaded } of opened) noticeRestored(tab, loaded);
      } finally {
        setRestored(true);
      }
    },

    /** Whether any open Tab has a Draft. */
    hasDrafts: () => tabs().some((t) => t.modified()),

    /** Writes every Draft still waiting for typing to pause, now: run when
     * the page is being left or hidden. */
    flushDrafts() {
      for (const tab of [...draftWrites.keys()]) writeDraft(tab, true);
    },

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

    /** Opens a Text File by path; see openPath. */
    openFile: openPath,

    /** Opens a file from the tree; see openPath. Says whether it opened. */
    async open(node: TreeNode, options: { pinned?: boolean } = {}): Promise<boolean> {
      return node.kind === "file" && !node.unopenable && (await openPath(node.path, options));
    },
  };
}

export type AppState = ReturnType<typeof createAppState>;
