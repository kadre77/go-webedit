import { expect, test, type Page } from "@playwright/test";
import { filesButton, longPress, showTree, swipe } from "./ui";

// The phone layout. Fixtures: web/e2e/fixtures/Phone. Only the phone project
// runs these, so each file here is written by one test only.

const tree = (page: Page) => page.getByRole("tree", { name: "Root Folder" });
const item = (page: Page, name: string) => tree(page).getByRole("treeitem", { name, exact: true });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Editor actions" });
const editor = (page: Page) => page.locator(".cm-content");

/** What the server has at path: its content, or undefined if nothing. */
async function stored(page: Page, path: string) {
  const res = await page.request.get(`/api/file?path=${encodeURIComponent(path)}`);
  if (res.status() === 404) return undefined;
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { content: string }).content;
}

test.skip(({ isMobile }) => !isMobile, "the phone layout");

test.beforeEach(async ({ page }) => {
  await page.goto("/auth/signin");
  await expect(toolbar(page)).toBeVisible();
});

test("the layout switches between phone and desktop by viewport width", async ({ page }) => {
  await expect(tree(page)).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(toolbar(page)).toBeHidden();
  await expect(tree(page)).toBeVisible();
  await page.setViewportSize({ width: 412, height: 839 });
  await expect(toolbar(page)).toBeVisible();
  await expect(tree(page)).toBeHidden();
});

test("the sidebar is a drawer, opened by the Files button and closed once a file is opened", async ({ page }) => {
  await expect(filesButton(page)).toHaveAttribute("aria-expanded", "false");
  await filesButton(page).tap();
  await expect(filesButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(tree(page)).toBeVisible();

  // Opening a folder keeps the drawer open; opening a file closes it.
  await item(page, "Phone").tap();
  await expect(item(page, "save.md")).toBeVisible();
  await item(page, "save.md").tap();
  await expect(tree(page)).toBeHidden();
  await expect(filesButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(tab(page, "save.md")).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toHaveText("Shopping list");

  // Tapping beside the open drawer closes it.
  await filesButton(page).tap();
  await expect(tree(page)).toBeVisible();
  const scrim = page.getByRole("button", { name: "Close the file list" });
  const box = (await scrim.boundingBox())!;
  await scrim.tap({ position: { x: box.width - 20, y: box.height / 2 } });
  await expect(tree(page)).toBeHidden();
});

test("a swipe in from the left edge opens the drawer, and a swipe back closes it", async ({ page }) => {
  const y = (page.viewportSize()!.height * 2) / 3;
  await swipe(page, 4, 250, y);
  await expect(tree(page)).toBeVisible();
  await swipe(page, 250, 20, y);
  await expect(tree(page)).toBeHidden();
});

test("a file is edited on the phone and saved with the toolbar", async ({ page }) => {
  await showTree(page);
  await item(page, "Phone").tap();
  await item(page, "save.md").tap();
  await editor(page).locator(".cm-line").first().tap();
  await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
  await page.keyboard.press("End");
  await page.keyboard.type(": eggs");

  // The modified dot shows in the tab strip without hovering.
  await expect(tab(page, "save.md")).toHaveAttribute("data-modified", "true");
  await expect(page.locator(".tab.modified .tab-dot")).toBeVisible();

  await toolbar(page).getByRole("button", { name: "Save" }).tap();
  await expect(tab(page, "save.md")).not.toHaveAttribute("data-modified");
  expect(await stored(page, "Phone/save.md")).toBe("Shopping list: eggs\n");
  // The editor kept focus, so the on-screen keyboard would stay up.
  await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
});

test("the toolbar opens Goto Anything and the Command Palette", async ({ page }) => {
  await toolbar(page).getByRole("button", { name: "Goto Anything" }).tap();
  const goto = page.getByRole("dialog", { name: "Goto Anything" });
  await expect(goto).toBeVisible();
  await goto.getByRole("combobox").fill("phone/goto");
  await goto.getByRole("option").first().tap();
  await expect(tab(page, "goto.md")).toHaveAttribute("aria-selected", "true");

  await toolbar(page).getByRole("button", { name: "Command Palette" }).tap();
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeVisible();
});

test("a long-press on a drawer entry opens the file-management menu", async ({ page }) => {
  await showTree(page);
  await item(page, "Phone").tap();
  await longPress(page, item(page, "press.md"));

  const menu = page.getByRole("menu", { name: "Actions for press.md" });
  await expect(menu).toBeVisible();
  // The long-press didn't also open the file.
  await expect(tab(page, "press.md")).toHaveCount(0);

  await menu.getByRole("menuitem", { name: "Rename or Move…" }).tap();
  const dialog = page.getByRole("dialog", { name: "Rename or Move" });
  await dialog.getByRole("textbox", { name: "Path" }).fill("Phone/pressed.md");
  await dialog.getByRole("button", { name: "Rename" }).tap();
  await expect(dialog).toBeHidden();
  await expect(item(page, "pressed.md")).toBeVisible();
  expect(await stored(page, "Phone/pressed.md")).toBe("Pressed\n");
  expect(await stored(page, "Phone/press.md")).toBeUndefined();
});
