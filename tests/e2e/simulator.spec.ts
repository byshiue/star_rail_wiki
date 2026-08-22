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

test("evaluates a real four-person 4.4 team with ally and enemy targets and evidence", async ({ page }) => {
  await page.goto("#/simulator");
  for (const [slot, character] of [[1, "布洛妮娅"], [2, "佩拉"], [3, "真理医生"], [4, "罗刹"]] as const) {
    await page.getByRole("combobox", { name: `${slot}号位角色` }).selectOption({ label: character });
  }
  await page.getByText("场景条件").click();
  await page.getByRole("textbox", { name: "历史事件" }).fill("skill:ability:110102, ultimate:ability:110603");
  await page.getByRole("textbox", { name: "目标指定" }).fill("effect:4.4:0412=slot-4");
  await page.getByRole("button", { name: "触发这些事件一次" }).click();

  await expect(page.getByText("全队增伤 +10%", { exact: true })).toBeVisible();
  await expect(page.getByText("单体队友增伤 +33%", { exact: true })).toBeVisible();
  await expect(page.getByText("全体敌人减防 +30%", { exact: true })).toBeVisible();
  await expect(page.getByText(/全队（slot-1、slot-2、slot-3、slot-4） · 增伤/)).toBeVisible();
  await expect(page.getByText(/单体队友（slot-4） · 增伤/)).toBeVisible();
  await expect(page.getByText(/全体敌人（enemy） · 减防/)).toBeVisible();

  const evidenceCases = [
    ["active · 生效", "查看全队增伤来源", "布洛妮娅在场时，我方全体造成的伤害提高10%。", "trace:1101103@4.4-cn-2026-08-21"],
    ["conditional · 条件生效", "查看单体队友增伤来源", "解除指定我方单体的1个负面效果，并使该目标立即行动，造成的伤害提高33%→82.5%，持续1回合", "ability:110102@4.4-cn-2026-08-21"],
    ["conditional · 条件生效", "查看全体敌人减防来源", "【通解】状态下，敌方目标防御力降低30%→45%，持续2回合", "ability:110603@4.4-cn-2026-08-21"],
  ] as const;
  for (const [category, buttonName, originalText, revision] of evidenceCases) {
    await page.getByRole("region", { name: new RegExp(category) }).getByRole("button", { name: buttonName }).click();
    const dialog = page.getByRole("dialog", { name: "效果证据" });
    await expect(dialog).toContainText(originalText);
    await expect(dialog).toContainText(revision);
    await expect(dialog).toContainText("reviewed / reviewed");
    await expect(dialog.getByRole("link")).toHaveAttribute("href", /raw\.githubusercontent\.com/);
    await dialog.getByRole("button", { name: "关闭" }).click();
  }
});
