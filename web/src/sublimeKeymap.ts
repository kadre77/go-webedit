// Sublime Text's editing shortcuts, written for this app: CodeMirror has no
// official Sublime keymap, but its commands cover most of them. `Mod` is Ctrl,
// or Cmd on macOS; a `mac` key follows Sublime's macOS binding where that
// isn't simply Cmd. These take precedence over CodeMirror's default keymap,
// which still supplies the basics (cursor movement, Home/End and so on).

import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  cursorMatchingBracket,
  deleteLine,
  indentLess,
  indentMore,
  insertBlankLine,
  moveLineDown,
  moveLineUp,
  selectLine,
  selectParentSyntax,
  toggleTabFocusMode,
  toggleBlockComment,
  toggleComment,
} from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import {
  findNext,
  findPrevious,
  gotoLine,
  openSearchPanel,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { EditorSelection, type StateCommand } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

/** Ctrl+Shift+L: splits each selection into one selection per line. */
const splitSelectionIntoLines: StateCommand = ({ state, dispatch }) => {
  const ranges = state.selection.ranges.flatMap((range) => {
    if (range.empty) return [range];
    const out = [];
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      out.push(EditorSelection.range(Math.max(range.from, line.from), Math.min(range.to, line.to)));
      pos = line.to + 1;
    }
    return out;
  });
  if (ranges.length === state.selection.ranges.length) return false;
  dispatch(state.update({ selection: EditorSelection.create(ranges), scrollIntoView: true, userEvent: "select" }));
  return true;
};

/**
 * Ctrl+J: joins the next line onto the current one, or every line a selection
 * spans, putting a single space where each line break and the indentation
 * around it was.
 */
const joinLines: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const tr = state.changeByRange((range) => {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    const end = last.number > first.number ? last.number : Math.min(first.number + 1, state.doc.lines);
    const changes = [];
    let joinedAt = range.to;
    for (let n = first.number; n < end; n++) {
      const line = state.doc.line(n);
      const next = state.doc.line(n + 1);
      const from = line.from + line.text.trimEnd().length;
      const to = next.from + (next.text.length - next.text.trimStart().length);
      const insert = line.text.trim() && next.text.trim() ? " " : "";
      changes.push({ from, to, insert });
      joinedAt = from;
    }
    if (!changes.length) return { range };
    const set = state.changes(changes);
    const cursor = range.empty ? EditorSelection.cursor(set.mapPos(joinedAt, 1)) : range.map(set);
    return { changes: set, range: cursor };
  });
  if (tr.changes.empty) return false;
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/**
 * Tab: when a selection spans lines, indents them. Otherwise puts the file's
 * indent unit at each cursor, replacing any selected text; with spaces, it
 * pads to the next tab stop.
 */
const insertIndent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const spansLines = (r: { from: number; to: number }) => state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number;
  if (state.selection.ranges.some(spansLines)) return indentMore({ state, dispatch });
  const unit = state.facet(indentUnit);
  const tr = state.changeByRange((range) => {
    let insert = unit;
    if (unit !== "\t") {
      const line = state.doc.lineAt(range.from);
      const column = range.from - line.from;
      insert = " ".repeat(unit.length - (column % unit.length));
    }
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/** Ctrl+Shift+Enter: inserts a blank line above the cursor's line. */
const insertBlankLineAbove: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    const indent = /^\s*/.exec(line.text)![0];
    return {
      changes: { from: line.from, insert: indent + state.lineBreak },
      range: EditorSelection.cursor(line.from + indent.length),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

// Browsers have their own uses for many of these keys (Ctrl+D bookmarks,
// Ctrl+H history, Ctrl+G find next...), so they never fall through.
const bind = (b: KeyBinding): KeyBinding => ({ preventDefault: true, ...b });

export const sublimeKeymap: readonly KeyBinding[] = [
  // Selection and multiple cursors (Ctrl+click is CodeMirror's default).
  bind({ key: "Mod-d", run: selectNextOccurrence }),
  bind({ key: "Alt-F3", mac: "Ctrl-Mod-g", run: selectSelectionMatches }),
  bind({ key: "Mod-l", run: selectLine }),
  bind({ key: "Mod-Shift-l", run: splitSelectionIntoLines }),
  bind({ key: "Mod-Shift-Space", run: selectParentSyntax }),
  bind({ key: "Alt-Shift-ArrowUp", mac: "Ctrl-Shift-ArrowUp", run: addCursorAbove }),
  bind({ key: "Alt-Shift-ArrowDown", mac: "Ctrl-Shift-ArrowDown", run: addCursorBelow }),
  // Line operations.
  bind({ key: "Mod-Shift-d", run: copyLineDown }),
  bind({ key: "Ctrl-Shift-ArrowUp", mac: "Ctrl-Mod-ArrowUp", run: moveLineUp }),
  bind({ key: "Ctrl-Shift-ArrowDown", mac: "Ctrl-Mod-ArrowDown", run: moveLineDown }),
  bind({ key: "Mod-Shift-k", mac: "Ctrl-Shift-k", run: deleteLine }),
  bind({ key: "Mod-j", run: joinLines }),
  bind({ key: "Mod-Enter", run: insertBlankLine }),
  bind({ key: "Mod-Shift-Enter", run: insertBlankLineAbove }),
  bind({ key: "Mod-/", run: toggleComment }),
  bind({ key: "Mod-Shift-/", mac: "Mod-Alt-/", run: toggleBlockComment }),
  bind({ key: "Mod-]", run: indentMore }),
  bind({ key: "Mod-[", run: indentLess }),
  // Ctrl on macOS too, as in Sublime: Cmd+M minimizes the window.
  bind({ key: "Ctrl-m", run: cursorMatchingBracket }),
  // Not bind(): in a read-only editor, Tab moves focus as usual.
  { key: "Tab", run: insertIndent, shift: indentLess },
  // Tab is captured above, so this lets keyboard users Tab out of the editor
  // (CodeMirror's Ctrl+M for it is Sublime's go-to-bracket here).
  bind({ key: "Alt-Shift-m", run: toggleTabFocusMode }),
  // Find, replace and go to line.
  bind({ key: "Mod-f", run: openSearchPanel, scope: "editor search-panel" }),
  bind({ key: "Mod-h", mac: "Mod-Alt-f", run: openSearchPanel, scope: "editor search-panel" }),
  bind({ key: "F3", run: findNext, shift: findPrevious, scope: "editor search-panel" }),
  bind({ key: "Ctrl-g", run: gotoLine }),
];
