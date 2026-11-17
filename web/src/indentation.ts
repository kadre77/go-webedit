// Works out how a file is indented (tabs, or spaces and how many), so the
// Owner's edits match the file's existing style.

/** Used when a file has no indented lines. The settings ticket makes it adjustable. */
const defaultIndentUnit = "    ";

/** The indent unit a file uses: "\t", or a run of spaces. */
export function detectIndentUnit(text: string): string {
  let tabLines = 0;
  let spaceLines = 0;
  // How often each increase in space indentation from one line to the next
  // appears. The commonest is the file's indent width.
  const steps = new Map<number, number>();
  let previous = 0;
  for (const line of text.split(/\r?\n|\r/)) {
    if (!line.trim()) continue;
    const indent = /^[ \t]*/.exec(line)![0];
    if (indent.startsWith("\t")) {
      tabLines++;
      continue;
    }
    const width = indent.length;
    // The " * " that continues a block comment sits one space past the
    // indentation; a Markdown "* item" doesn't, so it still counts.
    if (width % 2 === 1 && /^ +\*(\s|\/|$)/.test(line)) continue;
    if (width > 0) spaceLines++;
    if (width > previous) steps.set(width - previous, (steps.get(width - previous) ?? 0) + 1);
    previous = width;
  }
  if (tabLines === 0 && spaceLines === 0) return defaultIndentUnit;
  if (tabLines > spaceLines) return "\t";
  let best = 0;
  let bestCount = 0;
  for (const [step, count] of steps) {
    if (step <= 8 && (count > bestCount || (count === bestCount && step < best))) {
      best = step;
      bestCount = count;
    }
  }
  return best ? " ".repeat(best) : defaultIndentUnit;
}
