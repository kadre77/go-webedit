import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type StateEffect, type Text, Transaction } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { createEffect, on, onCleanup, onMount, untrack } from "solid-js";
import type { Tab } from "./appState";
import { detectIndentUnit } from "./indentation";
import { languageFor } from "./languages";
import { mariana } from "./mariana";
import { sublimeKeymap } from "./sublimeKeymap";

// The server puts a fresh nonce on each app page and allows it in the page's
// Content-Security-Policy, so CodeMirror's injected <style> element is
// allowed. It must be in the state the view is created with: the style
// element is made once, when the first view mounts.
const cspNonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? "";

const baseExtensions = [
  EditorView.cspNonce.of(cspNonce),
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  highlightSpecialChars(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  rectangularSelection(),
  crosshairCursor(),
  history(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  highlightSelectionMatches(),
  search({ top: true }),
  // Earlier bindings win, so Sublime's take precedence over CodeMirror's.
  keymap.of([...closeBracketsKeymap, ...sublimeKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap]),
  mariana,
];

// Each Tab's state holds its file's language here, filled in once loaded.
const language = new Compartment();

/** What a Tab's editor looked like when it was last shown. */
type Snapshot = { state: EditorState; scroll: StateEffect<unknown> };

// One editor view, shared by every Tab. Switching Tabs stores the outgoing
// Tab's state (content, cursor, undo history) and scroll position, and puts
// back the incoming Tab's, so each Tab keeps its own. When a Tab's content is
// replaced from outside the editor (reloaded from Dropbox), its editor starts
// afresh on the new content, keeping the cursor and scroll where they can be.
export function Editor(props: { tab: Tab; onEdit: (tab: Tab, doc: Text) => void }) {
  let host!: HTMLDivElement;
  let view!: EditorView;
  let shown: Tab | undefined;
  const snapshots = new WeakMap<Tab, Snapshot>();

  const extensions = [
    baseExtensions,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && shown) props.onEdit(shown, update.state.doc);
    }),
  ];

  /** A new Tab's editor state, with its language if that's already loaded. */
  const createState = (tab: Tab) => {
    const lang = languageFor(tab.path);
    if (lang && !lang.ready) {
      lang.load().then((support) => {
        const effects = language.reconfigure(support);
        if (shown === tab) view.dispatch({ effects, annotations: Transaction.addToHistory.of(false) });
        else {
          const saved = snapshots.get(tab);
          if (saved) snapshots.set(tab, { ...saved, state: saved.state.update({ effects }).state });
        }
      }, (err) => console.warn(`Couldn't load highlighting for ${tab.path}; showing plain text.`, err));
    }
    return EditorState.create({
      doc: tab.doc(),
      extensions: [extensions, indentUnit.of(detectIndentUnit(tab.doc().toString())), language.of(lang?.ready ?? [])],
    });
  };

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
          view.setState(saved?.state ?? createState(tab));
          view.dispatch({
            selection: view.state.selection,
            effects: saved?.scroll,
            annotations: Transaction.addToHistory.of(false),
          });
          if (hadFocus) view.focus();
        },
      ),
    );

    // Runs after the switch above. Edits made in the editor give the Tab the
    // editor's own doc, so any other doc was replaced from outside.
    createEffect(() => {
      const tab = props.tab;
      const doc = tab.doc();
      untrack(() => {
        if (shown !== tab || doc === view.state.doc) return;
        const head = Math.min(view.state.selection.main.head, doc.length);
        const scroll = view.scrollSnapshot();
        const hadFocus = view.hasFocus;
        view.setState(createState(tab));
        view.dispatch({ selection: { anchor: head }, effects: scroll, annotations: Transaction.addToHistory.of(false) });
        if (hadFocus) view.focus();
      });
    });
  });

  return <div class="editor" ref={host} />;
}
