// The languages the editor highlights, picked by file name. Each one's
// package is a separate chunk, loaded the first time a file needs it, so the
// first page load doesn't pull in every language. Anything not listed opens as
// plain text.

import { LanguageDescription, LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";

const legacy = (parser: StreamParser<unknown>) => new LanguageSupport(StreamLanguage.define(parser));

const languages: LanguageDescription[] = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "javascript", "node"],
    extensions: ["js", "mjs", "cjs"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  }),
  LanguageDescription.of({
    name: "JSX",
    alias: ["jsx"],
    extensions: ["jsx"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "typescript"],
    extensions: ["ts", "mts", "cts"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: "TSX",
    alias: ["tsx"],
    extensions: ["tsx"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json"],
    extensions: ["json", "jsonc", "webmanifest"],
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "xhtml"],
    extensions: ["html", "htm", "xhtml"],
    load: () => import("@codemirror/lang-html").then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    extensions: ["css"],
    load: () => import("@codemirror/lang-css").then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: "Go",
    alias: ["go", "golang"],
    extensions: ["go"],
    load: () => import("@codemirror/lang-go").then((m) => m.go()),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py", "python"],
    extensions: ["py", "pyw"],
    load: () => import("@codemirror/lang-python").then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yaml", "yml"],
    extensions: ["yaml", "yml"],
    load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["sh", "bash", "shell", "zsh"],
    extensions: ["sh", "bash", "zsh"],
    filename: /^\.(bash|zsh)?(rc|_profile|_aliases)$|^\.profile$/,
    load: () => import("@codemirror/legacy-modes/mode/shell").then((m) => legacy(m.shell)),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql"],
    extensions: ["sql"],
    load: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  }),
];

// Markdown is described after the others so its fenced code blocks can use
// them, each still loaded only when a block in that language appears.
languages.push(
  LanguageDescription.of({
    name: "Markdown",
    alias: ["md", "markdown"],
    extensions: ["md", "markdown", "mdown", "mkd"],
    load: () =>
      import("@codemirror/lang-markdown").then((m) =>
        m.markdown({ base: m.markdownLanguage, codeLanguages: languages }),
      ),
  }),
);

/**
 * The language for a file, by its name. Returns undefined for plain text.
 * `ready` is the language if it has already been loaded, so a file in a
 * language seen before is highlighted from its first paint.
 */
export function languageFor(path: string):
  | { name: string; ready: LanguageSupport | undefined; load: () => Promise<LanguageSupport> }
  | undefined {
  // Lower-cased, so README.MD is Markdown too.
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const description = LanguageDescription.matchFilename(languages, name);
  if (!description) return undefined;
  return { name: description.name, ready: description.support, load: () => description.load() };
}
