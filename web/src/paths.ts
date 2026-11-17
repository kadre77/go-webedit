/** Dropbox paths are case-insensitive: compare and key paths through this. */
export const pathKey = (path: string) => path.toLowerCase();

/** Whether path is root itself or inside it, in any case. */
export const isUnder = (path: string, root: string) => {
  const p = pathKey(path);
  const r = pathKey(root);
  return p === r || p.startsWith(`${r}/`);
};

/** Where path is after root moved to `to`: path itself if it isn't under root. */
export const movedPath = (path: string, root: string, to: string) =>
  isUnder(path, root) ? to + path.slice(root.length) : path;

/** The folder holding path: "" for the Root Folder. */
export const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
