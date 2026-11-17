import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type StateEffect, Transaction } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { createEffect, on, onCleanup, onMount } from "solid-js";
import type { Tab } from "./appState";

// The server puts a fresh nonce on each app page and allows it in the page's
// Content-Security-Policy, so CodeMirror's injected <style> element is
// allowed. It must be in the state the view is created with: the style
// element is made once, when the first view mounts.
const cspNonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? "";

// A basic CodeMirror setup. Themes, languages and the Sublime keymap arrive
// with the editor-feel ticket.
const baseExtensions = [
  EditorView.cspNonce.of(cspNonce),
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  drawSelection(),
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.theme({ "&": { height: "100%" }, ".cm-scroller": { fontFamily: "var(--mono)" } }, { dark: true }),
];

/** What a Tab's editor looked like when it was last shown. */
type Snapshot = { state: EditorState; scroll: StateEffect<unknown> };

// One editor view, shared by every Tab. Switching Tabs stores the outgoing
// Tab's state (content, cursor, undo history) and scroll position, and puts
// back the incoming Tab's, so each Tab keeps its own.
export function Editor(props: { tab: Tab; onEdit: (tab: Tab) => void }) {
  let host!: HTMLDivElement;
  let view!: EditorView;
  let shown: Tab | undefined;
  const snapshots = new WeakMap<Tab, Snapshot>();

  const extensions = [
    baseExtensions,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && shown) props.onEdit(shown);
    }),
  ];

  onMount(() => {
    // Created with the base extensions, so the CSP nonce is there when the
    // style element is made.
    view = new EditorView({ state: EditorState.create({ extensions }), parent: host });
    onCleanup(() => view.destroy());

    createEffect(
      on(
        () => props.tab,
        (tab) => {
          if (shown) snapshots.set(shown, { state: view.state, scroll: view.scrollSnapshot() });
          shown = tab;
          const saved = snapshots.get(tab);
          // Keep typing in the editor across a Tab switch. setState alone
          // leaves Android input at the outgoing Tab's cursor position, so the
          // selection is dispatched again to resync it with the DOM.
          const hadFocus = view.hasFocus;
          view.setState(saved?.state ?? EditorState.create({ doc: tab.file.content, extensions }));
          view.dispatch({
            selection: view.state.selection,
            effects: saved?.scroll,
            annotations: Transaction.addToHistory.of(false),
          });
          if (hadFocus) view.focus();
        },
      ),
    );
  });

  return <div class="editor" ref={host} />;
}
