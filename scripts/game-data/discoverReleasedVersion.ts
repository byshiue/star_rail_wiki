import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export type OfficialPost = { title: string; url: string; publishedAt: string };
export type UpstreamCommit = { sha: string; message: string; committedAt: string };
export type Discovery = { status: "no-change" } | {
  status: "candidate"; gameVersion: string; officialNoticeUrl: string; officialPublishedAt: string;
  dimbreathRevision: string; dimbreathLabel: string; dimbreathCommittedAt: string;
  starRailResRevision: string; starRailResCommittedAt: string;
};

const immutableRevision = /^[a-f0-9]{40}$/;
const updateTitle = /\bVersion\s+(\d+\.\d+)\b.*\bUpdate Details\b/i;

function versionParts(version: string): [number, number] {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`invalid game version: ${version}`);
  return [Number(match[1]), Number(match[2])];
}

function compareVersions(left: string, right: string): number {
  const [leftMajor, leftMinor] = versionParts(left);
  const [rightMajor, rightMinor] = versionParts(right);
  return leftMajor - rightMajor || leftMinor - rightMinor;
}

export function discoverReleasedVersion(
  currentVersion: string,
  officialPosts: OfficialPost[],
  dimbreathCommits: UpstreamCommit[],
  starRailResCommits: UpstreamCommit[],
  now = new Date(),
): Discovery {
  const released = officialPosts.flatMap((post) => {
    const match = updateTitle.exec(post.title);
    if (!match?.[1] || !/^https:\/\/www\.hoyolab\.com\/article(?:_pre)?\/\d+$/.test(post.url)
      || !Number.isFinite(Date.parse(post.publishedAt)) || Date.parse(post.publishedAt) > now.getTime()) return [];
    return [{ ...post, gameVersion: match[1] }];
  }).filter(({ gameVersion }) => compareVersions(gameVersion, currentVersion) > 0)
    .sort((left, right) => compareVersions(right.gameVersion, left.gameVersion));
  const official = released[0];
  if (!official) return { status: "no-change" };

  const dimbreathPattern = new RegExp(`^OSPRODWin${official.gameVersion.replace(".", "\\.")}\\.0_`);
  const dimbreath = dimbreathCommits.find(({ sha, message }) => immutableRevision.test(sha) && dimbreathPattern.test(message));
  const starRailRes = starRailResCommits.find(({ sha, message }) => (
    immutableRevision.test(sha) && new RegExp(`Update to version ${official.gameVersion.replace(".", "\\.")}$`, "i").test(message)
  ));
  if (!dimbreath || !starRailRes) return { status: "no-change" };
  return {
    status: "candidate", gameVersion: official.gameVersion,
    officialNoticeUrl: official.url, officialPublishedAt: official.publishedAt,
    dimbreathRevision: dimbreath.sha, dimbreathLabel: dimbreath.message,
    dimbreathCommittedAt: dimbreath.committedAt,
    starRailResRevision: starRailRes.sha, starRailResCommittedAt: starRailRes.committedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("unexpected remote response");
  return value as Record<string, unknown>;
}

async function fetchJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json", "User-Agent": "star-rail-wiki-release-audit",
  };
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`release discovery failed (${response.status}) for ${new URL(url).host}`);
  return response.json();
}

async function officialPosts(): Promise<OfficialPost[]> {
  const payload = asRecord(await fetchJson(
    "https://bbs-api-os.hoyolab.com/community/post/wapi/getNewsList?gids=6&type=1&page_size=50",
  ));
  const data = asRecord(payload.data);
  const list = Array.isArray(data.list) ? data.list : [];
  return list.flatMap((entry) => {
    const post = asRecord(asRecord(entry).post);
    const id = String(post.post_id ?? "");
    const title = String(post.subject ?? "");
    const timestamp = Number(post.created_at ?? post.created_at_seconds ?? 0);
    if (!/^\d+$/.test(id) || !title || !Number.isFinite(timestamp) || timestamp <= 0) return [];
    return [{
      title,
      url: `https://www.hoyolab.com/article/${id}`,
      publishedAt: new Date(timestamp * 1000).toISOString(),
    }];
  });
}

async function githubCommits(repository: string): Promise<UpstreamCommit[]> {
  const payload = await fetchJson(`https://api.github.com/repos/${repository}/commits?per_page=100`);
  if (!Array.isArray(payload)) throw new Error("unexpected GitHub commits response");
  return payload.flatMap((item) => {
    const record = asRecord(item);
    const commit = asRecord(record.commit);
    const committer = asRecord(commit.committer);
    const sha = String(record.sha ?? "");
    const message = String(commit.message ?? "").split("\n")[0] ?? "";
    const committedAt = String(committer.date ?? "");
    return immutableRevision.test(sha) && message && Number.isFinite(Date.parse(committedAt))
      ? [{ sha, message, committedAt }] : [];
  });
}

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith("--")) throw new Error(`missing required option ${name}`);
  return value;
}

async function main(): Promise<void> {
  const result = discoverReleasedVersion(
    option("--current-version"),
    await officialPosts(),
    await githubCommits("DimbreathBot/TurnBasedGameData"),
    await githubCommits("Mar-7th/StarRailRes"),
  );
  const output = process.argv.includes("--output") ? option("--output") : null;
  if (output) await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
