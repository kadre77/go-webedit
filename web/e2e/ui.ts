import { expect, type Locator, type Page } from "@playwright/test";
import { phoneQuery } from "../src/settings";

// Helpers shared by the specs for the parts of the app that differ between
// the desktop and the phone layout.

/** Viewports this narrow get the phone layout, as the app's own query says. */
const phoneWidth = Number(/max-width: (\d+)px/.exec(phoneQuery)![1]);

const isPhoneLayout = (page: Page) => (page.viewportSize()?.width ?? Infinity) <= phoneWidth;

/** The phone toolbar's button that opens and closes the drawer. */
export const filesButton = (page: Page) => page.getByRole("toolbar").getByRole("button", { name: "Files" });

/** Makes the file tree usable: on a phone, opens the drawer if it's closed.
 * The sidebar is always shown on desktop. */
export async function showTree(page: Page) {
  if (!isPhoneLayout(page)) return;
  const files = filesButton(page);
  await expect(files).toBeVisible();
  if ((await files.getAttribute("aria-expanded")) !== "true") await files.click();
  await expect(page.getByRole("tree", { name: "Root Folder" })).toBeVisible();
}

/** A touch on the element's centre, held for `ms` before lifting. */
export async function longPress(page: Page, target: Locator, ms = 800) {
  const box = await target.boundingBox();
  if (!box) throw new Error("long-press target isn't shown");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** A horizontal touch swipe from one x to another, at height y. */
export async function swipe(page: Page, from: number, to: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 8;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
  for (let i = 1; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** A row in the file tree. */
const treeItem = (page: Page, name: string, options: { exact?: boolean } = {}) =>
  page.getByRole("tree", { name: "Root Folder" }).getByRole("treeitem", { name, ...options });

/** Clicks a row in the file tree, opening the drawer first on a phone. */
export async function clickItem(page: Page, name: string, options: { double?: boolean; exact?: boolean } = {}) {
  await showTree(page);
  const row = treeItem(page, name, { exact: options.exact });
  await (options.double ? row.dblclick() : row.click());
}
