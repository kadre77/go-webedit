import { expect, test, type Page } from "@playwright/test";

// Fixtures: web/e2e/fixtures/Saving/<project>-<test>.md, each "Shopping list\n".
// Tests that write get a file of their own, since the projects and tests run
// in parallel against one fake Dropbox.

const item = (page: Page, name: string) => page.getByRole("tree").getByRole("treeitem", { name });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name });
const tabs = (page: Page) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
const editor = (page: Page) => page.locator(".cm-content");
const alert = (page: Page) => page.getByRole("alert");

/** The file this test may write, for this project. */
const fileFor = (name: string) => `${test.info().project.name}-${name}.md`;

/** The file's content as the server has it now. */
async function stored(page: Page, file: string) {
  const res = await page.request.get(`/api/file?path=${encodeURIComponent(`Saving/${file}`)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { content: string; rev: string });
}

/** Opens Saving/<file> and types at the end of its first line. */
async function openAndEdit(page: Page, file: string, text: string) {
  await item(page, "Saving").click();
  await item(page, file).click();
  await expect(editor(page)).toContainText("Shopping list");
  await editor(page).locator(".cm-line").first().click();
  await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/auth/signin");
});

test("Ctrl+S saves the active Tab to Dropbox and clears its modified dot", async ({ page }) => {
  const file = fileFor("save");
  await expect(item(page, "Saving")).toBeVisible();
  await openAndEdit(page, file, ": eggs");
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");

  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect((await stored(page, file)).content).toBe("Shopping list: eggs\n");

  // Saved again from the new revision, without a conflict.
  await page.keyboard.type(", milk");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  expect((await stored(page, file)).content).toBe("Shopping list: eggs, milk\n");
  await expect(alert(page)).toHaveCount(0);
});

test("undoing back to the saved content clears the modified dot", async ({ page }) => {
  await item(page, "readme.md").click();
  await editor(page).locator(".cm-line").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(tab(page, "readme.md")).toHaveAttribute("data-modified", "true");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(tab(page, "readme.md")).not.toHaveAttribute("data-modified");
});

test("closing a Tab with a Draft asks first", async ({ page }) => {
  await item(page, "readme.md").click();
  await editor(page).locator(".cm-line").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");

  page.once("dialog", (d) => {
    expect(d.type()).toBe("confirm");
    expect(d.message()).toContain("readme.md");
    void d.dismiss();
  });
  await page.getByRole("button", { name: "Close readme.md" }).click();
  await expect(tabs(page)).toHaveText(["readme.md"]);
  await expect(editor(page)).toContainText("Read me first.!");

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Close readme.md" }).click();
  await expect(tabs(page)).toHaveCount(0);
});

test("closing a Tab without a Draft doesn't ask", async ({ page }) => {
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await item(page, "readme.md").click();
  await page.getByRole("button", { name: "Close readme.md" }).click();
  await expect(tabs(page)).toHaveCount(0);
});

test("a failed save keeps the Draft so the Owner can retry", async ({ page }) => {
  const file = fileFor("retry");
  await openAndEdit(page, file, ": bread");
  await page.route("**/api/file", (route) => (route.request().method() === "PUT" ? route.abort() : route.fallback()));
  await page.keyboard.press("ControlOrMeta+s");
  await expect(alert(page)).toContainText(`Couldn't save ${file}`);
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");
  expect((await stored(page, file)).content).toBe("Shopping list\n");

  await page.unroute("**/api/file");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(tab(page, file)).not.toHaveAttribute("data-modified");
  await expect(alert(page)).toHaveCount(0);
  expect((await stored(page, file)).content).toBe("Shopping list: bread\n");
});

test("a save over a file changed elsewhere raises a Save Conflict and keeps the Draft", async ({ page, baseURL }) => {
  const file = fileFor("conflict");
  await openAndEdit(page, file, ": mine");
  // Another device saves the file first.
  const theirs = await stored(page, file);
  const res = await page.request.put("/api/file", {
    headers: { Origin: baseURL! },
    data: { path: `Saving/${file}`, content: "Shopping list: theirs\n", rev: theirs.rev },
  });
  expect(res.ok()).toBe(true);

  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("dialog", { name: "Save Conflict" })).toBeVisible();
  await expect(tab(page, file)).toHaveAttribute("data-modified", "true");
  await expect(editor(page)).toContainText("Shopping list: mine");
  expect((await stored(page, file)).content).toBe("Shopping list: theirs\n");
});
