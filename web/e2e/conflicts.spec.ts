import { expect, test, type Page } from "@playwright/test";
import { clickItem, showTree } from "./ui";

// Fixtures: web/e2e/fixtures/Conflicts/<project>-<test>.md, each "Shopping
// list\n". Each test changes its own file, since the projects and tests run
// in parallel against one fake Dropbox. Another device's edits are made
// through the test-mode hook, PUT /api/test/file.

const item = (page: Page, name: string) => page.getByRole("tree").getByRole("treeitem", { name });
const tab = (page: Page, name: string | RegExp) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name });
const tabs = (page: Page) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
const editor = (page: Page) => page.locator(".cm-content");
const alert = (page: Page) => page.getByRole("alert");
const conflictDialog = (page: Page) => page.getByRole("dialog", { name: "Save Conflict" });

/** The file this test may write, for this project. */
const fileFor = (name: string) => `${test.info().project.name}-${name}.md`;

/** The file's content as the server has it now. */
async function stored(page: Page, path: string) {
  const res = await page.request.get(`/api/file?path=${encodeURIComponent(path)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { content: string; rev: string }).content;
}

/** Changes a file in the fake Dropbox, as another device would. */
async function changeElsewhere(page: Page, path: string, content: string) {
  const origin = new URL(page.url()).origin;
  const res = await page.request.put("/api/test/file", { headers: { Origin: origin }, data: { path, content } });
  expect(res.ok()).toBe(true);
}

/** Opens Conflicts/<file>. */
async function openFile(page: Page, file: string) {
  await clickItem(page, "Conflicts");
  await clickItem(page, file);
  await expect(editor(page)).toContainText("Shopping list");
}

/** Types at the end of the open file's first line. */
async function typeAtEnd(page: Page, text: string) {
  await editor(page).locator(".cm-line").first().click();
  await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

/** Opens the file, edits it, lets another device change it, then saves. */
async function provokeConflict(page: Page, file: string) {
  await openFile(page, file);
  await typeAtEnd(page, ": mine");
  await changeElsewhere(page, `Conflicts/${file}`, "Shopping list: theirs\n");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(conflictDialog(page)).toBeVisible();
  await expect(conflictDialog(page)).toContainText(file);
}

/** What the app does when the window regains focus. */
const regainFocus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

test.beforeEach(async ({ page }) => {
  await page.goto("/auth/signin");
});

test("Save Conflict: overwrite with mine saves the Draft over their version", async ({ page }) => {
  const file = fileFor("overwrite");
  await provokeConflict(page, file);

  await conflictDialog(page).getByRole("button", { name: "Overwrite with mine" }).click();
  await expect(conflictDialog(page)).toBeHidden();
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect(await stored(page, `Conflicts/${file}`)).toBe("Shopping list: mine\n");

  // The Tab now holds the new revision: the next save goes through.
  await page.keyboard.type(", eggs");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect(await stored(page, `Conflicts/${file}`)).toBe("Shopping list: mine, eggs\n");
  await expect(alert(page)).toHaveCount(0);
});

test("Save Conflict: reload theirs replaces the Draft with Dropbox's version", async ({ page }) => {
  const file = fileFor("reload");
  await provokeConflict(page, file);

  await conflictDialog(page).getByRole("button", { name: "Reload theirs" }).click();
  await expect(conflictDialog(page)).toBeHidden();
  await expect(editor(page)).toHaveText("Shopping list: theirs");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect(await stored(page, `Conflicts/${file}`)).toBe("Shopping list: theirs\n");

  // Edits from here save over their revision without a conflict.
  await typeAtEnd(page, ", milk");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect(await stored(page, `Conflicts/${file}`)).toBe("Shopping list: theirs, milk\n");
});

test("Save Conflict: save mine as a copy opens the copy and leaves the original", async ({ page }) => {
  const file = fileFor("copy");
  await provokeConflict(page, file);

  await conflictDialog(page).getByRole("button", { name: "Save mine as a copy" }).click();
  await expect(conflictDialog(page)).toBeHidden();
  const copy = tab(page, /conflicted copy/);
  await expect(copy).toHaveAttribute("aria-selected", "true");
  await expect(copy).not.toHaveAttribute("data-modified");
  await expect(editor(page)).toHaveText("Shopping list: mine");
  const copyName = (await copy.textContent())!;
  expect(copyName).toMatch(new RegExp(`^${test.info().project.name}-copy \\(conflicted copy .+\\)\\.md$`));
  expect(await stored(page, `Conflicts/${copyName}`)).toBe("Shopping list: mine\n");

  // The original is untouched in Dropbox, and its Tab now shows their version.
  expect(await stored(page, `Conflicts/${file}`)).toBe("Shopping list: theirs\n");
  await tab(page, file).click();
  await expect(editor(page)).toHaveText("Shopping list: theirs");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  await showTree(page);
  await expect(item(page, copyName)).toBeVisible();
});

test("Save Conflict: cancelling keeps the Draft unsaved", async ({ page }) => {
  const file = fileFor("cancel");
  await provokeConflict(page, file);
  await page.keyboard.press("Escape");
  await expect(conflictDialog(page)).toBeHidden();
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");
  await expect(editor(page)).toHaveText("Shopping list: mine");
  expect(await stored(page, `Conflicts/${file}`)).toBe("Shopping list: theirs\n");
});

test("on focus, a Tab without a Draft quietly reloads a file changed elsewhere", async ({ page }) => {
  const file = fileFor("quiet");
  await openFile(page, file);
  await clickItem(page, "readme.md", { double: true }); // a second Tab, unchanged in Dropbox
  await tab(page, file).click();

  await changeElsewhere(page, `Conflicts/${file}`, "Shopping list: from my phone\n");
  await regainFocus(page);
  await expect(editor(page)).toHaveText("Shopping list: from my phone");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  await expect(alert(page)).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(2);

  // It saves over the reloaded revision without a conflict.
  await typeAtEnd(page, "!");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect(await stored(page, `Conflicts/${file}`)).toBe("Shopping list: from my phone!\n");
});

test("on focus, a Tab with a Draft keeps it and says the file changed elsewhere", async ({ page }) => {
  const file = fileFor("notice");
  await openFile(page, file);
  await typeAtEnd(page, ": draft");
  await changeElsewhere(page, `Conflicts/${file}`, "Shopping list: from my phone\n");

  await regainFocus(page);
  await expect(alert(page)).toContainText(`${file} changed in Dropbox`);
  await expect(editor(page)).toHaveText("Shopping list: draft");
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");

  // The next save raises the Save Conflict.
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(conflictDialog(page)).toBeVisible();
});

test("Refresh reloads the tree from Dropbox", async ({ page }) => {
  const added = fileFor("added");
  await clickItem(page, "Conflicts");
  await expect(item(page, fileFor("quiet"))).toBeVisible();
  await changeElsewhere(page, `Conflicts/${added}`, "New\n");
  await expect(item(page, added)).toHaveCount(0);

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(item(page, added)).toBeVisible();
});
