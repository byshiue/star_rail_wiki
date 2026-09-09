export type StoryFamily =
  | "character"
  | "light-cone"
  | "relic-set"
  | "worldview"
  | "collectible"
  | "divergent-universe"
  | "mission";

export type StorySection = {
  order: number;
  title: string | null;
  speaker: string | null;
  branch: string | null;
  body: string;
  sourceHash: string;
};

export type StoryRecord = {
  schemaVersion: 1;
  logicalId: string;
  family: StoryFamily;
  kind: string;
  name: string;
  sections: StorySection[];
  provenance: {
    sourceTables: string[];
    sourceRowIds: string[];
  };
};

export type StoryRejection = {
  family: StoryFamily;
  logicalId: string;
  reason: "missing-text" | "invalid-row";
  sourceTable: string;
  missingHashes: string[];
};

export type StoryArchive = {
  schemaVersion: 1;
  records: StoryRecord[];
  rejections: StoryRejection[];
};
