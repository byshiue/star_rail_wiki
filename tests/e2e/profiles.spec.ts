import { expect, test } from "@playwright/test";

test("keeps two UIDs isolated, rejects invalid JSON atomically and requires public consent", async ({ page }) => {
  await page.goto("#/profiles");
  for (const [uid, label] of [["100000001", "主账号"], ["100000002", "副账号"]] as const) {
    await page.getByRole("textbox", { name: "新账号 UID" }).fill(uid);
    await page.getByRole("textbox", { name: "显示名", exact: true }).fill(label);
    await page.getByRole("button", { name: "创建本地账号" }).click();
    await expect(page.getByRole("heading", { name: `${label} · ${uid}` })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("button", { name: /主账号.*100000001/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /副账号.*100000002/ })).toBeVisible();

  await page.getByLabel("JSON 文件", { exact: true }).setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"uid":"bad"}') });
  await page.getByRole("combobox", { name: "冲突处理" }).selectOption("replace");
  await page.getByRole("button", { name: "验证并导入" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /主账号.*100000001/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /副账号.*100000002/ })).toBeVisible();

  const generate = page.getByRole("button", { name: "生成公开 JSON" });
  await expect(generate).toBeDisabled();
  await page.getByRole("checkbox", { name: /我明确同意公开/ }).check();
  await generate.click();
  await expect(page.getByRole("status", { name: "公开 JSON 已生成" })).toContainText('"visibility": "public"');
  await expect(page.getByRole("status", { name: "公开 JSON 已生成" })).toContainText("本站不会接收 GitHub token");
  await page.goto("#/profiles/public/100000002");
  await expect(page.getByRole("status", { name: "公开档案不存在" })).toContainText("尚无已合并的公开档案");
});

test("reports a genuinely blocked IndexedDB upgrade caused by another tab and can retry", async ({ context, page }) => {
  const blocker = await context.newPage();
  await blocker.route("**/star_rail_wiki/", async (route) => route.fulfill({
    contentType: "text/html",
    body: `<script>
      const request = indexedDB.open("star-rail-wiki", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("profiles", { keyPath: "uid" });
        store.createIndex("by-updatedAt", "updatedAt");
      };
      request.onsuccess = () => { window.blockingDatabase = request.result; document.body.textContent = "ready"; };
    </script>`,
  }));
  await blocker.goto("./");
  await expect(blocker.getByText("ready")).toBeVisible();

  await page.goto("#/profiles");
  await expect(page.getByRole("alert")).toContainText("其他标签页");
  await blocker.evaluate(() => (window as unknown as { blockingDatabase: IDBDatabase }).blockingDatabase.close());
  await page.getByRole("button", { name: "重试读取本地档案" }).click();
  await expect(page.getByRole("heading", { name: "账号与版本" })).toBeVisible();
  await expect(page.getByText("本地档案数据库正被其他标签页")).toHaveCount(0);
});
