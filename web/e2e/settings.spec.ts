import { expect, test, type Page } from "@playwright/test";

// Fixtures: web/e2e/fixtures. Code/fruit.txt is "apple pie\napple tart\npear\n"
// (no indentation), Code/main.go is indented with tabs, readme.md is two lines.

const item = (page: Page, name: string) => page.getByRole("tree").getByRole("treeitem", { name });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name });
const lines = (page: Page) => page.locator(".cm-content .cm-line");
const content = (page: Page) => page.locator(".cm-content");
const fontSize = (page: Page) => content(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const wraps = (page: Page) => content(page).evaluate((el) => el.classList.contains("cm-lineWrapping"));
// toHaveText collapses whitespace, so indentation is checked through this.
const exactText = (page: Page, n: number) => expect.poll(() => lines(page).nth(n).textContent());

/** Runs a command from the Command Palette by its exact name. */
async function runCommand(page: Page, name: string) {
  await page.keyboard.press("Control+Shift+p");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await palette.getByRole("combobox").fill(name);
  await palette.getByRole("option").filter({ hasText: new RegExp(`^${name}`) }).first().click();
  await expect(palette).toBeHidden();
}

async function openReadme(page: Page) {
  await item(page, "readme.md").dblclick();
  await expect(lines(page).first()).toHaveText("Read me first.");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/auth/signin");
  await expect(item(page, "readme.md")).toBeVisible();
});

test("word wrap is on by default on a phone and off on desktop", async ({ page, isMobile }) => {
  await openReadme(page);
  await expect.poll(() => wraps(page)).toBe(isMobile);
});

test("font size and word wrap are kept across a reload", async ({ page, isMobile }) => {
  await openReadme(page);
  const start = await fontSize(page);
  await runCommand(page, "Increase Font Size");
  await runCommand(page, "Increase Font Size");
  await expect.poll(() => fontSize(page)).toBe(start + 2);
  await runCommand(page, "Toggle Word Wrap");
  await expect.poll(() => wraps(page)).toBe(!isMobile);

  await page.reload();
  await expect(lines(page).first()).toHaveText("Read me first.");
  await expect.poll(() => fontSize(page)).toBe(start + 2);
  await expect.poll(() => wraps(page)).toBe(!isMobile);

  await runCommand(page, "Decrease Font Size");
  await expect.poll(() => fontSize(page)).toBe(start + 1);
  await runCommand(page, "Reset Font Size");
  await expect.poll(() => fontSize(page)).toBe(start);
});

test("a change applies at once to every open Tab", async ({ page }) => {
  await openReadme(page);
  await item(page, "Code").click();
  await item(page, "fruit.txt").dblclick();
  await expect(lines(page).first()).toHaveText("apple pie");
  const start = await fontSize(page);
  await runCommand(page, "Increase Font Size");
  await runCommand(page, "Toggle Word Wrap");
  const wrap = await wraps(page);
  await tab(page, "readme.md").click();
  await expect(lines(page).first()).toHaveText("Read me first.");
  await expect.poll(() => fontSize(page)).toBe(start + 1);
  await expect.poll(() => wraps(page)).toBe(wrap);
});

test.describe("default indentation", () => {
  async function indentFirstLine(page: Page) {
    await lines(page).first().click({ position: { x: 1, y: 5 } });
    await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
  }

  test("is used where the file's indentation can't be detected", async ({ page }) => {
    await runCommand(page, "Default Tab Width: 2");
    await item(page, "Code").click();
    await item(page, "fruit.txt").dblclick();
    await indentFirstLine(page);
    await exactText(page, 0).toBe("  apple pie");
  });

  test("is kept across a reload", async ({ page }) => {
    await runCommand(page, "Default Indentation: Tabs");
    await page.reload();
    await item(page, "Code").click();
    await item(page, "fruit.txt").dblclick();
    await indentFirstLine(page);
    await exactText(page, 0).toBe("\tapple pie");
  });

  test("leaves a file whose indentation is detected alone", async ({ page }) => {
    await runCommand(page, "Default Indentation: Spaces");
    await runCommand(page, "Default Tab Width: 8");
    await item(page, "Code").click();
    await item(page, "main.go").dblclick();
    await indentFirstLine(page);
    await exactText(page, 0).toBe("\t//go:build ignore");
  });
});

test("unavailable browser storage falls back to the defaults without errors", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (e) => errors.push(e));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
  });
  await page.reload();
  await openReadme(page);
  const start = await fontSize(page);
  await runCommand(page, "Increase Font Size");
  await expect.poll(() => fontSize(page)).toBe(start + 1);
  expect(errors).toEqual([]);
});
