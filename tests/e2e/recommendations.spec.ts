import { expect, test } from "@playwright/test";

test("shows sourced 4.4 community teams and deterministic top-three agent output", async ({ page }) => {
  await page.goto("#/community");
  await expect(page.getByRole("link", { name: /4.4 姬子/ })).toHaveAttribute("href", "https://www.hoyolab.com/article/45855384");
  await expect(page.getByRole("link", { name: /V4.4 Fate/ })).toHaveAttribute("href", "https://www.hoyolab.com/article/45977086");

  await page.goto("#/agent");
  await page.getByRole("button", { name: "生成推荐" }).click();
  const cards = page.locator("article[aria-label^='候选队伍']");
  await expect(cards).toHaveCount(3);
  const firstRun = await cards.locator("h2").allTextContents();
  await expect(cards.first()).toContainText("评分分解");
  await expect(cards.first()).toContainText("Buff 证据");
  await page.reload();
  await page.getByRole("button", { name: "生成推荐" }).click();
  await expect(cards).toHaveCount(3);
  expect(await cards.locator("h2").allTextContents()).toEqual(firstRun);
});
