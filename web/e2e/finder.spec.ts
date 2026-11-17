import { expect, test, type Page } from "@playwright/test";

// Fixtures: web/e2e/fixtures. Notes/Today.md is "# Today\n\nBuy milk.\n";
// Goto/To/Day/plan.md spells "today" across its folders.

const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name });
const editor = (page: Page) => page.locator(".cm-content");
const finder = (page: Page, name: string) => page.getByRole("dialog", { name });
const options = (page: Page, name: string) => finder(page, name).getByRole("option");

test.beforeEach(async ({ page }) => {
  await page.goto("/auth/signin");
  await expect(page.getByRole("tree").getByRole("treeitem", { name: "Notes" })).toBeVisible();
});

test.describe("Goto Anything", () => {
  test("a file-name match ranks above a match spread across folders", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await finder(page, "Goto Anything").getByRole("combobox").fill("today");
    await expect(options(page, "Goto Anything")).toHaveCount(2);
    await expect(options(page, "Goto Anything").nth(0)).toContainText("Notes/Today.md");
    await expect(options(page, "Goto Anything").nth(1)).toContainText("Goto/To/Day/plan.md");
  });

  test("arrow keys move through the results and Enter opens one in a Tab", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await finder(page, "Goto Anything").getByRole("combobox").fill("today");
    await expect(options(page, "Goto Anything").nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options(page, "Goto Anything").nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown"); // stays on the last one
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(finder(page, "Goto Anything")).toBeHidden();
    await expect(tab(page, "plan.md")).toHaveAttribute("aria-selected", "true");
    await expect(editor(page)).toContainText("A plan spread across folders.");
  });

  test("the chosen file opens in the Preview Tab, replacing the one there", async ({ page }) => {
    await page.getByRole("tree").getByRole("treeitem", { name: "readme.md" }).click();
    await expect(tab(page, "readme.md")).toHaveAttribute("data-preview", "true");
    await page.keyboard.press("Control+p");
    await finder(page, "Goto Anything").getByRole("combobox").fill("today");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["Today.md"]);
    await expect(tab(page, "Today.md")).toHaveAttribute("data-preview", "true");
  });

  test("while it's open, Tab shortcuts leave the Tabs alone but the finder shortcuts switch finders", async ({
    page,
  }) => {
    await page.getByRole("tree").getByRole("treeitem", { name: "readme.md" }).dblclick();
    await page.getByRole("tree").getByRole("treeitem", { name: "Goto" }).click();
    await page.getByRole("tree").getByRole("treeitem", { name: "Outline.md" }).dblclick();
    await expect(tab(page, "Outline.md")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+p");
    await expect(finder(page, "Goto Anything")).toBeVisible();
    await page.keyboard.press("Control+PageDown");
    await page.keyboard.press("Alt+1");
    await expect(tab(page, "Outline.md")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+Shift+p");
    await expect(finder(page, "Command Palette")).toBeVisible();
    await expect(finder(page, "Goto Anything")).toBeHidden();
  });

  test("Esc closes it without opening anything", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await expect(finder(page, "Goto Anything")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(finder(page, "Goto Anything")).toBeHidden();
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveCount(0);
  });
});

test.describe("Command Palette", () => {
  test("lists the app's commands with their shortcuts", async ({ page }) => {
    await page.keyboard.press("Control+Shift+p");
    await finder(page, "Command Palette").getByRole("combobox").fill("save");
    await expect(options(page, "Command Palette").first()).toHaveText(/^Save\s*Ctrl\+S$/);
    await finder(page, "Command Palette").getByRole("combobox").fill("goto");
    await expect(options(page, "Command Palette").filter({ hasText: "Goto Anything" })).toContainText("Ctrl+P");
    await expect(options(page, "Command Palette").filter({ hasText: "Goto Heading" })).toContainText("Ctrl+R");
  });

  test("Enter runs the chosen command", async ({ page }) => {
    await page.getByRole("tree").getByRole("treeitem", { name: "readme.md" }).dblclick();
    await expect(tab(page, "readme.md")).toBeVisible();
    await page.keyboard.press("Control+Shift+p");
    await finder(page, "Command Palette").getByRole("combobox").fill("close tab");
    await page.keyboard.press("Enter");
    await expect(finder(page, "Command Palette")).toBeHidden();
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveCount(0);
  });

  test("Go to Line runs in the editor", async ({ page }) => {
    await page.getByRole("tree").getByRole("treeitem", { name: "readme.md" }).dblclick();
    await expect(editor(page)).toContainText("Read me first.");
    await page.keyboard.press("Control+Shift+p");
    await finder(page, "Command Palette").getByRole("combobox").fill("go to line");
    await page.keyboard.press("Enter");
    const line = page.getByRole("textbox", { name: "Go to line:" });
    await expect(line).toBeFocused();
    await line.fill("2");
    await page.keyboard.press("Enter");
    await expect(page.locator(".cm-activeLine")).toHaveText("Second line.");
  });
});

test.describe("Goto Heading", () => {
  const openFile = async (page: Page, query: string, name: string) => {
    await page.keyboard.press("Control+p");
    await finder(page, "Goto Anything").getByRole("combobox").fill(query);
    await page.keyboard.press("Enter");
    await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
  };

  test("Ctrl+R lists a Markdown file's headings, indented by level, and jumps to one", async ({ page }) => {
    await openFile(page, "outline", "Outline.md");
    await page.keyboard.press("Control+r");
    const headings = options(page, "Goto Heading");
    await expect(headings).toHaveText(["Outline", "First part", "Detail", "Second part"]);
    const indent = (n: number) => headings.nth(n).evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(await indent(1)).toBeGreaterThan(await indent(0));
    expect(await indent(2)).toBeGreaterThan(await indent(1));
    expect(await indent(3)).toBe(await indent(1));

    await finder(page, "Goto Heading").getByRole("combobox").fill("detail");
    await expect(headings).toHaveText(["Detail"]);
    await page.keyboard.press("Enter");
    await expect(finder(page, "Goto Heading")).toBeHidden();
    await expect(page.locator(".cm-activeLine")).toHaveText("### Detail ###");
    await page.keyboard.type("!");
    await expect(page.locator(".cm-activeLine")).toHaveText("!### Detail ###");
  });

  test("Ctrl+R shows no symbols for a file that isn't Markdown", async ({ page }) => {
    await openFile(page, "main.go", "main.go");
    await page.keyboard.press("Control+r");
    await expect(finder(page, "Goto Heading")).toContainText("No symbols");
    await expect(options(page, "Goto Heading")).toHaveCount(0);
  });
});
