import { expect, test, type Page } from "@playwright/test";

// Fixtures: web/e2e/fixtures/Drafts/<project>-<test>.md, each "Shopping
// list\n". Each test has its own file, since the projects and tests run in
// parallel against one fake Dropbox.

const item = (page: Page, name: string) => page.getByRole("tree").getByRole("treeitem", { name });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name });
const tabs = (page: Page) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
const editor = (page: Page) => page.locator(".cm-content");
const alert = (page: Page) => page.getByRole("alert");

/** The file this test may write, for this project. */
const fileFor = (name: string) => `${test.info().project.name}-${name}.md`;

/** Opens Drafts/<file> as a normal Tab. */
async function openFile(page: Page, file: string) {
  await item(page, "Drafts").click();
  await item(page, file).dblclick();
  await expect(editor(page)).toContainText("Shopping list");
}

/** Types at the end of the open file's first line. */
async function typeAtEnd(page: Page, text: string) {
  await editor(page).locator(".cm-line").first().click();
  await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

/** Reloads the page, agreeing to leave it if the app asks. */
async function reload(page: Page) {
  page.once("dialog", (d) => void d.accept());
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/auth/signin");
});

test("a Draft and the open Tabs survive a reload", async ({ page }) => {
  const file = fileFor("restore");
  await item(page, "readme.md").dblclick();
  await openFile(page, file);
  await item(page, "Notes").click();
  await item(page, "Today.md").click(); // the Preview Tab
  await tab(page, file).click();
  await typeAtEnd(page, ": eggs");
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");

  await reload(page);
  await expect(tabs(page)).toHaveText(["readme.md", file, "Today.md"]);
  await expect(tab(page, file)).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");
  await expect(tab(page, "Today.md")).toHaveAttribute("data-preview", "true");
  await expect(tab(page, "readme.md")).not.toHaveAttribute("data-modified");
  await expect(editor(page)).toHaveText("Shopping list: eggs");
  await expect(alert(page)).toHaveCount(0);
});

/** The file's content and revision as the server has it now. */
async function stored(page: Page, file: string) {
  const res = await page.request.get(`/api/file?path=${encodeURIComponent(`Drafts/${file}`)}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as { content: string; rev: string };
}

const origin = (page: Page) => ({ Origin: new URL(page.url()).origin });

/** Changes Drafts/<file> in the fake Dropbox, as another device would. */
async function changeElsewhere(page: Page, file: string, content: string) {
  const data = { path: `Drafts/${file}`, content };
  const res = await page.request.put("/api/test/file", { headers: origin(page), data });
  expect(res.ok()).toBe(true);
}

/** Deletes Drafts/<file> in the fake Dropbox, as another device would. */
async function deleteElsewhere(page: Page, file: string) {
  const url = `/api/test/file?path=${encodeURIComponent(`Drafts/${file}`)}`;
  const res = await page.request.delete(url, { headers: origin(page) });
  expect(res.ok()).toBe(true);
}

test("a saved file has no Draft after a reload", async ({ page }) => {
  const file = fileFor("save");
  await openFile(page, file);
  await typeAtEnd(page, ": milk");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect((await stored(page, file)).content).toBe("Shopping list: milk\n");

  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.reload();
  await expect(tab(page, file)).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toHaveText("Shopping list: milk");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
});

test("a restored Draft of a file changed elsewhere still raises a Save Conflict", async ({ page }) => {
  const file = fileFor("conflict");
  await openFile(page, file);
  await typeAtEnd(page, ": mine");
  await reload(page);
  await expect(editor(page)).toHaveText("Shopping list: mine");

  await changeElsewhere(page, file, "Shopping list: theirs\n");
  await reload(page);
  await expect(editor(page)).toHaveText("Shopping list: mine");
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");
  await expect(alert(page)).toContainText(`${file} changed in Dropbox`);

  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("dialog", { name: "Save Conflict" })).toBeVisible();
  expect((await stored(page, file)).content).toBe("Shopping list: theirs\n");
});

test("a restored Draft of a file deleted elsewhere is kept, and the Owner is told", async ({ page }) => {
  const file = fileFor("gone");
  await openFile(page, file);
  await typeAtEnd(page, ": keep me");
  await deleteElsewhere(page, file);

  await reload(page);
  await expect(alert(page)).toContainText(`${file} is no longer in Dropbox`);
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");
  await expect(editor(page)).toHaveText("Shopping list: keep me");
});

test("a restored Draft is kept when Dropbox can't be reached, and saves once it can", async ({ page }) => {
  const file = fileFor("offline");
  await openFile(page, file);
  await typeAtEnd(page, ": jam");

  await page.route("**/api/file?*", (route) => route.fulfill({ status: 503, json: { code: "dropbox-unavailable", message: "Dropbox is unavailable." } }));
  await reload(page);
  await expect(alert(page)).toContainText(`Couldn't open ${file}`);
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");
  await expect(editor(page)).toHaveText("Shopping list: jam");

  await page.unroute("**/api/file?*");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect((await stored(page, file)).content).toBe("Shopping list: jam\n");
});

test("leaving the page with a Draft asks first", async ({ page }) => {
  await item(page, "readme.md").click();
  await typeAtEnd(page, "!");
  await expect(tab(page, "readme.md")).toHaveAttribute("data-modified", "true");

  const asked = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  expect((await asked).type()).toBe("beforeunload");
});

test("the app works without browser storage, keeping Drafts for the page only", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new DOMException("storage is disabled", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.reload();

  const file = fileFor("nostorage");
  await openFile(page, file);
  await typeAtEnd(page, ": tea");
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect((await stored(page, file)).content).toBe("Shopping list: tea\n");
  await expect(alert(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
