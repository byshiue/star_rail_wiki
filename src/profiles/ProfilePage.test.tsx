import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { fixtureBundle } from "../effects/__fixtures__/goldenTeams";
import { createMemoryProfileDatabase } from "./profileDatabase";
import { ProfilePage } from "./ProfilePage";
import { createProfileService } from "./profileService";
import { readFileSync } from "node:fs";
const profileCss = readFileSync("src/styles/profiles.css", "utf8");

describe("ProfilePage", () => {
  it("uses a single-column layout at 320px and keeps live text visually hidden", () => {
    expect(profileCss).toMatch(/ \(max-width: 720px\)/);
    expect(profileCss).toMatch(/profile-workspace \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(profileCss).toMatch(/visually-hidden[\s\S]*clip: rect\(0 0 0 0\);/);
  });

  it("creates, selects, renames, edits inventory, and precisely confirms deletion", async () => {
    const user = userEvent.setup();
    const service = createProfileService(createMemoryProfileDatabase());
    render(<MemoryRouter><ReleaseProvider bundle={fixtureBundle}>
      <ProfilePage service={service} />
    </ReleaseProvider></MemoryRouter>);

    expect(await screen.findByText(/还没有本地账号/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("新账号 UID"), "100000001");
    await user.type(screen.getByLabelText("显示名"), "主账号");
    await user.click(screen.getByRole("button", { name: "创建本地账号" }));
    expect(await screen.findByRole("heading", { name: /主账号/ })).toBeInTheDocument();

    const characterId = fixtureBundle.entities.characters[0]!.logicalId;
    await user.selectOptions(screen.getByLabelText("添加角色"), characterId);
    await user.click(screen.getByRole("button", { name: "添加角色" }));
    await user.clear(screen.getByLabelText(`${characterId} 星魂`));
    await user.type(screen.getByLabelText(`${characterId} 星魂`), "3");
    await user.click(screen.getByRole("button", { name: "保存库存" }));
    expect((await service.getProfile("100000001"))?.characters[0]?.eidolon).toBe(3);

    await user.type(screen.getByLabelText("新账号 UID"), "100000001");
    await user.click(screen.getByRole("button", { name: "创建本地账号" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已存在");
    expect((await service.getProfile("100000001"))?.characters).toHaveLength(1);

    const appHeader = document.createElement("header"); appHeader.className = "site-header";
    const skipLink = document.createElement("a"); skipLink.className = "skip-link";
    document.body.append(appHeader, skipLink);
    const deleteOpener = screen.getByRole("button", { name: "删除账号" });
    await user.click(deleteOpener);
    expect(screen.getByRole("dialog")).toHaveTextContent("100000001");
    expect(document.querySelector(".profile-page")).toHaveAttribute("inert");
    expect(appHeader).toHaveAttribute("inert");
    expect(appHeader).toHaveAttribute("aria-hidden", "true");
    expect(skipLink).toHaveAttribute("inert");
    expect(screen.getByLabelText("输入 UID 确认删除")).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteOpener).toHaveFocus();
    expect(appHeader).not.toHaveAttribute("inert");
    expect(appHeader).not.toHaveAttribute("aria-hidden");
    await user.click(deleteOpener);
    await user.type(screen.getByLabelText("输入 UID 确认删除"), "100000002");
    expect(screen.getByRole("button", { name: "永久删除 100000001" })).toBeDisabled();
    await user.clear(screen.getByLabelText("输入 UID 确认删除"));
    await user.type(screen.getByLabelText("输入 UID 确认删除"), "100000001");
    await user.click(screen.getByRole("button", { name: "永久删除 100000001" }));
    expect(await screen.findByText(/还没有本地账号/)).toBeInTheDocument();
    expect(document.querySelector(".profile-page")).toHaveFocus();
    appHeader.remove(); skipLink.remove();
  });

  it("reports isolated invalid stored records instead of silently hiding them", async () => {
    const records = new Map<string, unknown>([["100000009", {
      uid: "100000009", schemaVersion: 99, updatedAt: "2026-08-21T00:00:00.000Z",
    }]]);
    const service = createProfileService(createMemoryProfileDatabase(records));
    render(<MemoryRouter><ReleaseProvider bundle={fixtureBundle}>
      <ProfilePage service={service} />
    </ReleaseProvider></MemoryRouter>);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("部分本地档案已隔离");
    expect(alert).toHaveTextContent("100000009");
  });

  it("disables additions from a different release while preserving the local profile", async () => {
    const service = createProfileService(createMemoryProfileDatabase());
    await service.putProfile({ schemaVersion: 1, uid: "100000001", dataReleaseId: "older-release",
      updatedAt: "2026-08-21T00:00:00.000Z", characters: [], lightCones: [], relics: [] });
    render(<MemoryRouter><ReleaseProvider bundle={fixtureBundle}>
      <ProfilePage service={service} />
    </ReleaseProvider></MemoryRouter>);
    expect(await screen.findByText(/当前未载入档案版本 older-release/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加角色" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加光锥" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加遗器" })).toBeDisabled();
  });

  it("honestly reports no current release while allowing version-pinned local profiles", async () => {
    const service = createProfileService(createMemoryProfileDatabase());
    render(<MemoryRouter><ReleaseProvider bundle={undefined} index={{
      currentReleaseId: null,
      releases: [fixtureBundle.release],
    }}><ProfilePage service={service} /></ReleaseProvider></MemoryRouter>);

    expect(await screen.findByText(/暂无已发布 current 版本/)).toBeInTheDocument();
    expect(screen.getByLabelText("档案数据版本")).toHaveValue(fixtureBundle.release.id);
    expect(screen.getByText(/仍可按所选历史或测试版本保存本地档案/)).toBeInTheDocument();
  });
});
