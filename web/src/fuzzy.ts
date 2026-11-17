// Fuzzy matching for the finder: the query's characters must appear in the
// text in order, ignoring case. Runs of consecutive characters and characters
// at the start of a word score higher; gaps between them cost a little.

export type FuzzyMatch = {
  score: number;
  /** Where each of the query's characters matched in the text. */
  positions: number[];
};

const matchScore = 16;
const boundaryBonus = 8;
const consecutiveBonus = 12;
const gapPenalty = 1;

const separators = "/\\_-. ";

/** Whether position i starts a word: after a separator, or a camelCase hump. */
function startsWord(text: string, i: number) {
  if (i === 0) return true;
  const prev = text[i - 1];
  if (separators.includes(prev)) return true;
  const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase();
  const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();
  return isLower(prev) && isUpper(text[i]);
}

/** Where the file name starts in a path. */
export const nameStartOf = (path: string) => path.lastIndexOf("/") + 1;

/** The best way to match query in text, or undefined if it doesn't. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | undefined {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const n = q.length;
  const m = t.length;
  if (n === 0) return { score: 0, positions: [] };
  if (n > m) return undefined;

  // best[i*m + j]: the best score with q[i] matched at t[j]; from[i*m + j]:
  // where q[i-1] was matched for it.
  const best = new Float64Array(n * m).fill(-Infinity);
  const from = new Int32Array(n * m).fill(-1);
  for (let i = 0; i < n; i++) {
    // The best match of q[i-1] at k <= j-2, as score + gapPenalty*k, so the
    // gap's cost to j can be taken off in one step.
    let gapped = -Infinity;
    let gappedAt = -1;
    for (let j = i; j < m; j++) {
      if (i > 0 && j >= 2) {
        const k = j - 2;
        const s = best[(i - 1) * m + k] + gapPenalty * k;
        if (s > gapped) {
          gapped = s;
          gappedAt = k;
        }
      }
      if (t[j] !== q[i]) continue;
      const gain = matchScore + (startsWord(text, j) ? boundaryBonus : 0);
      if (i === 0) {
        best[j] = gain;
        continue;
      }
      let score = gapped - gapPenalty * (j - 1);
      let prev = gappedAt;
      const run = best[(i - 1) * m + j - 1] + consecutiveBonus;
      if (run >= score) {
        score = run;
        prev = j - 1;
      }
      if (score === -Infinity) continue;
      best[i * m + j] = score + gain;
      from[i * m + j] = prev;
    }
  }

  let end = -1;
  for (let j = n - 1; j < m; j++) {
    if (best[(n - 1) * m + j] > (end < 0 ? -Infinity : best[(n - 1) * m + end])) end = j;
  }
  if (end < 0 || best[(n - 1) * m + end] === -Infinity) return undefined;
  const positions = new Array<number>(n);
  for (let i = n - 1, j = end; i >= 0; j = from[i * m + j], i--) positions[i] = j;
  return { score: best[(n - 1) * m + end], positions };
}

/** Like fuzzyMatch, but spaces in the query and the text are ignored, so
 * "close tab" matches "Close Tab". Positions are in the text as given. */
export function fuzzyMatchWords(query: string, text: string): FuzzyMatch | undefined {
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) at.push(i);
  const match = fuzzyMatch(query.replace(/\s+/g, ""), at.map((i) => text[i]).join(""));
  return match && { score: match.score, positions: match.positions.map((p) => at[p]) };
}

export type PathMatch = { path: string; positions: number[] };

/**
 * The paths that match the query, best first. A match within the file name
 * beats one spread across the folders; spaces in the query are ignored.
 * An empty query lists every path, sorted.
 */
export function rankPaths(query: string, paths: readonly string[]): PathMatch[] {
  const q = query.replace(/\s+/g, "");
  if (!q) return [...paths].sort((a, b) => a.localeCompare(b)).map((path) => ({ path, positions: [] }));
  const ranked: (PathMatch & { inName: boolean; score: number })[] = [];
  for (const path of paths) {
    const nameStart = nameStartOf(path);
    const inName = q.includes("/") ? undefined : fuzzyMatch(q, path.slice(nameStart));
    if (inName) {
      ranked.push({ path, inName: true, score: inName.score, positions: inName.positions.map((p) => p + nameStart) });
      continue;
    }
    const anywhere = fuzzyMatch(q, path);
    if (anywhere) ranked.push({ path, inName: false, ...anywhere });
  }
  ranked.sort(
    (a, b) =>
      Number(b.inName) - Number(a.inName) ||
      b.score - a.score ||
      a.path.length - b.path.length ||
      a.path.localeCompare(b.path),
  );
  return ranked.map(({ path, positions }) => ({ path, positions }));
}
