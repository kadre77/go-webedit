import { type Command, shortcutLabel } from "./commands";
import { Finder, type FinderItem } from "./Finder";
import { fuzzyMatchWords, nameStartOf, rankPaths } from "./fuzzy";
import type { Heading } from "./headings";

// The three uses of the finder overlay.

/** Which finder is open. Goto Heading carries the active Tab's headings,
 * or none if its file isn't Markdown. */
export type FinderMode = { kind: "files" } | { kind: "commands" } | { kind: "headings"; headings?: readonly Heading[] };

// Rows past this many aren't shown: the query narrows them down.
const shownLimit = 200;

/** Goto Anything: opens any Text File by typing part of its path. */
export function GotoAnything(props: { paths: readonly string[]; onOpen: (path: string) => void; onClose: () => void }) {
  const search = (query: string) =>
    rankPaths(query, props.paths)
      .slice(0, shownLimit)
      .map(({ path, positions }): FinderItem & { path: string } => {
        const nameStart = nameStartOf(path);
        return {
          path,
          label: path.slice(nameStart),
          labelMarks: positions.filter((p) => p >= nameStart).map((p) => p - nameStart),
          detail: path,
          detailMarks: positions,
        };
      });
  return (
    <Finder
      title="Goto Anything"
      placeholder="File name or path"
      empty="No matching files"
      search={search}
      onChoose={(item) => props.onOpen(item.path)}
      onClose={props.onClose}
    />
  );
}

/** The Command Palette: the app's commands, with their shortcuts. */
export function CommandPalette(props: {
  commands: readonly Command[];
  onRun: (command: Command) => void;
  onClose: () => void;
}) {
  const search = (query: string) =>
    props.commands
      .filter((c) => !c.hidden)
      .flatMap((command) => {
        const match = fuzzyMatchWords(query, command.name);
        return match ? [{ command, match }] : [];
      })
      .sort((a, b) => b.match.score - a.match.score)
      .map(
        ({ command, match }): FinderItem & { command: Command } => ({
          command,
          label: command.name,
          labelMarks: match.positions,
          hint: command.shortcut && [command.shortcut, ...(command.moreShortcuts ?? [])].map(shortcutLabel).join(" · "),
        }),
      );
  return (
    <Finder
      title="Command Palette"
      placeholder="Command"
      empty="No matching commands"
      search={search}
      onChoose={(item) => props.onRun(item.command)}
      onClose={props.onClose}
    />
  );
}

/** Goto Heading: the active Markdown file's headings in order, indented by
 * level. `headings` is undefined for a file that isn't Markdown. */
export function GotoHeading(props: {
  headings: readonly Heading[] | undefined;
  onJump: (heading: Heading) => void;
  onClose: () => void;
}) {
  const search = (query: string) =>
    (props.headings ?? []).flatMap((heading): (FinderItem & { heading: Heading })[] => {
      const match = fuzzyMatchWords(query, heading.text);
      return match ? [{ heading, label: heading.text, labelMarks: match.positions, depth: heading.level - 1 }] : [];
    });
  return (
    <Finder
      title="Goto Heading"
      placeholder="Heading"
      empty={props.headings ? "No matching headings" : "No symbols"}
      search={search}
      onChoose={(item) => props.onJump(item.heading)}
      onClose={props.onClose}
    />
  );
}
