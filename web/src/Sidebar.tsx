import { For, Show } from "solid-js";
import type { TreeNode, Workspace } from "./workspace";

const marks = { "too-large": "too large", binary: "binary" } as const;

// The file tree, rendered as a flat list of visible rows (an ARIA tree with
// aria-level), so each row's accessible name is just its own label.
export function Sidebar(props: { workspace: Workspace }) {
  const ws = props.workspace;
  const activate = (node: TreeNode) =>
    node.kind === "folder" ? ws.toggleFolder(node.path) : void ws.open(node);

  return (
    <nav class="sidebar" aria-label="Files">
      <div role="tree" aria-label="Root Folder">
        <For each={ws.visibleRows()}>
          {(node) => (
            <div
              role="treeitem"
              class="row"
              classList={{
                folder: node.kind === "folder",
                unopenable: !!node.unopenable,
                active: ws.isOpen(node.path),
              }}
              style={{ "padding-left": `${0.5 + node.depth * 1}rem` }}
              aria-level={node.depth + 1}
              aria-expanded={node.kind === "folder" ? ws.isExpanded(node.path) : undefined}
              aria-selected={node.kind === "file" ? ws.isOpen(node.path) : undefined}
              aria-disabled={node.unopenable ? true : undefined}
              title={node.path}
              tabIndex={-1}
              onClick={() => activate(node)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate(node);
                }
              }}
            >
              <span class="twisty" aria-hidden="true">
                {node.kind === "folder" ? (ws.isExpanded(node.path) ? "▾" : "▸") : ""}
              </span>
              <span class="name">{node.name}</span>
              <Show when={node.unopenable}>
                {(why) => <span class="mark">{marks[why()]}</span>}
              </Show>
            </div>
          )}
        </For>
      </div>
    </nav>
  );
}
