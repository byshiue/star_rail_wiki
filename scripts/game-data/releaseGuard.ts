import type { ApprovedSourceManifest } from "./sourceManifest";

export function assertReleasedChannel(manifest: ApprovedSourceManifest): void {
  for (const source of manifest.sources) {
    if (source.channel !== "released" || source.gameVersion !== manifest.gameVersion) {
      throw new Error(
        `released channel mismatch: ${source.name} is ${source.channel} ${source.gameVersion}, expected released ${manifest.gameVersion}`,
      );
    }
  }
}
