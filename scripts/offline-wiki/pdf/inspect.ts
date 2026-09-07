export function countPdfPages(bytes: Uint8Array): number {
  const source = Buffer.from(bytes).toString("latin1");
  return source.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}
