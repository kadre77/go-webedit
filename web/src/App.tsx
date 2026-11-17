import { onMount, Show } from "solid-js";
import { Editor } from "./Editor";
import { Sidebar } from "./Sidebar";
import { createAppState } from "./appState";

export function App() {
  const state = createAppState();
  onMount(() => void state.loadTree());

  return (
    <div class="layout">
      <Sidebar state={state} />
      <main class="main">
        <Show when={state.error()}>
          {(message) => (
            <p class="notice" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show
          when={state.openFile()}
          fallback={
            <div class="placeholder">
              <h1>webedit</h1>
              <p>Pick a file in the sidebar.</p>
            </div>
          }
        >
          {(file) => <Editor file={file()} />}
        </Show>
      </main>
    </div>
  );
}
