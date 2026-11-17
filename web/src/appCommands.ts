// The app's own commands, with Sublime's shortcuts: the finders, saving, go
// to line and find, and the Tab shortcuts (Ctrl+W closes, Ctrl+Tab /
// Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp switch, Alt+1..9 jumps).
// Their shortcuts work anywhere in the page, ahead of the editor. While a
// dialog is up, they leave what's behind it alone: with a finder open only
// the finders' own shortcuts work, and with the Save Conflict dialog open
// none do.

import { gotoLine, openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { type Accessor, onCleanup } from "solid-js";
import type { AppState } from "./appState";
import type { Command, Commands } from "./commands";
import type { FinderMode } from "./finders";
import { markdownHeadings } from "./headings";

/** Registers the app's commands and handles their shortcuts, for as long as
 * the calling component lives. */
export function useAppCommands(app: {
  state: AppState;
  commands: Commands;
  openFinder(mode: FinderMode): void;
  finderOpen: Accessor<boolean>;
  view: Accessor<EditorView | undefined>;
}) {
  const { state, commands, openFinder, view } = app;

  /** Runs an editor command on the active Tab's editor, if one is shown. */
  const inEditor = (command: (view: EditorView) => boolean) => () => {
    const v = view();
    if (!v) return;
    v.focus();
    command(v);
  };

  const finders: Command[] = [
    { name: "Goto Anything", shortcut: "Mod+P", run: () => openFinder({ kind: "files" }) },
    { name: "Command Palette", shortcut: "Mod+Shift+P", run: () => openFinder({ kind: "commands" }) },
    {
      name: "Goto Heading",
      shortcut: "Mod+R",
      async run() {
        const tab = state.activeTab();
        const headings = tab && (await markdownHeadings(tab.path, tab.doc()).catch(() => undefined));
        openFinder({ kind: "headings", headings });
      },
    },
  ];

  const tabJumps: Command[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
    name: `Go to Tab ${n}`,
    shortcut: `Alt+${n}`,
    hidden: true,
    run: () => state.activateAt(n - 1),
  }));

  onCleanup(
    commands.register(
      ...finders,
      { name: "Go to Line", shortcut: "Ctrl+G", run: inEditor(gotoLine) },
      { name: "Find", shortcut: "Mod+F", run: inEditor(openSearchPanel) },
      { name: "Save", shortcut: "Mod+S", run: () => void state.save() },
      { name: "Close Tab", shortcut: "Mod+W", run: () => state.closeActive() },
      { name: "Next Tab", shortcut: "Ctrl+Tab", moreShortcuts: ["Mod+PageDown"], run: () => state.cycle(1) },
      { name: "Previous Tab", shortcut: "Ctrl+Shift+Tab", moreShortcuts: ["Mod+PageUp"], run: () => state.cycle(-1) },
      ...tabJumps,
      { name: "Refresh File Tree", run: () => void state.loadTree() },
    ),
  );

  /** Whether a shortcut may run the command now. */
  const allowed = (command: Command) => !state.conflict() && (!app.finderOpen() || finders.includes(command));

  const onKeyDown = (e: KeyboardEvent) => {
    if (!commands.handleKey(e, allowed)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKeyDown, { capture: true });
  onCleanup(() => window.removeEventListener("keydown", onKeyDown, { capture: true }));
}
