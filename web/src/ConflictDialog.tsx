import { onCleanup, onMount } from "solid-js";
import { type AppState, fileName, type SaveConflict } from "./appState";

// The Save Conflict dialog: the file changed in Dropbox since it was opened,
// so the save was refused. The Owner overwrites Dropbox's version with
// theirs, reloads Dropbox's version, or saves theirs as a copy. Escape
// cancels and keeps the Draft. Focus goes back where it was (the editor)
// when the dialog goes away.
export function ConflictDialog(props: { state: AppState; conflict: SaveConflict }) {
  let dialog!: HTMLDialogElement;
  onMount(() => {
    const before = document.activeElement;
    dialog.showModal();
    onCleanup(() => {
      if (dialog.open) dialog.close();
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    });
  });
  const choose = props.state.resolveConflict;
  const name = () => fileName(props.conflict.tab.path);

  return (
    <dialog
      ref={dialog}
      class="dialog"
      aria-labelledby="conflict-title"
      aria-describedby="conflict-text"
      onCancel={(e) => {
        e.preventDefault();
        void choose("cancel");
      }}
    >
      <h2 id="conflict-title">Save Conflict</h2>
      <p id="conflict-text">
        <strong>{name()}</strong> changed in Dropbox since you opened it, so your Draft hasn't been saved.
      </p>
      <div class="dialog-buttons">
        <button type="button" onClick={() => void choose("overwrite")}>
          Overwrite with mine
        </button>
        <button type="button" onClick={() => void choose("reload")}>
          Reload theirs
        </button>
        <button type="button" onClick={() => void choose("copy")}>
          Save mine as a copy
        </button>
        <button type="button" class="secondary" onClick={() => void choose("cancel")}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
