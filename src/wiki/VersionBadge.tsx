import type { DataRelease } from "../domain/releases";

export function VersionBadge({ release }: { release: DataRelease }) {
  const label = release.channel === "released" ? "正式服" : "测试夹具";
  return <span className={`version-badge version-badge--${release.channel}`}>{label} {release.gameVersion}</span>;
}
