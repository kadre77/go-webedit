// Sublime Text's Mariana colour scheme for CodeMirror: the editor chrome and
// the syntax highlighting. The colour names are Mariana's own variables.

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const color = {
  blue: "#6699cc",
  blue2: "#4e5a65",
  blue3: "#303841",
  blue4: "#647382",
  blue5: "#5fb4b4",
  blue6: "#a6acb9",
  green: "#99c794",
  orange: "#f9ae58",
  orange2: "#ee932b",
  orange3: "#fac761",
  pink: "#c695c6",
  red: "#ec5f66",
  red2: "#f97b58",
  white: "#ffffff",
  white3: "#d8dee9",
  panel: "#262c33",
};

const chrome = EditorView.theme(
  {
    "&": { color: color.white3, backgroundColor: color.blue3, height: "100%" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.5" },
    ".cm-content": { caretColor: color.orange },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: color.orange, borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: color.blue2 },
    ".cm-activeLine": { backgroundColor: "#3a434d66" },
    ".cm-gutters": { backgroundColor: color.blue3, color: "#a6acb980", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: color.white3 },
    ".cm-selectionMatch": { backgroundColor: "#4e5a6599", outline: `1px solid ${color.blue4}` },
    "&.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", outline: `1px solid ${color.blue6}` },
    "&.cm-focused .cm-nonmatchingBracket": { outline: `1px solid ${color.red}` },
    ".cm-searchMatch": { backgroundColor: "#f9ae5833", outline: `1px solid ${color.orange}` },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#f9ae5866" },
    ".cm-panels": { backgroundColor: color.panel, color: color.white3 },
    ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${color.blue2}` },
    ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${color.blue2}` },
    ".cm-panel input, .cm-panel button": { font: "inherit", fontSize: "90%" },
    ".cm-textfield": { backgroundColor: color.blue3, color: color.white3, border: `1px solid ${color.blue2}` },
    ".cm-button": { backgroundImage: "none", backgroundColor: color.blue2, color: color.white3, border: "none" },
    ".cm-tooltip": { backgroundColor: color.panel, color: color.white3, border: `1px solid ${color.blue2}` },
    ".cm-foldPlaceholder": { backgroundColor: color.blue2, color: color.white3, border: "none" },
  },
  { dark: true },
);

const highlighting = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: color.blue6, fontStyle: "italic" },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], color: color.green },
  { tag: [t.escape], color: color.blue5 },
  { tag: [t.number, t.integer, t.float], color: color.orange },
  { tag: [t.bool, t.null, t.atom, t.constant(t.name), t.self], color: color.red },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.modifier], color: color.pink },
  { tag: [t.operator, t.operatorKeyword, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: color.red2 },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: color.blue },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: color.orange3 },
  { tag: [t.propertyName, t.attributeName], color: color.pink },
  { tag: [t.labelName, t.macroName], color: color.blue5 },
  { tag: [t.tagName], color: color.red },
  { tag: [t.angleBracket, t.punctuation, t.separator, t.bracket], color: color.blue6 },
  { tag: [t.variableName, t.definition(t.variableName)], color: color.white3 },
  { tag: [t.special(t.variableName)], color: color.red },
  { tag: t.invalid, color: color.white, backgroundColor: color.red },
  // Markdown.
  // One rule per tag: a later rule for the same tag replaces an earlier one.
  { tag: t.heading1, color: color.orange, fontWeight: "bold", fontSize: "1.15em" },
  { tag: [t.heading, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: color.orange, fontWeight: "bold" },
  { tag: t.emphasis, color: color.pink, fontStyle: "italic" },
  { tag: t.strong, color: color.orange2, fontWeight: "bold" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link], color: color.blue },
  { tag: [t.url], color: color.blue5, textDecoration: "underline" },
  { tag: t.monospace, color: color.green },
  { tag: t.quote, color: color.blue6, fontStyle: "italic" },
  { tag: [t.list], color: color.white3 },
  { tag: [t.processingInstruction, t.contentSeparator], color: color.blue4 },
  { tag: t.meta, color: color.blue6 },
]);

export const mariana = [chrome, syntaxHighlighting(highlighting)];
