// The command registry: the app's commands, each with a name, an optional
// keyboard shortcut and an action. The Command Palette lists them, and the
// registry runs a command when its shortcut is pressed anywhere in the page,
// ahead of the editor. Features add their own commands with `register`.
//
// A shortcut is written like "Mod+Shift+P": Mod is Ctrl, or Cmd on macOS;
// Ctrl is Ctrl everywhere. Browsers keep some shortcuts for themselves in an
// ordinary browser tab (for example Ctrl+W and Ctrl+Tab in Chrome), so those
// reach the app only where the browser lets them through, such as an
// installed app window.

import { type Accessor, createSignal } from "solid-js";

/** Whether shortcuts use Cmd in place of Ctrl. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

export type Command = {
  name: string;
  /** Its shortcut, shown in the Command Palette. */
  shortcut?: string;
  /** Further shortcuts that run it, not shown. */
  moreShortcuts?: readonly string[];
  /** Left out of the Command Palette: it's reached by its shortcut. */
  hidden?: boolean;
  run(): void;
};

export type Commands = {
  /** Every registered command, in the order registered. */
  list: Accessor<readonly Command[]>;
  /** Adds commands; returns a function that removes them again. */
  register(...commands: Command[]): () => void;
  /** Runs the command whose shortcut the key event is, if any and if
   * `allowed` lets it, and says whether the key was a shortcut: one that
   * isn't allowed now is still the app's, not the browser's. */
  handleKey(e: KeyboardEvent, allowed?: (command: Command) => boolean): boolean;
};

/** The shortcut as the Owner's keyboard labels it: "Ctrl+Shift+P", or "Cmd+Shift+P" on macOS. */
export const shortcutLabel = (shortcut: string) => shortcut.replace(/\bMod\b/, isMac ? "Cmd" : "Ctrl");

/** Whether the key event is the shortcut, with exactly its modifiers. */
function matches(e: KeyboardEvent, shortcut: string) {
  const parts = shortcut.split("+");
  const key = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  const ctrl = has("Ctrl") || (has("Mod") && !isMac);
  const meta = has("Mod") && isMac;
  if (e.ctrlKey !== ctrl || e.metaKey !== meta || e.altKey !== has("Alt") || e.shiftKey !== has("Shift")) return false;
  // Digits by key code: on macOS, Alt+digit types a symbol.
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
  return key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
}

/** An empty command registry. */
export function createCommands(): Commands {
  const [list, setList] = createSignal<readonly Command[]>([]);
  return {
    list,
    register(...commands) {
      setList([...list(), ...commands]);
      return () => setList(list().filter((c) => !commands.includes(c)));
    },
    handleKey(e, allowed = () => true) {
      const command = list().find((c) => [c.shortcut, ...(c.moreShortcuts ?? [])].some((s) => s && matches(e, s)));
      if (!command) return false;
      if (allowed(command)) command.run();
      return true;
    },
  };
}
