// An in-memory Root Folder behind the RootFolderApi, for tests of the App
// state. It behaves as the server does over the Go fake Dropbox
// (internal/dropbox/fake.go): revisions, a Save Conflict on a stale or
// missing file, case-insensitive paths, parents created as needed. A test
// can hold any call before it reaches the Root Folder and release it later,
// to set up races. Only tests import this.

import { ApiError, type ChangedEntry, type OpenedFile, type RootFolderApi, type SavedFile, type TreeEntry } from "../api";
import { fileName, folderOf, isUnder, movedPath, pathKey } from "../paths";

type Node = { path: string; kind: "file" | "folder"; content: string; rev: string };

type Method = keyof RootFolderApi;

/** A held call: `reached` settles once the App state has made the call,
 * and the call goes on to the Root Folder only after `release()`. */
export type HeldCall = { reached: Promise<void>; release(): void };

const notFound = (path: string) => new ApiError(404, "not-found", `${path} was not found.`);
const alreadyExists = (path: string) => new ApiError(409, "already-exists", `Something is already at ${path}.`);

export class FakeRootFolder implements RootFolderApi {
  private nodes = new Map<string, Node>();
  private revs = 0;
  private holds = new Map<Method, { reached(): void; released: Promise<void> }[]>();
  private counts = new Map<Method, number>();

  /** A Root Folder holding these Text Files, by path. */
  constructor(files: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(files)) this.write(path, content);
  }

  /** Writes a file as another device would: a new revision, or a new file. */
  write(path: string, content: string): string {
    this.addParents(path);
    const existing = this.nodes.get(pathKey(path));
    const rev = this.nextRev();
    this.nodes.set(pathKey(path), { path: existing?.path ?? path, kind: "file", content, rev });
    return rev;
  }

  /** The file's content as the Root Folder has it, if it is there. */
  content(path: string): string | undefined {
    return this.nodes.get(pathKey(path))?.content;
  }

  /** How many times the App state has made this call. */
  calls(method: Method): number {
    return this.counts.get(method) ?? 0;
  }

  /** Holds the next call to method; see HeldCall. */
  hold(method: Method): HeldCall {
    let reached!: () => void;
    let release!: () => void;
    const reachedP = new Promise<void>((r) => (reached = r));
    const released = new Promise<void>((r) => (release = r));
    this.holds.set(method, [...(this.holds.get(method) ?? []), { reached, released }]);
    return { reached: reachedP, release };
  }

  private async call<T>(method: Method, run: () => T): Promise<T> {
    this.counts.set(method, this.calls(method) + 1);
    const [held, ...rest] = this.holds.get(method) ?? [];
    if (held) {
      this.holds.set(method, rest);
      held.reached();
      await held.released;
    }
    return run();
  }

  private nextRev() {
    return `rev${++this.revs}`;
  }

  private addParents(path: string) {
    for (let p = folderOf(path); p; p = folderOf(p)) {
      if (!this.nodes.has(pathKey(p))) this.nodes.set(pathKey(p), { path: p, kind: "folder", content: "", rev: "" });
    }
  }

  private file(path: string): Node {
    const n = this.nodes.get(pathKey(path));
    if (!n) throw notFound(path);
    if (n.kind !== "file") throw new ApiError(400, "not-a-file", `${path} is a folder.`);
    return n;
  }

  private create(path: string, kind: Node["kind"]): ChangedEntry {
    if (this.nodes.has(pathKey(path))) throw alreadyExists(path);
    this.addParents(path);
    const node: Node = { path, kind, content: "", rev: kind === "file" ? this.nextRev() : "" };
    this.nodes.set(pathKey(path), node);
    return kind === "file" ? { path, kind, rev: node.rev } : { path, kind };
  }

  tree(): Promise<TreeEntry[]> {
    return this.call("tree", () =>
      [...this.nodes.values()].map((n): TreeEntry =>
        n.kind === "folder"
          ? { path: n.path, kind: "folder" }
          : { path: n.path, kind: "file", size: n.content.length, openable: true },
      ),
    );
  }

  openFile(path: string): Promise<OpenedFile> {
    return this.call("openFile", () => {
      const n = this.file(path);
      return { path: n.path, content: n.content, rev: n.rev, lineEnding: "lf", trailingNewline: true, bom: false };
    });
  }

  checkFile(path: string): Promise<string> {
    return this.call("checkFile", () => this.file(path).rev);
  }

  saveFile(path: string, content: string, rev: string): Promise<SavedFile> {
    return this.call("saveFile", () => {
      const n = this.nodes.get(pathKey(path));
      // As Dropbox: a save over a stale revision, or a file gone, conflicts.
      if (!n || n.kind !== "file" || n.rev !== rev)
        throw new ApiError(409, "conflict", `${path} changed in Dropbox.`, n?.kind === "file" ? n.rev : undefined);
      n.content = content;
      n.rev = this.nextRev();
      return { path: n.path, rev: n.rev };
    });
  }

  saveCopy(path: string, content: string): Promise<SavedFile> {
    return this.call("saveCopy", () => {
      const name = fileName(path);
      const dot = name.lastIndexOf(".");
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
      const folder = folderOf(path);
      let copy = "";
      for (let i = 1; !copy || this.nodes.has(pathKey(copy)); i++) {
        const n = `${stem} (conflicted copy${i > 1 ? ` ${i}` : ""})${ext}`;
        copy = folder ? `${folder}/${n}` : n;
      }
      const rev = this.write(copy, content);
      return { path: copy, rev };
    });
  }

  createFile(path: string): Promise<ChangedEntry> {
    return this.call("createFile", () => this.create(path, "file"));
  }

  createFolder(path: string): Promise<ChangedEntry> {
    return this.call("createFolder", () => this.create(path, "folder"));
  }

  move(from: string, to: string): Promise<ChangedEntry> {
    return this.call("move", () => {
      const n = this.nodes.get(pathKey(from));
      if (!n) throw notFound(from);
      // A change of case only is fine.
      if (pathKey(from) !== pathKey(to) && this.nodes.has(pathKey(to))) throw alreadyExists(to);
      const moving = [...this.nodes.values()].filter((m) => isUnder(m.path, n.path));
      for (const m of moving) this.nodes.delete(pathKey(m.path));
      this.addParents(to);
      for (const m of moving) {
        const path = movedPath(m.path, n.path, to);
        this.nodes.set(pathKey(path), { ...m, path });
      }
      return n.kind === "file" ? { path: to, kind: "file", rev: n.rev } : { path: to, kind: "folder" };
    });
  }

  deleteEntry(path: string): Promise<void> {
    return this.call("deleteEntry", () => {
      if (!this.nodes.has(pathKey(path))) throw notFound(path);
      for (const m of [...this.nodes.values()]) if (isUnder(m.path, path)) this.nodes.delete(pathKey(m.path));
    });
  }
}
