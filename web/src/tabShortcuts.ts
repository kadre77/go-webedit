// Sublime's Tab shortcuts: Ctrl+S saves, Ctrl+W closes, Ctrl+Tab /
// Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp switch, Alt+1..9 jumps. On
// macOS Cmd stands in for Ctrl, except in Ctrl+Tab (Cmd+Tab belongs to the
// system).
//
// Browsers keep some of these for themselves in an ordinary browser tab (for
// example Ctrl+W and Ctrl+Tab in Chrome), so they reach the app only where the
// browser lets them through, such as an installed app window.

import { onCleanup } from "solid-js";
import type { AppState } from "./appState";

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

type Action = { save: true } | { close: true } | { cycle: number } | { jump: number };

function actionFor(e: KeyboardEvent): Action | undefined {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (mod && !e.altKey && !e.shiftKey) {
    if (e.key.toLowerCase() === "s") return { save: true };
    if (e.key.toLowerCase() === "w") return { close: true };
    if (e.key === "PageDown") return { cycle: 1 };
    if (e.key === "PageUp") return { cycle: -1 };
  }
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") return { cycle: e.shiftKey ? -1 : 1 };
  // By key code: on macOS, Alt+digit types a symbol.
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return { jump: Number(digit[1]) - 1 };
  return undefined;
}

/** Handles the Tab shortcuts anywhere in the page, ahead of the editor. */
export function useTabShortcuts(state: AppState) {
  const onKeyDown = (e: KeyboardEvent) => {
    const action = actionFor(e);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if ("save" in action) void state.save();
    else if ("close" in action) state.closeActive();
    else if ("cycle" in action) state.cycle(action.cycle);
    else state.activateAt(action.jump);
  };
  window.addEventListener("keydown", onKeyDown, { capture: true });
  onCleanup(() => window.removeEventListener("keydown", onKeyDown, { capture: true }));
}
