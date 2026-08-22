import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProfile } from "../domain/profiles";
import { PublicProfileConsent } from "./PublicProfileConsent";
import { PublicProfilePage } from "./PublicProfilePage";
import {
  createPublicProfileExport,
  loadPublicProfile,
  publicProfilePath,
} from "./publication";

const localProfile: AccountProfile & Record<string, unknown> = {
  schemaVersion: 1,
  uid: "100000001",
  label: "不应公开的显示名",
  region: "asia",
  dataReleaseId: "release-4.3",
  updatedAt: "2026-08-21T01:00:00.000Z",
  characters: [{ logicalId: "character:a", eidolon: 2, level: 80 }],
  lightCones: [{ logicalId: "light-cone:a", superimposition: 3, level: 80 }],
  relics: [{ instanceId: "local-relic-instance", setLogicalId: "relic-set:a", slot: "head" }],
  inventorySources: [{ kind: "hsr-scanner", build: "v1.5.0", formatVersion: 4,
    importedAt: "2026-08-21T00:00:00.000Z", counts: { characters: 1, lightCones: 1, relics: 1 } }],
  browserMetadata: { databaseRevision: 7 },
  accessToken: "secret",
};

const publicProfile = {
  schemaVersion: 1 as const,
  uid: "100000001",
  releaseId: "release-4.3",
  updatedAt: "2026-08-21T01:00:00.000Z",
  publication: { visibility: "public" as const, consentedAt: "2026-08-21T02:00:00.000Z" },
  characters: [{ logicalId: "character:a", eidolon: 2, level: 80 }],
  lightCones: [{ logicalId: "light-cone:a", superimposition: 3, level: 80 }],
  relics: [{ setLogicalId: "relic-set:a", slot: "head" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("public profile export", () => {
  it("refuses publication without an active disclosure confirmation", () => {
    expect(() => createPublicProfileExport(localProfile, null)).toThrow(/public consent required/i);
  });

  it("creates a strict minimal public payload without private or browser-only fields", () => {
    const scannerProfile = {
      ...localProfile,
      lightCones: [{ instanceId: "hsr-scanner:light-cone:snapshot:0", logicalId: "light-cone:a", superimposition: 3, level: 80 }],
      relics: [{ instanceId: "hsr-scanner:relic:snapshot:0", setLogicalId: "relic-set:a", slot: "head" }],
    };
    const exported = createPublicProfileExport(scannerProfile, "2026-08-21T02:00:00.000Z");
    expect(exported).toEqual(publicProfile);
    expect(JSON.stringify(exported)).not.toMatch(/显示名|browserMetadata|accessToken|secret|instanceId|inventorySources|hsr-scanner|v1\.5\.0/);
  });

  it.each(["../100000001", "100000001/extra", "１０００００００１", "10000000"])(
    "rejects unsafe UID path input %s",
    (uid) => expect(() => publicProfilePath(uid)).toThrow(/invalid public profile uid/i),
  );
});

describe("public profile consent UI", () => {
  it("previews every public field and creates no artifact until the checkbox is active", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<PublicProfileConsent profile={localProfile} now={() => "2026-08-21T02:00:00.000Z"} />);

    expect(screen.getAllByText(/UID 100000001/)).toHaveLength(2);
    expect(screen.getByText(/角色.*character:a/)).toBeInTheDocument();
    expect(screen.getByText(/光锥.*light-cone:a/)).toBeInTheDocument();
    expect(screen.getByText(/遗器套装.*relic-set:a/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "发布公开档案" }).closest("section")).toHaveTextContent("任何人读取");
    expect(screen.getByRole("heading", { name: "发布公开档案" }).closest("section")).toHaveTextContent(/Git 历史.*仍可能可见/);
    const generate = screen.getByRole("button", { name: "生成公开 JSON" });
    expect(generate).toBeDisabled();
    expect(screen.queryByLabelText("公开 JSON")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /我明确同意公开/ }));
    await user.click(generate);

    expect(screen.getByLabelText("公开 JSON")).toHaveValue(JSON.stringify(publicProfile, null, 2));
    expect(screen.getByRole("link", { name: /下载.*100000001\.json/ })).toHaveAttribute("download", "100000001.json");
    const github = screen.getByRole("link", { name: /GitHub.*新建文件/ });
    expect(github).toHaveAttribute("href", expect.stringContaining("github.com/byshiue/star_rail_wiki"));
    expect(github.getAttribute("href")).not.toContain(encodeURIComponent(JSON.stringify(publicProfile)));
    expect(screen.getByText(/public\/profiles\/100000001\.json/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("merged public profile page", () => {
  it("loads only an indexed merged profile and rejects cross-UID content", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ schemaVersion: 1, profiles: [{ uid: "100000001", path: "100000001.json", updatedAt: publicProfile.updatedAt }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...publicProfile, uid: "100000002" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPublicProfile("100000001")).rejects.toThrow(/does not match requested uid/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows safe loading, not-found, and error states", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ schemaVersion: 1, profiles: [] }) }));
    render(<MemoryRouter initialEntries={["/profiles/public/100000001"]}><Routes>
      <Route path="/profiles/public/:uid" element={<PublicProfilePage />} />
    </Routes></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载公开档案");
    expect(await screen.findByText(/尚无已合并的公开档案/)).toBeInTheDocument();
  });
});
