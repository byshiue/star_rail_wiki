import { expect, test } from "@playwright/test";

test("searches current 4.4 data and exposes version and immutable revision evidence", async ({ page }) => {
  await page.goto("#/"
  );
  await expect(page.getByRole("heading", { name: "角色与装备" })).toBeVisible();
  await expect(page.getByText("正式服 4.4").first()).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索资料" }).fill("姬子•启行");
  await expect(page.getByText("找到 1 条资料")).toBeVisible();
  await page.getByRole("link", { name: "姬子•启行" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "姬子•启行" })).toBeVisible();
  await expect(page.getByText("变更信息：这是版本链中的首个已知修订。").first()).toBeVisible();
  await expect(page.getByText(/revision b95e75c7e1273d819d20c530c0b7e13a3ef19fb4/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "技能" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "星魂" })).toBeVisible();
});

test("navigates a before/after version diff with a controlled historical response", async ({ page }) => {
  await page.route("**/data/releases/4.4-cn-2026-08-21/entities.json", async (route) => {
    const response = await route.fetch();
    const entities = await response.json();
    const current = entities.characters.find((character: { logicalId: string }) => character.logicalId === "character:1510");
    entities.characters.push({
      ...structuredClone(current), revisionId: "character:1510@4.3-fixture",
      validFromReleaseId: "4.3-fixture", validToReleaseId: "4.4-cn-2026-08-21",
      description: "历史修订说明。", abilities: [], traces: [], eidolons: [],
    });
    await route.fulfill({ response, json: entities });
  });
  await page.goto("#/wiki/character/character%3A1510");
  await page.getByRole("link", { name: "查看前后修订" }).click();
  await expect(page.getByRole("region", { name: "版本变化", exact: true })).toContainText("4.3 → 4.4");
  await expect(page.getByRole("region", { name: "版本变化明细" })).toContainText("description");
});

test("remains usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("#/");
  await expect(page.getByRole("navigation", { name: "主要导航" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "搜索资料" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
