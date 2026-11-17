// The app's own commands, with Sublime's shortcuts: the finders, saving, go
// to line and find, and the Tab shortcuts (Ctrl+W closes, Ctrl+Tab /
// Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp switch, Alt+1..9 jumps).
// Their shortcuts work anywhere in the page, ahead of the editor. While a
// dialog is up, they leave what's behind it alone: with a finder open only
// the finders' own shortcuts work, and with the Save Conflict dialog or the
// path prompt open none do. File management (new file and folder, rename or
// move, delete) acts on the active Tab's file and folder. The settings
// commands change font size, word wrap and the default indentation.

import { gotoLine, openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { type Accessor, onCleanup } from "solid-js";
import type { AppState } from "./appState";
import type { Command, Commands } from "./commands";
import type { FileActions } from "./fileActions";
import type { FinderMode } from "./finders";
import { markdownHeadings } from "./headings";
import { fontSizes, type Settings, tabWidths } from "./settings";

/** Registers the app's commands and handles their shortcuts, for as long as
 * the calling component lives. */
export function useAppCommands(app: {
  state: AppState;
  actions: FileActions;
  commands: Commands;
  settings: Settings;
  openFinder(mode: FinderMode): void;
  finderOpen: Accessor<boolean>;
  view: Accessor<EditorView | undefined>;
}) {
  const { state, actions, commands, settings, openFinder, view } = app;

  /** Runs a file action on the active Tab's file, if there is one. */
  const onActiveFile = (action: (path: string) => void) => () => {
    const tab = state.activeTab();
    if (tab) action(tab.path);
  };

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

  const settingsCommands: Command[] = [
    { name: "Increase Font Size", shortcut: "Mod+=", run: () => settings.setFontSize(settings.fontSize() + 1) },
    { name: "Decrease Font Size", shortcut: "Mod+-", run: () => settings.setFontSize(settings.fontSize() - 1) },
    { name: "Reset Font Size", shortcut: "Mod+0", run: () => settings.setFontSize(fontSizes.default) },
    { name: "Toggle Word Wrap", run: () => settings.setWordWrap(!settings.wordWrap()) },
    ...tabWidths.map((width) => ({ name: `Default Tab Width: ${width}`, run: () => settings.setTabWidth(width) })),
    { name: "Default Indentation: Spaces", run: () => settings.setUseTabs(false) },
    { name: "Default Indentation: Tabs", run: () => settings.setUseTabs(true) },
  ];

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
      { name: "New File", run: () => actions.newFile(state.currentFolder()) },
      { name: "New Folder", run: () => actions.newFolder(state.currentFolder()) },
      { name: "Rename or Move File", run: onActiveFile(actions.rename) },
      { name: "Delete File", run: onActiveFile((path) => void actions.remove(path, "file")) },
      ...settingsCommands,
    ),
  );

  /** Whether a shortcut may run the command now. */
  const allowed = (command: Command) =>
    !state.conflict() && !actions.prompt() && (!app.finderOpen() || finders.includes(command));

  const onKeyDown = (e: KeyboardEvent) => {
    if (!commands.handleKey(e, allowed)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKeyDown, { capture: true });
  onCleanup(() => window.removeEventListener("keydown", onKeyDown, { capture: true }));
}
