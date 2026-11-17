import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";

// The fuzzy-finder overlay shared by Goto Anything, the Command Palette and
// Goto Heading: type to filter, arrow keys to move, Enter (or a click) to
// choose, Esc to close. What it lists, and what choosing does, is up to the
// caller; so is where focus goes afterwards.

export type FinderItem = {
  label: string;
  /** Positions in the label to highlight as matched. */
  labelMarks?: readonly number[];
  /** A second line, such as a file's path. */
  detail?: string;
  detailMarks?: readonly number[];
  /** Shown at the end of the row, such as a command's shortcut. */
  hint?: string;
  /** How far to indent the row, such as a heading's level. */
  depth?: number;
};

let nextId = 0;

/** The text with the marked positions wrapped in <mark>. */
function Marked(props: { text: string; marks?: readonly number[] }) {
  const parts = createMemo(() => {
    const marks = new Set(props.marks);
    const out: { text: string; marked: boolean }[] = [];
    for (let i = 0; i < props.text.length; i++) {
      const marked = marks.has(i);
      const last = out[out.length - 1];
      if (last && last.marked === marked) last.text += props.text[i];
      else out.push({ text: props.text[i], marked });
    }
    return out;
  });
  return <For each={parts()}>{(p) => (p.marked ? <mark>{p.text}</mark> : p.text)}</For>;
}

/** The overlay, open while it's mounted. `search` lists the items matching
 * the query, best first; the first is selected. */
export function Finder<T extends FinderItem>(props: {
  title: string;
  placeholder: string;
  /** Shown when nothing matches. */
  empty: string;
  search: (query: string) => readonly T[];
  onChoose: (item: T) => void;
  onClose: () => void;
}) {
  let dialog!: HTMLDialogElement;
  let input!: HTMLInputElement;
  const id = `finder-${nextId++}`;
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const results = createMemo(() => props.search(query()));
  const current = () => Math.min(selected(), results().length - 1);
  const options = new Map<number, HTMLElement>();

  onMount(() => {
    dialog.showModal();
    input.focus();
    onCleanup(() => dialog.open && dialog.close());
  });

  createEffect(on(current, (i) => options.get(i)?.scrollIntoView({ block: "nearest" })));

  const choose = (item: T | undefined) => item && props.onChoose(item);
  const move = (delta: number) => setSelected(Math.max(0, Math.min(results().length - 1, current() + delta)));

  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      PageDown: () => move(10),
      PageUp: () => move(-10),
      Enter: () => choose(results()[current()]),
    };
    const action = keys[e.key];
    if (!action || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    action();
  };

  return (
    <dialog
      ref={dialog}
      class="finder"
      aria-label={props.title}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      // A click on the backdrop lands on the dialog itself.
      onClick={(e) => e.target === dialog && props.onClose()}
    >
      <input
        ref={input}
        class="finder-input"
        type="text"
        role="combobox"
        aria-label={props.placeholder}
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={results().length ? `${id}-${current()}` : undefined}
        placeholder={props.placeholder}
        autocomplete="off"
        spellcheck={false}
        value={query()}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setSelected(0);
        }}
        onKeyDown={onKeyDown}
      />
      <Show when={results().length} fallback={<p class="finder-empty">{props.empty}</p>}>
        <ul class="finder-list" id={`${id}-list`} role="listbox" aria-label={props.title}>
          <For each={results()}>
            {(item, i) => (
              <li
                ref={(el) => {
                  options.set(i(), el);
                  onCleanup(() => options.get(i()) === el && options.delete(i()));
                }}
                id={`${id}-${i()}`}
                role="option"
                class="finder-option"
                aria-selected={i() === current()}
                style={item.depth ? { "padding-left": `${0.75 + item.depth * 1.25}rem` } : undefined}
                // Keep focus in the input.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                <span class="finder-text">
                  <span class="finder-label">
                    <Marked text={item.label} marks={item.labelMarks} />
                  </span>
                  <Show when={item.detail}>
                    {(detail) => (
                      <span class="finder-detail">
                        <Marked text={detail()} marks={item.detailMarks} />
                      </span>
                    )}
                  </Show>
                </span>
                <Show when={item.hint}>{(hint) => <kbd class="finder-hint">{hint()}</kbd>}</Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </dialog>
  );
}
