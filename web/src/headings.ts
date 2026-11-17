// A Markdown file's headings, for Goto Heading (Ctrl+R), read from the
// syntax tree of CodeMirror's Markdown language.

import type { Text } from "@codemirror/state";
import { languageFor } from "./languages";

export type Heading = {
  /** 1 for "#", 2 for "##" and so on. */
  level: number;
  text: string;
  /** Where the heading starts in the document. */
  from: number;
};

/** The headings in a file's content, or undefined if the file isn't
 * Markdown. Loads the Markdown language if it isn't loaded yet. */
export async function markdownHeadings(path: string, doc: Text): Promise<Heading[] | undefined> {
  const lang = languageFor(path);
  if (lang?.name !== "Markdown") return undefined;
  const support = await lang.load();
  const content = doc.toString();
  const headings: Heading[] = [];
  support.language.parser.parse(content).iterate({
    enter(node) {
      const m = /^(ATX|Setext)Heading(\d)$/.exec(node.name);
      if (!m) return;
      const source = content.slice(node.from, node.to);
      const text =
        m[1] === "ATX" ? source.replace(/^#+/, "").replace(/\s#+\s*$/, "") : source.split("\n", 1)[0];
      headings.push({ level: Number(m[2]), text: text.trim(), from: node.from });
      return false;
    },
  });
  return headings;
}
