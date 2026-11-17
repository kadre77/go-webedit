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

// A basic, read-only CodeMirror view of the open file. Editing, themes and
// languages arrive with the editor tickets.
const extensions = [
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
    view = new EditorView({ parent: host });
    onCleanup(() => view?.destroy());
  });

  createEffect(() => {
    const doc = props.file.content;
    view?.setState(EditorState.create({ doc, extensions }));
  });

  return <div class="editor" ref={host} />;
}
