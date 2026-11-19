import { expect, test, type Page } from "@playwright/test";
import { clickItem, showTree } from "./ui";

// Fixtures: web/e2e/fixtures (readme.md, Notes/Today.md, Notes/Archive/2020.md).

const item = (page: Page, name: string) => page.getByRole("tree").getByRole("treeitem", { name });
const tabs = (page: Page) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name });
const editor = (page: Page) => page.locator(".cm-content");

test.beforeEach(async ({ page }) => {
  await page.goto("/auth/signin");
  await clickItem(page, "Notes");
});

test("a single click opens a Preview Tab that the next single click replaces", async ({ page }) => {
  await clickItem(page, "readme.md");
  await expect(tabs(page)).toHaveCount(1);
  await expect(tab(page, "readme.md")).toHaveAttribute("data-preview", "true");
  await expect(editor(page)).toContainText("Read me first.");

  await clickItem(page, "Today.md");
  await expect(tabs(page)).toHaveCount(1);
  await expect(tab(page, "Today.md")).toHaveAttribute("data-preview", "true");
  await expect(tab(page, "Today.md")).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toContainText("Buy milk.");
});

test("double-clicking a file in the tree opens it as a normal Tab", async ({ page }) => {
  await clickItem(page, "readme.md", { double: true });
  await expect(tab(page, "readme.md")).not.toHaveAttribute("data-preview");

  await clickItem(page, "Today.md");
  await expect(tabs(page)).toHaveText(["readme.md", "Today.md"]);
  await expect(tab(page, "Today.md")).toHaveAttribute("data-preview", "true");
});

test("double-clicking the Preview Tab pins it", async ({ page }) => {
  await clickItem(page, "readme.md");
  await tab(page, "readme.md").dblclick();
  await expect(tab(page, "readme.md")).not.toHaveAttribute("data-preview");

  await clickItem(page, "Today.md");
  await expect(tabs(page)).toHaveText(["readme.md", "Today.md"]);
});

test("editing the Preview Tab pins it", async ({ page }) => {
  await clickItem(page, "readme.md");
  await editor(page).click();
  await page.keyboard.type("Edited. ");
  await expect(tab(page, "readme.md")).not.toHaveAttribute("data-preview");

  await clickItem(page, "Today.md");
  await expect(tabs(page)).toHaveText(["readme.md", "Today.md"]);
});

test("opening a file that is already open activates its Tab", async ({ page }) => {
  await clickItem(page, "readme.md", { double: true });
  await clickItem(page, "Today.md");
  await clickItem(page, "readme.md");
  await expect(tabs(page)).toHaveText(["readme.md", "Today.md"]);
  await expect(tab(page, "readme.md")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Today.md")).toHaveAttribute("data-preview", "true");
  await expect(editor(page)).toContainText("Read me first.");
});

// Opens readme.md, Today.md and 2020.md as normal Tabs, with 2020.md active.
async function openThree(page: Page) {
  await clickItem(page, "readme.md", { double: true });
  await clickItem(page, "Today.md", { double: true });
  await clickItem(page, "Archive");
  await clickItem(page, "2020.md", { double: true });
  await expect(tabs(page)).toHaveText(["readme.md", "Today.md", "2020.md"]);
  await expect(editor(page)).toContainText("Old notes.");
  await editor(page).click();
}

const active = (page: Page) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { selected: true });

test("Ctrl+Tab, Ctrl+PageUp and Ctrl+PageDown switch Tabs, wrapping around", async ({ page }) => {
  await openThree(page);
  await page.keyboard.press("Control+Tab");
  await expect(active(page)).toHaveText("readme.md");
  await expect(editor(page)).toContainText("Read me first.");
  await page.keyboard.press("ControlOrMeta+PageDown");
  await expect(active(page)).toHaveText("Today.md");
  await page.keyboard.press("ControlOrMeta+PageUp");
  await page.keyboard.press("ControlOrMeta+PageUp");
  await expect(active(page)).toHaveText("2020.md");
  await page.keyboard.press("Control+Shift+Tab");
  await expect(active(page)).toHaveText("Today.md");
});

test("Alt+] and Alt+[ switch Tabs in an ordinary browser tab, wrapping around", async ({ page }) => {
  await openThree(page);
  await page.keyboard.press("Alt+BracketRight");
  await expect(active(page)).toHaveText("readme.md");
  await page.keyboard.press("Alt+BracketLeft");
  await expect(active(page)).toHaveText("2020.md");
  await page.keyboard.press("Alt+BracketLeft");
  await expect(active(page)).toHaveText("Today.md");
});

