import { expect, test, type Page } from "@playwright/test";
import { clickItem, showTree } from "./ui";

// Fixtures: web/e2e/fixtures/Manage/<project>-*, so the projects, running in
// parallel against one fake Dropbox, each work on their own files.

const item = (page: Page, name: string) => page.getByRole("tree").getByRole("treeitem", { name, exact: true });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name });
const editor = (page: Page) => page.locator(".cm-content");
const menu = (page: Page) => page.getByRole("menu");
const prompt = (page: Page, name: string) => page.getByRole("dialog", { name });

/** This project's name for a file or folder in Manage. */
const nameFor = (name: string) => `${test.info().project.name}-${name}`;

/** What the server has at path: its content, or undefined if nothing. */
async function stored(page: Page, path: string) {
  const res = await page.request.get(`/api/file?path=${encodeURIComponent(path)}`);
  if (res.status() === 404) return undefined;
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { content: string }).content;
}

/** Opens the context menu on a tree row and picks an action from it. */
async function fromMenu(page: Page, row: string, action: string) {
  await showTree(page);
  await item(page, row).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: action }).click();
}

/** Types at the end of the open file's first line. */
async function typeAtEnd(page: Page, text: string) {
  await editor(page).locator(".cm-line").first().click();
  await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/auth/signin");
  await clickItem(page, "Manage", { exact: true });
});

test("a new file from the sidebar opens in a Tab, and a new folder comes from the Command Palette", async ({ page }) => {
  const file = nameFor("new.md");
  await fromMenu(page, "Manage", "New File…");
  const input = prompt(page, "New File").getByRole("textbox", { name: "Path" });
  await expect(input).toHaveValue("Manage/");
  await input.fill(`Manage/${file}`);
  await input.press("Enter");

  await expect(prompt(page, "New File")).toBeHidden();
  await expect(tab(page, file)).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, file)).not.toHaveAttribute("data-preview");
  await expect(item(page, file)).toBeVisible();
  expect(await stored(page, `Manage/${file}`)).toBe("");

  const folder = nameFor("folder");
  await page.keyboard.press("ControlOrMeta+Shift+P");
  await page.getByRole("dialog", { name: "Command Palette" }).getByRole("combobox").fill("new folder");
  await page.keyboard.press("Enter");
  // The Command Palette starts in the active Tab's folder.
  const folderInput = prompt(page, "New Folder").getByRole("textbox", { name: "Path" });
  await expect(folderInput).toHaveValue("Manage/");
  await folderInput.fill(`Manage/${folder}`);
  await prompt(page, "New Folder").getByRole("button", { name: "Create" }).click();
  await showTree(page);
  await expect(item(page, folder)).toBeVisible();
  await expect(item(page, folder)).toHaveAttribute("aria-expanded", "false");
});

test("renaming a folder moves its open Tab and the Tab's Draft along", async ({ page }) => {
  const folder = nameFor("rename");
  const moved = nameFor("renamed");
  await clickItem(page, folder, { exact: true });
  await clickItem(page, "Plan.md", { double: true, exact: true });
  await typeAtEnd(page, ": ship it");
  await expect(tab(page, "Plan.md")).toHaveAttribute("data-modified", "true");

  await fromMenu(page, folder, "Rename or Move…");
  const input = prompt(page, "Rename or Move").getByRole("textbox", { name: "Path" });
  await expect(input).toHaveValue(`Manage/${folder}`);
  await input.fill(`Manage/${moved}`);
  await input.press("Enter");

  await expect(item(page, moved)).toBeVisible();
  await expect(item(page, folder)).toHaveCount(0);
  await expect(tab(page, "Plan.md")).toHaveAttribute("title", `Manage/${moved}/Plan.md (modified)`);
  await expect(editor(page)).toHaveText("Plan: ship it");

  // The Draft was stored under the new path.
  page.once("dialog", (d) => void d.accept());
  await page.reload();
  await expect(tab(page, "Plan.md")).toHaveAttribute("title", `Manage/${moved}/Plan.md (modified)`);
  await expect(editor(page)).toHaveText("Plan: ship it");

  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, "Plan.md")).not.toHaveAttribute("data-modified");
  expect(await stored(page, `Manage/${moved}/Plan.md`)).toBe("Plan: ship it\n");
  expect(await stored(page, `Manage/${folder}/Plan.md`)).toBeUndefined();
});

test("delete asks first, then closes the file's Tab", async ({ page }) => {
  const file = nameFor("delete.md");
  await clickItem(page, file, { double: true, exact: true });
  await typeAtEnd(page, "!");

  page.once("dialog", (d) => {
    expect(d.message()).toContain(`Delete ${file}?`);
    void d.dismiss();
  });
  await fromMenu(page, file, "Delete");
  await expect(item(page, file)).toBeVisible();
  await expect(tab(page, file)).toBeVisible();
  expect(await stored(page, `Manage/${file}`)).toBe("Old notes\n");

  page.once("dialog", (d) => void d.accept());
  await fromMenu(page, file, "Delete");
  await expect(item(page, file)).toHaveCount(0);
  await expect(tab(page, file)).toHaveCount(0);
  expect(await stored(page, `Manage/${file}`)).toBeUndefined();

  // Its Draft went with it: a new file at the same path starts clean.
  await page.reload();
  await fromMenu(page, "Manage", "New File…");
  const input = prompt(page, "New File").getByRole("textbox", { name: "Path" });
  await input.fill(`Manage/${file}`);
  await input.press("Enter");
  await expect(tab(page, file)).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  await expect(editor(page)).toHaveText("");
});

test("renaming onto a name that is taken, in any case, fails with a clear message", async ({ page }) => {
  const from = nameFor("collide-a.md");
  const taken = nameFor("collide-B.md");
  await fromMenu(page, from, "Rename or Move…");
  const dialog = prompt(page, "Rename or Move");
  await dialog.getByRole("textbox", { name: "Path" }).fill(`Manage/${taken}`);
  await dialog.getByRole("button", { name: "Rename" }).click();

  await expect(dialog.getByRole("alert")).toHaveText(`Manage/${taken} already exists.`);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await stored(page, `Manage/${from}`)).toBe("A\n");
  expect(await stored(page, `Manage/${nameFor("collide-b.md")}`)).toBe("B\n");
});
