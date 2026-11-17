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

async function getJSON<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, "network", "The server could not be reached.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? "internal", body?.message ?? res.statusText);
  }
  return body as T;
}

export const api = {
  async tree(): Promise<TreeEntry[]> {
    return (await getJSON<{ entries: TreeEntry[] }>("/api/tree")).entries;
  },
  openFile(path: string): Promise<OpenedFile> {
    return getJSON(`/api/file?path=${encodeURIComponent(path)}`);
  },
};
