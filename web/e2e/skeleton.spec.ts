import { expect, test } from "@playwright/test";

test("the app loads at the root", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("webedit");
  await expect(page.getByRole("heading", { name: "webedit" })).toBeVisible();
});

test("client-side routes load the app", async ({ page }) => {
  await page.goto("/some/client/route");
  await expect(page.getByRole("heading", { name: "webedit" })).toBeVisible();
});

test("unknown API routes return a JSON 404", async ({ request }) => {
  const res = await request.get("/api/does-not-exist");
  expect(res.status()).toBe(404);
  expect(await res.json()).toMatchObject({ code: "not-found" });
});