test("Alt+Shift+number jumps to a Tab and Alt+W closes it, in an ordinary browser tab", async ({ page }) => {
  await openThree(page);
  await page.keyboard.press("Alt+Shift+Digit1");
  await expect(active(page)).toHaveText("readme.md");
  await page.keyboard.press("Alt+Shift+Digit2");
  await expect(active(page)).toHaveText("Today.md");
  await page.keyboard.press("Alt+KeyW");
  await expect(tabs(page)).toHaveText(["readme.md", "2020.md"]);
  await expect(active(page)).toHaveText("2020.md");
});

test("the browser-safe Tab keys go by physical key, as on macOS where Option types a symbol", async ({ page }) => {
  await openThree(page);
  // What macOS sends for Option+] and Option+W: the key is a symbol, the code the physical key.
  const press = (key: string, code: string) =>
    page.evaluate(([key, code]) => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, code, altKey: true, bubbles: true, cancelable: true }));
    }, [key, code]);
  await press("‘", "BracketRight");
  await expect(active(page)).toHaveText("readme.md");
  await press("∑", "KeyW");
  await expect(tabs(page)).toHaveText(["Today.md", "2020.md"]);
});

test("Alt+number jumps to a Tab", async ({ page }) => {
  await openThree(page);
  await page.keyboard.press("Alt+1");
  await expect(active(page)).toHaveText("readme.md");
  await page.keyboard.press("Alt+2");
  await expect(active(page)).toHaveText("Today.md");
  await page.keyboard.press("Alt+9");
  await expect(active(page)).toHaveText("Today.md");
});

test("Ctrl+W closes the active Tab, and the next one takes its place", async ({ page }) => {
  await openThree(page);
  await page.keyboard.press("Alt+2");
  await page.keyboard.press("ControlOrMeta+w");
  await expect(tabs(page)).toHaveText(["readme.md", "2020.md"]);
  await expect(active(page)).toHaveText("2020.md");
  await page.keyboard.press("ControlOrMeta+w");
  await expect(active(page)).toHaveText("readme.md");
  await page.keyboard.press("ControlOrMeta+w");
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.getByText(/^Pick a file/)).toBeVisible();
});

test("the close button closes its Tab", async ({ page }) => {
  await openThree(page);
  await page.getByRole("button", { name: "Close Today.md" }).click();
  await expect(tabs(page)).toHaveText(["readme.md", "2020.md"]);
  await expect(active(page)).toHaveText("2020.md");
});

test("the active Tab's file is highlighted in the tree, with its folders expanded", async ({ page }) => {
  await openThree(page);
  await showTree(page);
  await expect(item(page, "2020.md")).toHaveAttribute("aria-selected", "true");

  // Collapsing the active file's folder is allowed...
  await clickItem(page, "Notes");
  await expect(item(page, "Notes")).toHaveAttribute("aria-expanded", "false");
  await expect(item(page, "2020.md")).toHaveCount(0);
  await expect(item(page, "readme.md")).toHaveAttribute("aria-selected", "false");

  // ...and switching to a Tab reveals its file again.
  await page.keyboard.press("Alt+2");
  await showTree(page);
  await expect(item(page, "Today.md")).toHaveAttribute("aria-selected", "true");
  await expect(item(page, "Notes")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Alt+3");
  await showTree(page);
  await expect(item(page, "2020.md")).toHaveAttribute("aria-selected", "true");
});

test("each Tab keeps its own cursor and undo history", async ({ page }) => {
  await openThree(page);
  await page.keyboard.press("Alt+1");
  await editor(page).getByText("Read me first.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" One");

  await page.keyboard.press("Alt+2");
  await expect(editor(page)).toContainText("Buy milk.");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Two");

  await page.keyboard.press("Alt+1");
  await expect(editor(page)).toContainText("Read me first. One");
  // The cursor is where it was: typing continues the first line.
  await page.keyboard.type(" more");
  await expect(editor(page).locator(".cm-line").first()).toHaveText("Read me first. One more");
  // Undo history belongs to this Tab: undo removes this Tab's typing only.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page).locator(".cm-line").first()).toHaveText("Read me first.");

  await page.keyboard.press("Alt+2");
  await expect(editor(page)).toContainText("Two");
});

test("the last file clicked wins the Preview Tab, even if an earlier one loads later", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/file?path=readme.md", async (route) => {
    await held;
    await route.continue();
  });
  await clickItem(page, "readme.md");
  await clickItem(page, "Today.md");
  await expect(editor(page)).toContainText("Buy milk.");
  release();
  await page.waitForResponse("**/api/file?path=readme.md");
  await expect(tabs(page)).toHaveText(["Today.md"]);
  await expect(editor(page)).toContainText("Buy milk.");
});
