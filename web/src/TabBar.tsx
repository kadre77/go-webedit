import { For } from "solid-js";
import type { AppState } from "./appState";
import { fileName } from "./paths";

// The open Tabs. The Preview Tab is shown in italics; double-clicking it pins
// it. A Tab with a Draft shows a modified dot in place of its close button
// until hovered. Each close button sits beside its tab, not inside it, so a
// tab's accessible name is just the file name.
export function TabBar(props: { state: AppState }) {
  const state = props.state;
  return (
    <div class="tabbar" role="tablist" aria-label="Open files">
      <For each={state.tabs()}>
        {(tab) => (
          <div
            class="tab"
            classList={{
              active: state.isActive(tab.path),
              preview: state.isPreview(tab.path),
              modified: tab.modified(),
            }}
          >
            <div
              role="tab"
              class="tab-label"
              aria-selected={state.isActive(tab.path)}
              data-preview={state.isPreview(tab.path) ? "true" : undefined}
              data-modified={tab.modified() ? "true" : undefined}
              title={tab.modified() ? `${tab.path} (modified)` : tab.path}
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
              <span class="tab-dot" aria-hidden="true">
                ●
              </span>
              <span class="tab-x" aria-hidden="true">
                ×
              </span>
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
