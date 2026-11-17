// App state: the tree, which folders are expanded, which files turned
// out to be binary this session, and the open file.

import { createMemo, createSignal } from "solid-js";
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

export function createAppState() {
  const [entries, setEntries] = createSignal<TreeEntry[]>([]);
  const [binary, setBinary] = createSignal<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [openFile, setOpenFile] = createSignal<OpenedFile>();
  const [error, setError] = createSignal<string>();

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
    openFile,
    error,
    isExpanded: (path: string) => expanded().has(pathKey(path)),
    isOpen: (path: string) => {
      const file = openFile();
      return !!file && pathKey(file.path) === pathKey(path);
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

    async open(node: TreeNode) {
      if (node.kind !== "file" || node.unopenable) return;
      try {
        setOpenFile(await api.openFile(node.path));
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
