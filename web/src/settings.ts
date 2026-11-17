// Settings: the editor's font size, word wrap, and the default tab width and
// spaces-or-tabs used where a file's indentation can't be detected. They are
// kept in this browser's localStorage, so a phone and a desktop each have
// their own. Only settings the Owner has changed are stored; the rest follow
// the defaults, so word wrap stays on for a phone viewport and off for a
// desktop one until the Owner changes it. When localStorage is unavailable
// the settings start from the defaults and last for this page only.

import { type Accessor, createSignal } from "solid-js";

/** Viewports this narrow get the phone defaults. The phone layout should
 * switch at the same width. */
export const phoneQuery = "(max-width: 700px)";

export const fontSizes = { min: 8, max: 40, default: 16 };
/** The tab widths the Owner can choose between. */
export const tabWidths = [2, 4, 8] as const;
const defaultTabWidth = 4;

type Values = {
  fontSize: number;
  wordWrap: boolean;
  tabWidth: number;
  useTabs: boolean;
};

export type Settings = { readonly [K in keyof Values]: Accessor<Values[K]> } & {
  setFontSize(size: number): void;
  setWordWrap(on: boolean): void;
  setTabWidth(width: number): void;
  setUseTabs(on: boolean): void;
  /** The indent unit for a file whose indentation can't be detected. */
  defaultIndentUnit(): string;
};

const storageKey = "webedit.settings";

const isPhone = () => {
  try {
    return matchMedia(phoneQuery).matches;
  } catch {
    return false;
  }
};

const valid: { [K in keyof Values]: (v: unknown) => v is Values[K] } = {
  fontSize: (v): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= fontSizes.min && v <= fontSizes.max,
  wordWrap: (v): v is boolean => typeof v === "boolean",
  tabWidth: (v): v is number => (tabWidths as readonly unknown[]).includes(v),
  useTabs: (v): v is boolean => typeof v === "boolean",
};

/** The settings the Owner has changed, as stored; anything unreadable is left out. */
function load(): Partial<Values> {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch (e) {
    console.warn("Couldn't read settings from browser storage; using the defaults.", e);
    return {};
  }
  const stored: Partial<Record<keyof Values, unknown>> = {};
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(valid) as (keyof Values)[]) {
      const value = (raw as Record<string, unknown>)[key];
      if (valid[key](value)) stored[key] = value;
    }
  }
  return stored as Partial<Values>;
}

export function createSettings(): Settings {
  const defaults: Values = { fontSize: fontSizes.default, wordWrap: isPhone(), tabWidth: defaultTabWidth, useTabs: false };
  const changed = load();
  const [values, setValues] = createSignal<Values>({ ...defaults, ...changed });

  let warned = false;
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    if (!valid[key](value) || values()[key] === value) return;
    changed[key] = value;
    setValues({ ...values(), [key]: value });
    try {
      localStorage.setItem(storageKey, JSON.stringify(changed));
    } catch (e) {
      if (!warned) console.warn("Couldn't store settings in browser storage; they last for this page only.", e);
      warned = true;
    }
  };

  return {
    fontSize: () => values().fontSize,
    wordWrap: () => values().wordWrap,
    tabWidth: () => values().tabWidth,
    useTabs: () => values().useTabs,
    setFontSize: (size) => set("fontSize", Math.min(fontSizes.max, Math.max(fontSizes.min, Math.round(size)))),
    setWordWrap: (on) => set("wordWrap", on),
    setTabWidth: (width) => set("tabWidth", width),
    setUseTabs: (on) => set("useTabs", on),
    defaultIndentUnit: () => (values().useTabs ? "\t" : " ".repeat(values().tabWidth)),
  };
}
