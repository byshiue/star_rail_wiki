import { expect, test } from "@playwright/test";

test("pins a shared build, evaluates a reviewed relic buff and opens evidence", async ({ page }) => {
  await page.goto("#/simulator");
  await page.getByRole("combobox", { name: "1号位角色" }).selectOption({ label: "三月七" });
  await page.getByRole("combobox", { name: "三月七遗器套装 1" }).selectOption({ label: "云无留迹的过客" });
  await expect(page.getByText("自身治疗 +10%")).toBeVisible();
  const share = page.getByRole("textbox", { name: /分享链接/ });
  await expect(share).toHaveValue(/#\/simulator\?build=/);
  const url = page.url();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "1号位角色" })).toHaveValue("character:1001");
  await expect(page.getByText("自身治疗 +10%")).toBeVisible();
  expect(page.url()).toBe(url);
  await page.getByRole("button", { name: "查看自身治疗来源" }).click();
  await expect(page.getByRole("dialog", { name: "效果证据" })).toContainText("正式服 4.4");
  await expect(page.getByRole("dialog", { name: "效果证据" })).toContainText("reviewed / reviewed");
  await expect(page.getByRole("dialog", { name: "效果证据" }).getByRole("link")).toHaveAttribute("href", /raw\.githubusercontent\.com/);
});
