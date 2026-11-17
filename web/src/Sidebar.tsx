import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { pathKey, type AppState, type TreeNode } from "./appState";
import type { FileActions } from "./fileActions";
import { folderOf } from "./paths";

const marks = { "too-large": "too large", binary: "binary" } as const;

// The file tree, rendered as a flat list of visible rows (an ARIA tree with
// aria-level), so each row's accessible name is just its own label.
export function Sidebar(props: { state: AppState; actions: FileActions }) {
  const state = props.state;
  const [menu, setMenu] = createSignal<MenuAt>();
  const openMenu = (e: MouseEvent, node?: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };
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
      <div class="tree" role="tree" aria-label="Root Folder" onContextMenu={(e) => openMenu(e)}>
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
              onContextMenu={(e) => openMenu(e, node)}
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
      <Show when={menu()} keyed>
        {(at) => <TreeMenu at={at} actions={props.actions} onClose={() => setMenu(undefined)} />}
      </Show>
      <div class="sidebar-footer">
        <button type="button" title="Reload the tree from Dropbox" onClick={() => void state.loadTree()}>
          Refresh
        </button>
        {/* A plain form post: the browser sends the Origin header the server checks. */}
        <form method="post" action="/auth/signout">
          <button type="submit">Sign out</button>
        </form>
      </div>
    </nav>
  );
}

/** Where the context menu was opened: on a row, or on the tree's empty space. */
type MenuAt = { x: number; y: number; node?: TreeNode };

/** The tree's context menu: new file and new folder (in the folder clicked,
 * or the clicked file's folder, or the Root Folder), and for a row, rename
 * or move and delete. Arrow keys move, Escape or a click elsewhere closes. */
function TreeMenu(props: { at: MenuAt; actions: FileActions; onClose: () => void }) {
  let el!: HTMLDivElement;
  const node = props.at.node;
  const folder = !node ? "" : node.kind === "folder" ? node.path : folderOf(node.path);
  const items: { label: string; run: () => void }[] = [
    { label: "New File…", run: () => props.actions.newFile(folder) },
    { label: "New Folder…", run: () => props.actions.newFolder(folder) },
  ];
  if (node) {
    items.push(
      { label: "Rename or Move…", run: () => props.actions.rename(node.path) },
      { label: "Delete", run: () => void props.actions.remove(node.path, node.kind) },
    );
  }
  const buttons = () => [...el.querySelectorAll<HTMLElement>("[role=menuitem]")];

  onMount(() => {
    // Keep the menu inside the window.
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(0, Math.min(props.at.x, innerWidth - r.width))}px`;
    el.style.top = `${Math.max(0, Math.min(props.at.y, innerHeight - r.height))}px`;
    buttons()[0]?.focus();
    const outside = (e: Event) => !el.contains(e.target as Node) && props.onClose();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", props.onClose);
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", props.onClose);
    });
  });

  const onKeyDown = (e: KeyboardEvent) => {
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 };
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      props.onClose();
    } else if (e.key in moves) {
      e.preventDefault();
      all[(moves[e.key] + all.length) % all.length]?.focus();
    }
  };

  return (
    <div
      ref={el}
      class="menu"
      role="menu"
      aria-label={node ? `Actions for ${node.name}` : "Root Folder actions"}
      style={{ left: `${props.at.x}px`, top: `${props.at.y}px` }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <For each={items}>
        {(item) => (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              props.onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        )}
      </For>
    </div>
  );
}
