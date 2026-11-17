import { onMount, Show } from "solid-js";
import { Editor } from "./Editor";
import { Sidebar } from "./Sidebar";
import { createWorkspace } from "./workspace";

export function App() {
  const workspace = createWorkspace();
  onMount(() => void workspace.loadTree());

  return (
    <div class="layout">
      <Sidebar workspace={workspace} />
      <main class="main">
        <Show when={workspace.error()}>
          {(message) => (
            <p class="notice" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show
          when={workspace.openFile()}
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
