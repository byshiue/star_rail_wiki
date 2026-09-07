import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDocumentCatalog } from "./catalog";
import { createDraftRequests } from "./draft";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "releases");

describe("offline wiki Agent draft queue", () => {
  it("creates one source-backed request for each story entity without a reviewed summary", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");

    const requests = createDraftRequests(catalog, []);

    expect(requests.map(({ logicalId, entityKind, outputFilename }) => ({ logicalId, entityKind, outputFilename })))
      .toEqual([
        { logicalId: "character:1", entityKind: "character", outputFilename: "character-1.draft.json" },
        { logicalId: "light-cone:1", entityKind: "light-cone", outputFilename: "light-cone-1.draft.json" },
        { logicalId: "relic-set:1", entityKind: "relic-set", outputFilename: "relic-set-1.draft.json" },
      ]);
    expect(requests[0]?.provenance).toHaveLength(1);
    expect(requests[0]?.instruction).toMatch(/原创.*摘要/);
  });
});
