import { For } from "solid-js";
import type { AppState } from "./appState";

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// The open Tabs. The Preview Tab is shown in italics; double-clicking it pins
// it. Each close button sits beside its tab, not inside it, so a tab's
// accessible name is just the file name.
export function TabBar(props: { state: AppState }) {
  const state = props.state;
  return (
    <div class="tabbar" role="tablist" aria-label="Open files">
      <For each={state.tabs()}>
        {(tab) => (
          <div class="tab" classList={{ active: state.isActive(tab.path), preview: state.isPreview(tab.path) }}>
            <div
              role="tab"
              class="tab-label"
              aria-selected={state.isActive(tab.path)}
              data-preview={state.isPreview(tab.path) ? "true" : undefined}
              title={tab.path}
              tabIndex={state.isActive(tab.path) ? 0 : -1}
              onClick={() => state.activate(tab.path)}
              onDblClick={() => state.pin(tab.path)}
            >
              {fileName(tab.path)}
            </div>
            <button
              type="button"
              class="tab-close"
              aria-label={`Close ${fileName(tab.path)}`}
              tabIndex={-1}
              onClick={() => state.close(tab.path)}
            >
              ×
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
