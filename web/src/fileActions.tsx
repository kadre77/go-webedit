import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { ApiError } from "./api";
import type { AppState } from "./appState";
import { fileName } from "./paths";

// File management: new file, new folder, rename/move and delete, reached
// from the sidebar's context menu and the Command Palette. Create and
// rename ask for a path in the path prompt, which stays open with the reason
// when the server refuses (most often: something is already there). Delete
// asks for confirmation first.

/** What the path prompt is asking for. */
export type PathPrompt =
  | { kind: "new-file"; folder: string }
  | { kind: "new-folder"; folder: string }
  | { kind: "move"; from: string };

export function createFileActions(state: AppState, opts: { focusEditor(): void }) {
  const [prompt, setPrompt] = createSignal<PathPrompt>();
  return {
    /** The open path prompt, if any. */
    prompt,
    closePrompt: () => setPrompt(undefined),
    /** Asks for the path of a new file, starting in folder ("" for the Root Folder). */
    newFile: (folder: string) => setPrompt({ kind: "new-file", folder }),
    /** Asks for the path of a new folder, starting in folder. */
    newFolder: (folder: string) => setPrompt({ kind: "new-folder", folder }),
    /** Asks where to rename or move the file or folder at path. */
    rename: (from: string) => setPrompt({ kind: "move", from }),
    /** Carries out the open prompt with the path given. Throws on failure,
     * leaving the prompt open. */
    async submit(path: string) {
      const p = prompt();
      if (!p) return;
      if (p.kind === "new-file") await state.createFile(path);
      else if (p.kind === "new-folder") await state.createFolder(path);
      else if (path !== p.from) await state.move(p.from, path);
      setPrompt(undefined);
      if (p.kind === "new-file") opts.focusEditor();
    },
    /** Deletes the file or folder at path, once the Owner confirms. */
    async remove(path: string, kind: "file" | "folder") {
      const name = fileName(path);
      const drafts = state.draftsUnder(path);
      const question =
        (kind === "folder" ? `Delete ${name} and everything in it?` : `Delete ${name}?`) +
        " It goes to Dropbox's trash." +
        (drafts.length === 1 ? ` Your Draft of ${fileName(drafts[0].path)} will be discarded.` : "") +
        (drafts.length > 1 ? ` Your Drafts of ${drafts.length} files will be discarded.` : "");
      if (!confirm(question)) return;
      try {
        await state.remove(path);
      } catch (e) {
        state.report(e);
      }
    },
  };
}

export type FileActions = ReturnType<typeof createFileActions>;

const titles = { "new-file": "New File", "new-folder": "New Folder", move: "Rename or Move" } as const;

/** The path as typed, without surrounding spaces or slashes. */
const tidy = (path: string) => path.trim().replace(/^\/+|\/+$/g, "");

/** Why the server refused, in words for the Owner. */
function failure(e: unknown, path: string) {
  if (e instanceof ApiError && e.code === "already-exists") return `${path} already exists.`;
  return e instanceof Error ? e.message : String(e);
}

/** The path prompt: a path, relative to the Root Folder, to create a file or
 * folder at, or to rename or move one to. */
export function PathPromptDialog(props: { actions: FileActions; prompt: PathPrompt }) {
  let dialog!: HTMLDialogElement;
  let input!: HTMLInputElement;
  const [error, setError] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const p = props.prompt;
  const start = p.kind === "move" ? p.from : p.folder ? `${p.folder}/` : "";

  onMount(() => {
    const before = document.activeElement;
    dialog.showModal();
    input.focus();
    // Renaming selects the name without its extension, ready to retype.
    if (p.kind === "move") {
      const name = start.lastIndexOf("/") + 1;
      const dot = start.lastIndexOf(".");
      input.setSelectionRange(name, dot > name ? dot : start.length);
    } else {
      input.setSelectionRange(start.length, start.length);
    }
    onCleanup(() => {
      if (dialog.open) dialog.close();
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    });
  });

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    const path = tidy(input.value);
    if (!path) return setError("Enter a path.");
    setBusy(true);
    try {
      await props.actions.submit(path);
    } catch (err) {
      setError(failure(err, path));
      input.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      class="dialog"
      aria-labelledby="path-prompt-title"
      onCancel={(e) => {
        e.preventDefault();
        props.actions.closePrompt();
      }}
    >
      <form onSubmit={(e) => void submit(e)}>
        <h2 id="path-prompt-title">{titles[p.kind]}</h2>
        <label class="dialog-field">
          <span>Path</span>
          <input
            ref={input}
            type="text"
            value={start}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            onInput={() => setError(undefined)}
          />
        </label>
        <Show when={error()}>
          <p class="dialog-error" role="alert">
            {error()}
          </p>
        </Show>
        <div class="dialog-buttons">
          <button type="submit" disabled={busy()}>
            {p.kind === "move" ? "Rename" : "Create"}
          </button>
          <button type="button" class="secondary" onClick={() => props.actions.closePrompt()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
