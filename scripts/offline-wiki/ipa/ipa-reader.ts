import { spawnSync } from "node:child_process";

export type IpaBuildInfo = {
  liveVersion: string;
  gameVersion: string;
  buildTimestamp: string;
  binaryVersionEntry: string;
  chineseTextMapEntry: string;
  ipaChecksum: string;
};

function run(command: string, arguments_: string[], encoding?: BufferEncoding): Buffer | string {
  const result = spawnSync(command, arguments_, {
    encoding,
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`unable to inspect IPA archive: ${result.error.message}`);
  if (result.status !== 0) {
    const error = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    throw new Error(`invalid IPA ZIP archive: ${String(error).trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

export function readIpaEntry(ipaPath: string, entry: string): Buffer {
  if (!entry || entry.includes("\n") || entry.includes("\r") || entry.startsWith("-")) {
    throw new Error("invalid IPA entry name");
  }
  const output = run("/usr/bin/unzip", ["-p", ipaPath, entry]);
  if (!Buffer.isBuffer(output)) throw new Error("IPA entry reader returned text unexpectedly");
  return output;
}

function checksum(path: string): string {
  const output = String(run("/usr/bin/sha256sum", ["--", path], "utf8"));
  const match = /^([a-f0-9]{64})\s/u.exec(output);
  if (!match) throw new Error("unable to checksum IPA archive");
  return `sha256:${match[1]}`;
}

export function inspectIpa(ipaPath: string): IpaBuildInfo {
  const listing = String(run("/usr/bin/unzip", ["-Z1", ipaPath], "utf8"));
  const entries = listing.split(/\r?\n/u).filter(Boolean);
  const binaryVersions = entries.filter((entry) => /\/Data\/Raw\/BinaryVersion\.bytes$/u.test(entry));
  if (binaryVersions.length !== 1) throw new Error("IPA must contain exactly one BinaryVersion.bytes");
  const chineseTextMaps = entries.filter((entry) => /\/Data\/Raw\/DesignData\/iOS\/cn\/[^/]+\.bytes$/u.test(entry));
  if (chineseTextMaps.length !== 1) throw new Error("IPA must contain exactly one Chinese DesignData TextMap");

  const versionBytes = readIpaEntry(ipaPath, binaryVersions[0]!);
  const versionText = versionBytes.toString("latin1");
  const version = /V(\d+\.\d+)Live/u.exec(versionText);
  const buildTimestamp = /(20\d{6}-\d{4})/u.exec(versionText);
  if (!version || !buildTimestamp) throw new Error("BinaryVersion.bytes lacks a released build identity");
  if (version[1] !== "4.5") throw new Error(`expected a 4.5 IPA, received ${version[1]}`);

  return {
    liveVersion: version[0],
    gameVersion: version[1],
    buildTimestamp: buildTimestamp[1],
    binaryVersionEntry: binaryVersions[0]!,
    chineseTextMapEntry: chineseTextMaps[0]!,
    ipaChecksum: checksum(ipaPath),
  };
}
