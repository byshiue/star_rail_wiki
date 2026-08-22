import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import entities from "../../public/data/releases/4.4-cn-2026-08-21/entities.json";
import release from "../../public/data/releases/4.4-cn-2026-08-21/release.json";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { GameReleaseBundleSchema } from "../domain/releases";
import { TeamSimulatorPage } from "./TeamSimulatorPage";
import { decodeTeamBuild } from "./teamBuild";

const bundle = GameReleaseBundleSchema.parse({ release, entities });

test("edits only reviewed scaling skills and preserves the level in a share payload", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/simulator"]}>
    <ReleaseProvider bundle={bundle}><TeamSimulatorPage /></ReleaseProvider>
  </MemoryRouter>);

  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:1101");
  const level = screen.getByRole("combobox", { name: "布洛妮娅作战再部署技能等级" });
  expect(level).toHaveValue("1");
  expect(screen.getByText("当前等级：1（默认）")).toBeVisible();

  await user.selectOptions(level, "15");
  expect(screen.getByText("当前等级：15（明确选择）")).toBeVisible();
  await waitFor(() => {
    const share = (screen.getByLabelText(/分享链接/) as HTMLInputElement).value;
    const encoded = new URLSearchParams(share.split("?")[1]).get("build")!;
    expect(decodeTeamBuild(encoded).members[0]?.skillLevels).toEqual({ "ability:110102": 15 });
  });

  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:1001");
  expect(screen.queryByRole("combobox", { name: "布洛妮娅作战再部署技能等级" })).not.toBeInTheDocument();
  await waitFor(() => {
    const share = (screen.getByLabelText(/分享链接/) as HTMLInputElement).value;
    const encoded = new URLSearchParams(share.split("?")[1]).get("build")!;
    expect(decodeTeamBuild(encoded).members[0]?.skillLevels).toBeUndefined();
  });
});

test("shows reviewed scaling selectors for traces and unlocked eidolons", async () => {
  const user = userEvent.setup();
  const extendedEntities = structuredClone(bundle.entities);
  const bronya = extendedEntities.characters.find(({ logicalId }) => logicalId === "character:1101")!;
  bronya.traces[0]!.effectIds.push("effect:test:trace-level");
  bronya.eidolons[0]!.effectIds.push("effect:test:eidolon-level");
  const source = bundle.entities.effects.find(({ id }) => id === "effect:4.4:0412")!;
  extendedEntities.effects.push(
    { ...source, id: "effect:test:trace-level", sourceRevisionId: "trace:1101001@4.4-cn-2026-08-21" },
    { ...source, id: "effect:test:eidolon-level", sourceRevisionId: "eidolon:110101@4.4-cn-2026-08-21" },
  );
  const extended = GameReleaseBundleSchema.parse({
    release,
    entities: extendedEntities,
  });
  render(<MemoryRouter initialEntries={["/simulator"]}>
    <ReleaseProvider bundle={extended}><TeamSimulatorPage /></ReleaseProvider>
  </MemoryRouter>);

  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:1101");
  expect(screen.getByRole("combobox", { name: "布洛妮娅trace 1101001技能等级" })).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "布洛妮娅养精蓄锐技能等级" })).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("布洛妮娅星魂"), "1");
  expect(screen.getByRole("combobox", { name: "布洛妮娅养精蓄锐技能等级" })).toBeVisible();
});
