import { flushSync } from "react-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProfile } from "../domain/profiles";
import { PublicProfileConsent } from "./PublicProfileConsent";
import { PublicProfilePage } from "./PublicProfilePage";
import { createPublicProfileExport, loadPublicProfile, PublicAccountProfileSchema } from "./publication";

const updatedAt = "2026-08-20T01:00:00.000Z";
const consentedAt = "2026-08-20T02:00:00.000Z";
const profile = (uid: string): AccountProfile => ({
  schemaVersion: 1, uid, dataReleaseId: "release-4.3", updatedAt,
  characters: [{ logicalId: "character:a", eidolon: 4, level: 70 }],
  lightCones: [{ logicalId: "light-cone:a", superimposition: 3, level: 60 }],
  relics: [{ instanceId: `private-${uid}`, setLogicalId: "relic-set:a", slot: "body" }],
});
const publicProfile = {
  schemaVersion: 1 as const, uid: "100000001", releaseId: "release-4.3", updatedAt,
  publication: { visibility: "public" as const, consentedAt },
  characters: [{ logicalId: "character:a", eidolon: 4, level: 70 }],
  lightCones: [{ logicalId: "light-cone:a", superimposition: 3, level: 60 }],
  relics: [{ setLogicalId: "relic-set:a", slot: "body" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("R1 public profile contract", () => {
  it("uses publication consent metadata and rejects the obsolete flat consentAt contract", () => {
    expect(createPublicProfileExport(profile("100000001"), consentedAt)).toEqual(publicProfile);
    expect(() => PublicAccountProfileSchema.parse({ ...publicProfile, publication: undefined, consentAt: consentedAt })).toThrow();
  });

  it("rejects consent before the profile revision and consent implausibly far in the future", () => {
    expect(() => createPublicProfileExport(profile("100000001"), "2026-08-20T00:59:59.000Z")).toThrow(/consent.*updatedAt/i);
    expect(() => createPublicProfileExport(profile("100000001"), "2999-01-01T00:00:00.000Z")).toThrow(/future/i);
  });
});

describe("R1 consent UI", () => {
  it("binds consent and artifacts to the exact UID and revision during a synchronous switch", async () => {
    const user = userEvent.setup();
    const view = render(<PublicProfileConsent profile={profile("100000001")} now={() => consentedAt} />);
    await user.click(screen.getByRole("checkbox", { name: /我明确同意公开/ }));
    await user.click(screen.getByRole("button", { name: "生成公开 JSON" }));
    expect((screen.getByLabelText("公开 JSON") as HTMLTextAreaElement).value).toContain("100000001");

    flushSync(() => view.rerender(<PublicProfileConsent profile={profile("100000002")} now={() => consentedAt} />));

    expect(screen.getByRole("checkbox", { name: /我明确同意公开/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "生成公开 JSON" })).toBeDisabled();
    expect(screen.queryByLabelText("公开 JSON")).not.toBeInTheDocument();
  });

  it("previews every inventory value that will actually be public", () => {
    render(<PublicProfileConsent profile={profile("100000001")} now={() => consentedAt} />);
    const preview = screen.getByText("将公开的完整字段预览").parentElement;
    expect(preview).toHaveTextContent("character:a · E4 · Lv.70");
    expect(preview).toHaveTextContent("light-cone:a · S3 · Lv.60");
    expect(preview).toHaveTextContent("relic-set:a · body");
  });

  it("announces a generated artifact and moves focus to the live status", async () => {
    const user = userEvent.setup();
    render(<PublicProfileConsent profile={profile("100000001")} now={() => consentedAt} />);
    await user.click(screen.getByRole("checkbox", { name: /我明确同意公开/ }));
    await user.click(screen.getByRole("button", { name: "生成公开 JSON" }));
    const status = screen.getByRole("status", { name: "公开 JSON 已生成" });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveFocus();
  });
});

describe("R1 public route failures", () => {
  it("announces not-found as a status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ schemaVersion: 1, profiles: [] }) }));
    render(<MemoryRouter initialEntries={["/profiles/public/100000001"]}><Routes><Route path="/profiles/public/:uid" element={<PublicProfilePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("status", { name: "公开档案不存在" })).toHaveTextContent("尚无已合并");
  });

  it("shows a safe alert when the indexed body timestamp is tampered", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ schemaVersion: 1, profiles: [{ uid: publicProfile.uid, path: `${publicProfile.uid}.json`, updatedAt }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...publicProfile, updatedAt: "2026-08-20T01:00:01.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPublicProfile(publicProfile.uid)).rejects.toThrow(/timestamp/i);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ schemaVersion: 1, profiles: [{ uid: publicProfile.uid, path: `${publicProfile.uid}.json`, updatedAt }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...publicProfile, updatedAt: "2026-08-20T01:00:01.000Z" }) }));
    render(<MemoryRouter initialEntries={[`/profiles/public/${publicProfile.uid}`]}><Routes><Route path="/profiles/public/:uid" element={<PublicProfilePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("未显示未经验证的数据");
  });
});
