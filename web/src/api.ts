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
  | "dropbox-unavailable"
  | "network"
  | (string & {});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
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

async function getJSON<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, "network", "The server could not be reached.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code: ErrorCode = body?.code ?? "internal";
    if (res.status === 401 && isAuthLost(code)) onAuthLost(code);
    throw new ApiError(res.status, code, body?.message ?? res.statusText);
  }
  return body as T;
}

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
};
