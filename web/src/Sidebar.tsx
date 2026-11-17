import { createEffect, For, on, onCleanup, Show } from "solid-js";
import { pathKey, type AppState, type TreeNode } from "./appState";

const marks = { "too-large": "too large", binary: "binary" } as const;

// The file tree, rendered as a flat list of visible rows (an ARIA tree with
// aria-level), so each row's accessible name is just its own label.
export function Sidebar(props: { state: AppState }) {
  const state = props.state;
  // Scroll the active Tab's file into view when the active Tab changes (after
  // the tree has expanded to show it), not whenever the rows are rebuilt.
  const rows = new Map<string, HTMLElement>();
  createEffect(
    on(state.activeTab, (tab) => {
      if (tab) queueMicrotask(() => rows.get(pathKey(tab.path))?.scrollIntoView({ block: "nearest" }));
    }),
  );

  const activate = (node: TreeNode) =>
    node.kind === "folder" ? state.toggleFolder(node.path) : void state.open(node);

  return (
    <nav class="sidebar" aria-label="Files">
      <div class="tree" role="tree" aria-label="Root Folder">
        <For each={state.visibleRows()}>
          {(node) => (
            <div
              role="treeitem"
              class="row"
              classList={{
                folder: node.kind === "folder",
                unopenable: !!node.unopenable,
                active: state.isActive(node.path),
              }}
              style={{ "padding-left": `${0.5 + node.depth * 1}rem` }}
              aria-level={node.depth + 1}
              aria-expanded={node.kind === "folder" ? state.isExpanded(node.path) : undefined}
              aria-selected={node.kind === "file" ? state.isActive(node.path) : undefined}
              aria-disabled={node.unopenable ? true : undefined}
              title={node.path}
              tabIndex={-1}
              ref={(el) => {
                rows.set(pathKey(node.path), el);
                onCleanup(() => rows.get(pathKey(node.path)) === el && rows.delete(pathKey(node.path)));
              }}
              onClick={() => activate(node)}
              onDblClick={() => node.kind === "file" && void state.open(node, { pinned: true })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate(node);
                }
              }}
            >
              <span class="twisty" aria-hidden="true">
                {node.kind === "folder" ? (state.isExpanded(node.path) ? "▾" : "▸") : ""}
              </span>
              <span class="name">{node.name}</span>
              <Show when={node.unopenable}>
                {(why) => <span class="mark">{marks[why()]}</span>}
              </Show>
            </div>
          )}
        </For>
      </div>
      {/* A plain form post: the browser sends the Origin header the server checks. */}
      <form class="sidebar-footer" method="post" action="/auth/signout">
        <button type="submit">Sign out</button>
      </form>
    </nav>
  );
}
