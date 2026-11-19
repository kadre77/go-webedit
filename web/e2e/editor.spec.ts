import { expect, test, type Page } from "@playwright/test";
import { clickItem } from "./ui";

// Fixtures: web/e2e/fixtures. Notes/Today.md is "# Today\n\nBuy milk.\n".

const item = (page: Page, name: string) => page.getByRole("tree").getByRole("treeitem", { name });
const lines = (page: Page) => page.locator(".cm-content .cm-line");
// Clicks into a line and waits for the editor to take focus, so the keys
// that follow land there (on the phone they can otherwise arrive too early).
async function clickLine(page: Page, n: number) {
  await lines(page).nth(n).click();
  await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
}
// toHaveText collapses whitespace, so indentation is checked through this.
const exactText = (page: Page, n: number) => expect.poll(() => lines(page).nth(n).textContent());

// Mariana's colours: a Markdown heading is white with a red #, and plain text
// has the foreground colour.
const marianaWhite = "rgb(255, 255, 255)";
const marianaRed = "rgb(236, 95, 102)";
const marianaForeground = "rgb(216, 222, 233)";

test.beforeEach(async ({ page }) => {
  await page.goto("/auth/signin");
});

test("Markdown headings are highlighted", async ({ page }) => {
  await clickItem(page, "Notes");
  await clickItem(page, "Today.md");
  await expect(lines(page).first().locator("span", { hasText: "Today" })).toHaveCSS("color", marianaWhite);
  await expect(lines(page).first().locator("span", { hasText: "#" }).last()).toHaveCSS("color", marianaRed);
  // Plain paragraph text keeps the editor's foreground colour.
  await expect(lines(page).nth(2)).toHaveCSS("color", marianaForeground);
});

// Code/main.go is indented with tabs, Code/total.py with two spaces; the
// default is four spaces, so neither file matches it.
test("a new line is indented in the file's own style", async ({ page, isMobile }) => {
  // On the emulated phone, CodeMirror's Android input handling sometimes
  // drops a synthetic Enter when the machine is busy. Detection doesn't
  // depend on the layout; on-screen keyboard input belongs to the phone
  // layout ticket.
  test.skip(isMobile, "synthetic Enter is unreliable on the emulated phone");
  await clickItem(page, "Code");
  await clickItem(page, "main.go");
  await clickLine(page, 4); // func main() {
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await exactText(page, 5).toBe("\tx");

  await clickItem(page, "total.py");
  await clickLine(page, 0); // def total(items):
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await exactText(page, 1).toBe("  x");
});

// Code/fruit.txt is "apple pie\napple tart\npear\n".
async function openFruit(page: Page) {
  await clickItem(page, "Code");
  await clickItem(page, "fruit.txt");
  await expect(lines(page).first()).toHaveText("apple pie");
}

// With Shift, a letter key must be written in upper case: Playwright sends
// "Shift+d" as the key "d", where a real keyboard sends "D".
test("on a phone, the editor keeps a single cursor, even from a hardware keyboard", async ({ page, isMobile }) => {
  test.skip(!isMobile, "multi-cursor is desktop-only");
  await openFruit(page);
  await clickLine(page, 0);
  await page.keyboard.press("Home");
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.locator(".cm-selectionBackground")).toHaveCount(1);
  await page.keyboard.type("plum");
  await expect.poll(async () => (await lines(page).allTextContents()).join("\n").match(/plum/g)?.length).toBe(1);
});

test.describe("desktop keyboard", () => {
  test.skip(({ isMobile }) => isMobile, "multi-cursor and Sublime shortcuts are desktop-only");

  test("Ctrl+D selects the next occurrence, adding a cursor", async ({ page }) => {
    await openFruit(page);
    await lines(page).first().click({ position: { x: 1, y: 5 } });
    await page.keyboard.press("ControlOrMeta+d");
    await page.keyboard.press("ControlOrMeta+d");
    await page.keyboard.type("plum");
    await expect(lines(page)).toHaveText(["plum pie", "plum tart", "pear", ""]);
  });

  test("Ctrl+click adds a cursor", async ({ page }) => {
    await openFruit(page);
    await lines(page).first().click({ position: { x: 1, y: 5 } });
    await lines(page).nth(2).click({ position: { x: 1, y: 5 }, modifiers: ["ControlOrMeta"] });
    await page.keyboard.type("- ");
    await expect(lines(page)).toHaveText(["- apple pie", "apple tart", "- pear", ""]);
  });

  test("Ctrl+Shift+Down moves the line down", async ({ page }) => {
    await openFruit(page);
    await lines(page).first().click();
    await page.keyboard.press(process.platform === "darwin" ? "Control+Meta+ArrowDown" : "Control+Shift+ArrowDown");
    await expect(lines(page)).toHaveText(["apple tart", "apple pie", "pear", ""]);
  });

  test("Ctrl+Shift+D duplicates the line and Ctrl+J joins lines", async ({ page }) => {
    await openFruit(page);
    await lines(page).nth(2).click();
    await page.keyboard.press("ControlOrMeta+Shift+D");
    await expect(lines(page)).toHaveText(["apple pie", "apple tart", "pear", "pear", ""]);
    await lines(page).first().click();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(lines(page)).toHaveText(["apple pie apple tart", "pear", "pear", ""]);
  });

  test("Ctrl+Shift+L splits a selection into a cursor per line", async ({ page }) => {
    await openFruit(page);
    await lines(page).first().click({ position: { x: 1, y: 5 } });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+Shift+L");
    await page.keyboard.press("End");
    await page.keyboard.type(";");
    await expect(lines(page)).toHaveText(["apple pie;", "apple tart;", "pear;", ";"]);
  });

  test("Ctrl+G goes to a line", async ({ page }) => {
    await openFruit(page);
    await lines(page).first().click();
    await page.keyboard.press("Control+g");
    await page.keyboard.type("3");
    await page.keyboard.press("Enter");
    await page.keyboard.type(">");
    await expect(lines(page)).toHaveText(["apple pie", "apple tart", ">pear", ""]);
  });

  test("Ctrl+H replaces every match in the file", async ({ page }) => {
    await openFruit(page);
    await lines(page).first().click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Alt+f" : "Control+h");
    await page.getByRole("textbox", { name: "Find" }).fill("apple");
    await page.getByRole("textbox", { name: "Replace" }).fill("plum");
    await page.getByRole("button", { name: "replace all" }).click();
    await expect(lines(page)).toHaveText(["plum pie", "plum tart", "pear", ""]);
  });
});
