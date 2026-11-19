// The App state's ordering rules, in process: answers that arrive late or
// out of order, against an in-memory Root Folder that holds calls on request.

import { Text } from "@codemirror/state";
import { createRoot } from "solid-js";
import { describe, expect, onTestFinished, test } from "vitest";
import type { StoredDraft, StoredTabs } from "./draftStore";
import { ApiError } from "./api";
import { createAppState } from "./appState";
import { FakeRootFolder } from "./testing/fakeRootFolder";
import { memoryDraftStore } from "./testing/memoryDraftStore";

function setup(files: Record<string, string>, storedTabs?: StoredTabs, storedDrafts?: Record<string, StoredDraft>) {
  const root = new FakeRootFolder(files);
  const drafts = memoryDraftStore(storedTabs, storedDrafts);
  const state = createRoot((dispose) => {
    onTestFinished(dispose);
    return createAppState({ api: root, drafts, confirm: () => true });
  });
  const tabPaths = () => state.tabs().map((t) => t.path);
  const tab = (path: string) => {
    const t = state.tabs().find((t) => t.path === path);
    if (!t) throw new Error(`no Tab for ${path}`);
    return t;
  };
  /** Types text at the end of the Tab's file, as the editor would. */
  const type = (path: string, text: string) => {
    const doc = tab(path).doc();
    state.edit(tab(path), doc.replace(doc.length, doc.length, Text.of([text])));
  };
  return { root, drafts, state, tabPaths, tab, type };
}

describe("opening", () => {
  test("the last file opened wins, even if an earlier one loads later", async () => {
    const { root, state, tabPaths } = setup({ "a.md": "A", "b.md": "B" });
    const held = root.hold("openFile");
    const first = state.openFile("a.md");
    await held.reached;
    await state.openFile("b.md");
    held.release();
    await first;
    expect(tabPaths()).toEqual(["b.md"]);
    expect(state.activeTab()?.path).toBe("b.md");
    expect(state.isPreview("b.md")).toBe(true);
  });

  test("opening a file twice at once (a double click) fetches it once and opens one Tab", async () => {
    const { root, state, tabPaths } = setup({ "a.md": "A" });
    await Promise.all([state.openFile("a.md"), state.openFile("a.md", { pinned: true })]);
    expect(root.calls("openFile")).toBe(1);
    expect(tabPaths()).toEqual(["a.md"]);
    expect(state.isPreview("a.md")).toBe(false);
  });
});

describe("saving", () => {
  test("a second save while the first is under way sends nothing", async () => {
    const { root, state, type } = setup({ "a.md": "A" });
    await state.openFile("a.md");
    type("a.md", "1");
    const held = root.hold("saveFile");
    const first = state.save();
    await held.reached;
    type("a.md", "2");
    await state.save();
    held.release();
    await first;
    expect(root.calls("saveFile")).toBe(1);
    expect(root.content("a.md")).toBe("A1");
    expect(state.activeTab()?.modified()).toBe(true);
  });
});

describe("outside changes", () => {
  test("a Tab being saved isn't checked", async () => {
    const { root, state, type } = setup({ "a.md": "A" });
    await state.openFile("a.md");
    type("a.md", "1");
    const held = root.hold("saveFile");
    const save = state.save();
    await held.reached;
    await state.checkOutsideChanges();
    held.release();
    await save;
    expect(root.calls("checkFile")).toBe(0);
    expect(state.error()).toBeUndefined();
  });

  test("a save that finishes during the check isn't taken for an outside change", async () => {
    const { root, state, tab, type } = setup({ "a.md": "A" });
    await state.openFile("a.md");
    type("a.md", "1");
    const held = root.hold("checkFile");
    const check = state.checkOutsideChanges();
    await held.reached;
    await state.save();
    // Typing on after the save, so the check finds a Draft it could warn about.
    type("a.md", "2");
    held.release();
    await check;
    expect(state.error()).toBeUndefined();
    expect(tab("a.md").doc().toString()).toBe("A12");
  });

  test("a Tab without a Draft reloads a change made elsewhere", async () => {
    const { root, state, tab } = setup({ "a.md": "A" });
    await state.openFile("a.md");
    root.write("a.md", "A elsewhere");
    await state.checkOutsideChanges();
    expect(tab("a.md").doc().toString()).toBe("A elsewhere");
    expect(state.error()).toBeUndefined();
  });

  test("typing while the outside change loads keeps the Draft and tells the Owner", async () => {
    const { root, state, tab, type } = setup({ "a.md": "A" });
    await state.openFile("a.md");
    root.write("a.md", "A elsewhere");
    const held = root.hold("openFile");
    const check = state.checkOutsideChanges();
    await held.reached;
    type("a.md", "1");
    held.release();
    await check;
    expect(tab("a.md").doc().toString()).toBe("A1");
    expect(tab("a.md").modified()).toBe(true);
    expect(state.error()).toContain("a.md changed in Dropbox");
  });

  test("a Tab closed during the check is left alone", async () => {
    const { root, state, type } = setup({ "a.md": "A" });
    await state.openFile("a.md");
    type("a.md", "1");
    root.write("a.md", "A elsewhere");
    const held = root.hold("checkFile");
    const check = state.checkOutsideChanges();
    await held.reached;
    state.close("a.md");
    held.release();
    await check;
    expect(state.error()).toBeUndefined();
  });
});

describe("restoring", () => {
  test("a Tab opened while the stored Tabs load stays, after the restored ones", async () => {
    const { root, state, tabPaths } = setup(
      { "a.md": "A", "b.md": "B" },
      { tabs: [{ path: "a.md", preview: false }], active: "a.md" },
    );
    const held = root.hold("openFile");
    const restore = state.restore();
    await held.reached;
    await state.openFile("b.md", { pinned: true });
    held.release();
    await restore;
    expect(tabPaths()).toEqual(["a.md", "b.md"]);
    expect(state.activeTab()?.path).toBe("b.md");
  });

  test("the open Tabs aren't stored until the stored ones are back", async () => {
    const stored = { tabs: [{ path: "a.md", preview: false }], active: "a.md" };
    const { root, drafts, state } = setup({ "a.md": "A", "b.md": "B" }, stored);
    const held = root.hold("openFile");
    const restore = state.restore();
    await held.reached;
    await state.openFile("b.md", { pinned: true });
    expect(drafts.tabs).toEqual(stored);
    held.release();
    await restore;
    expect(drafts.tabs).toEqual({
      tabs: [
        { path: "a.md", preview: false },
        { path: "b.md", preview: false },
      ],
      active: "b.md",
    });
  });

  test("a tree that loads late doesn't hide the notice about a restored Draft", async () => {
    const { root, state, tab } = setup(
      { "a.md": "A" },
      { tabs: [{ path: "a.md", preview: false }], active: "a.md" },
      { "a.md": { content: "A draft", rev: "rev1" } },
    );
    root.fail("openFile", new ApiError(503, "dropbox-unavailable", "Dropbox is unavailable."));
    const held = root.hold("tree");
    const tree = state.loadTree();
    await held.reached;
    await state.restore();
    held.release();
    await tree;
    expect(tab("a.md").doc().toString()).toBe("A draft");
    expect(state.error()).toContain("Couldn't open a.md");
  });

  test("a tree that loads after failing clears its own failure", async () => {
    const { root, state } = setup({ "a.md": "A" });
    root.fail("tree", new ApiError(503, "dropbox-unavailable", "Dropbox is unavailable."));
    await state.loadTree();
    expect(state.error()).toBe("Dropbox is unavailable.");
    await state.loadTree();
    expect(state.error()).toBeUndefined();
  });
});
