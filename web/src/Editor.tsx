import { defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { createEffect, onCleanup, onMount } from "solid-js";
import type { OpenedFile } from "./api";

// The server puts a fresh nonce on each app page and allows it in the page's
// Content-Security-Policy, so CodeMirror's injected <style> element is
// allowed. It must be in the state the view is created with: the style
// element is made once, when the first view mounts.
const cspNonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? "";

// A basic, read-only CodeMirror view of the open file. Editing, themes and
// languages arrive with the editor tickets.
const extensions = [
  EditorView.cspNonce.of(cspNonce),
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  drawSelection(),
  keymap.of(defaultKeymap),
  EditorState.readOnly.of(true),
  EditorView.theme({ "&": { height: "100%" }, ".cm-scroller": { fontFamily: "var(--mono)" } }, { dark: true }),
];

export function Editor(props: { file: OpenedFile }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;

  onMount(() => {
    view = new EditorView({ state: EditorState.create({ extensions }), parent: host });
    onCleanup(() => view?.destroy());
  });

  createEffect(() => {
    const doc = props.file.content;
    view?.setState(EditorState.create({ doc, extensions }));
  });

  return <div class="editor" ref={host} />;
}
