// Typed wrapper over the JSON API. Failures become ApiError with the
// server's machine-readable code.

export type TreeEntry = {
  path: string; // relative to the Root Folder, display case
  kind: "file" | "folder";
  size?: number;
  openable?: boolean;
  reason?: "too-large";
};

export type OpenedFile = {
  path: string;
  content: string; // always LF
  rev: string;
  lineEnding: "lf" | "crlf";
  trailingNewline: boolean;
  bom: boolean;
};

export type ErrorCode =
  | "unauthorized"
  | "reauthorize"
  | "forbidden-origin"
  | "invalid-path"
  | "not-found"
  | "not-a-file"
  | "too-large"
  | "binary-file"
  | "conflict"
  | "dropbox-unavailable"
  | "network"
  | (string & {});

export type SavedFile = { path: string; rev: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    /** For a Save Conflict, the file's current revision in Dropbox. */
    readonly rev?: string,
  ) {
    super(message);
  }
}

/** Why the Owner has to sign in (again): the session ended, or Dropbox no
 * longer accepts the app's authorization. */
export type AuthLost = "unauthorized" | "reauthorize";

const isAuthLost = (code: ErrorCode): code is AuthLost => code === "unauthorized" || code === "reauthorize";

let onAuthLost: (why: AuthLost) => void = () => {};

/** Sets what happens when an API call finds the Owner signed out. */
export function setAuthLostHandler(handler: (why: AuthLost) => void) {
  onAuthLost = handler;
}

async function requestJSON<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Accept: "application/json", ...init.headers } });
  } catch {
    throw new ApiError(0, "network", "The server could not be reached.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code: ErrorCode = body?.code ?? "internal";
    if (res.status === 401 && isAuthLost(code)) onAuthLost(code);
    throw new ApiError(res.status, code, body?.message ?? res.statusText, body?.rev);
  }
  return body as T;
}

const getJSON = <T>(url: string) => requestJSON<T>(url);

export const api = {
  async signedIn(): Promise<boolean> {
    return (await getJSON<{ signedIn: boolean }>("/api/session")).signedIn;
  },
  async tree(): Promise<TreeEntry[]> {
    return (await getJSON<{ entries: TreeEntry[] }>("/api/tree")).entries;
  },
  openFile(path: string): Promise<OpenedFile> {
    return getJSON(`/api/file?path=${encodeURIComponent(path)}`);
  },
  /** The file's current revision in Dropbox, to tell whether it changed. */
  async checkFile(path: string): Promise<string> {
    return (await getJSON<SavedFile>(`/api/file/rev?path=${encodeURIComponent(path)}`)).rev;
  },
  /** Saves LF content as a new "conflicted copy" next to the file, leaving
   * the file itself alone. Returns the copy's path and revision. */
  saveCopy(path: string, content: string): Promise<SavedFile> {
    return requestJSON("/api/file/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
  },
  /** Saves LF content over the revision the file was opened (or last saved)
   * at. The server puts back the file's own line endings. Fails with code
   * "conflict" (and the current revision) if the file changed in Dropbox. */
  saveFile(path: string, content: string, rev: string): Promise<SavedFile> {
    return requestJSON("/api/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, rev }),
    });
  },
};
