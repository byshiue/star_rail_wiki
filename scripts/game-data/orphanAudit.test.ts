import { expect, it } from "vitest";
import { buildCharacterRankOrphanAudit, validateCharacterRankOrphanAudit } from "./orphanAudit";

const characters = {
  "1001": { id: "1001", ranks: ["100101", "100102"] },
  "1002": { id: "1002", ranks: ["100201"] },
};
const ranks = {
  "100101": { id: "100101" }, "100102": { id: "100102" },
  "100201": { id: "100201" }, "9000001": { id: "9000001" },
};

it("recomputes canonical and orphan rank IDs from immutable raw object indexes", () => {
  const report = buildCharacterRankOrphanAudit("release", "a".repeat(40), characters, ranks);
  expect(report).toMatchObject({
    rawRankIds: ["100101", "100102", "100201", "9000001"],
    canonicalReferencedRankIds: ["100101", "100102", "100201"],
    orphanRankIds: ["9000001"],
  });
  expect(() => validateCharacterRankOrphanAudit(report, ["100101", "100102", "100201"])).not.toThrow();
});

it.each(["rawRankIds", "canonicalReferencedRankIds", "orphanRankIds"] as const)(
  "rejects a hand-edited %s list that no longer represents the exact set difference",
  (field) => {
    const report = buildCharacterRankOrphanAudit("release", "a".repeat(40), characters, ranks);
    report[field] = report[field].slice(1);
    expect(() => validateCharacterRankOrphanAudit(report, ["100101", "100102", "100201"]))
      .toThrow(/orphan|canonical|raw rank/i);
  },
);
