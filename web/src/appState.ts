// App state: the tree, which folders are expanded, which files turned
// out to be binary this session, and the open Tabs (which one is active, and
// which one, if any, is the Preview Tab).

import { batch, createEffect, createMemo, createSignal, on } from "solid-js";
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

/** An open Text File. Until Drafts get their own store, its edits live only
 * in the editor's state for the Tab (see Editor), which is keyed by this
 * object: a reopened file is a new Tab. */
export type Tab = {
  readonly path: string;
  readonly file: OpenedFile;
};

const parentFolders = (path: string) => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

export function createAppState() {
  const [entries, setEntries] = createSignal<TreeEntry[]>([]);
  const [binary, setBinary] = createSignal<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [tabs, setTabs] = createSignal<readonly Tab[]>([]);
  const [activeKey, setActiveKey] = createSignal<string>();
  const [previewKey, setPreviewKey] = createSignal<string>();
  const [error, setError] = createSignal<string>();

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

    /** Closes a Tab; the Tab to its right (else its left) becomes active. */
    close(path: string) {
      const i = indexOf(path);
      if (i < 0) return;
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

    async loadTree() {
      try {
        setEntries(await api.tree());
        setError(undefined);
      } catch (e) {
        report(e);
      }
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

    /** Opens a file and activates its Tab. Unless `pinned`, a file that isn't
     * open yet goes into the Preview Tab, replacing the one there. */
    async open(node: TreeNode, { pinned = false } = {}) {
      if (node.kind !== "file" || node.unopenable) return;
      const ticket = ++latestOpen;
      try {
        const file = indexOf(node.path) < 0 ? await fetchFile(node.path) : undefined;
        if (ticket !== latestOpen) return;
        const key = pathKey(node.path);
        batch(() => {
          // Checked again after the fetch: another open may have got there first.
          if (file && indexOf(node.path) < 0) {
            const tab: Tab = { path: file.path, file };
            const previewPath = previewKey();
            const preview = previewPath ? indexOf(previewPath) : -1;
            const next = [...tabs()];
            if (!pinned && preview >= 0) next[preview] = tab;
            else next.push(tab);
            setTabs(next);
            if (!pinned) setPreviewKey(key);
          } else if (pinned) {
            pin(node.path);
          }
          setActiveKey(key);
        });
        setError(undefined);
      } catch (e) {
        if (e instanceof ApiError && e.code === "binary-file") {
          setBinary(new Set(binary()).add(pathKey(node.path)));
        }
        report(e);
      }
    },
  };
}

export type AppState = ReturnType<typeof createAppState>;
