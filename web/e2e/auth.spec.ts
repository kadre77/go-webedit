import { expect, test, type Page } from "@playwright/test";

const tree = (page: Page) => page.getByRole("tree");
const signInLink = (page: Page) => page.getByRole("link", { name: "Sign in with Dropbox" });

test("a signed-out visit shows sign-in, and signing in shows the Root Folder", async ({ page }) => {
  await page.goto("/");
  await expect(signInLink(page)).toBeVisible();
  await expect(tree(page)).toHaveCount(0);

  await signInLink(page).click();
  await expect(tree(page).getByRole("treeitem", { name: "readme.md" })).toBeVisible();
  await expect(page).toHaveURL("/");
});

test("signing out returns to sign-in and stays signed out", async ({ page }) => {
  await page.goto("/auth/signin");
  await expect(tree(page)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("You're signed out.")).toBeVisible();
  await expect(signInLink(page)).toBeVisible();

  await page.goto("/");
  await expect(signInLink(page)).toBeVisible();
  await expect(tree(page)).toHaveCount(0);
});

test("a revoked Dropbox authorization sends the Owner to sign in again with a clear message", async ({ page }) => {
  await page.route("**/api/tree", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "reauthorize", message: "Sign in again." }),
    }),
  );
  await page.goto("/auth/signin");
  await expect(page.getByRole("alert")).toContainText("expired or was revoked");
  await expect(signInLink(page)).toBeVisible();
  await expect(page).toHaveURL(/\/signin\?reason=reauthorize$/);
});

test("a session that ends mid-use goes back to sign-in", async ({ page }) => {
  await page.goto("/auth/signin");
  await page.route("**/api/file?*", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "unauthorized", message: "Sign in to continue." }),
    }),
  );
  await tree(page).getByRole("treeitem", { name: "readme.md" }).click();
  await expect(signInLink(page)).toBeVisible();
  await expect(tree(page)).toHaveCount(0);
});

test("a refused Dropbox account is told why", async ({ page }) => {
  await page.goto("/signin?reason=not-owner");
  await expect(page.getByRole("alert")).toContainText("isn't allowed");
  await expect(signInLink(page)).toBeVisible();
});

test("the app runs under its Content Security Policy without violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content.Security.Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  page.on("pageerror", (err) => violations.push(err.message));

  await page.goto("/auth/signin");
  await tree(page).getByRole("treeitem", { name: "readme.md" }).click();
  await expect(page.locator(".cm-content")).toContainText("Read me first.");
  // CodeMirror's own styles applied: the editor scroller is a flex container.
  await expect(page.locator(".cm-editor")).toHaveCSS("display", "flex");
  expect(violations).toEqual([]);
});
