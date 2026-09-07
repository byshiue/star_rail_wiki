import type { EntityProvenance, FeatureRevision } from "../../../src/domain/entities";
import type { DocumentChanges } from "../changes";
import type { DocumentCatalog, LoreCoverageMetric, StorySummary } from "../schema";
import { anchorFor, escapeHtml, htmlDocument, textToHtml } from "./html";
import { LORE_FAMILY_INDEXES } from "./lore-volumes";

export type VolumeRenderInput = {
  catalog: DocumentCatalog;
  summaries: StorySummary[];
  assets?: RenderAsset[];
  changes?: DocumentChanges;
};

export type RenderAsset = {
  logicalId: string;
  dataUrl: string;
  attribution: string;
};

export type RenderedVolume = {
  filename: string;
  title: string;
  html: string;
};

function sources(provenance: EntityProvenance[]): string {
  const unique = [...new Map(provenance.map((item) => [`${item.sourceUrl}|${item.sourceRevision}`, item])).values()];
  return `<div class="source"><strong>来源：</strong>${unique.map((item) => (
    `<a href="${escapeHtml(item.sourceUrl)}">${escapeHtml(item.sourceName)}</a> · revision ${escapeHtml(item.sourceRevision)}`
  )).join("；")}</div>`;
}

function story(logicalId: string, summaries: Map<string, StorySummary>): string {
  const summary = summaries.get(logicalId);
  const attribution = summary?.reviewStatus === "reviewed"
    ? `原创摘要 · ${escapeHtml(summary.reviewer.name)} 审核`
    : summary
      ? `原创摘要 · 自动生成 · 未经人工复核 · ${escapeHtml(summary.generator.name)}`
      : "";
  return summary
    ? `<section><h3>故事摘要</h3><p>${textToHtml(summary.summary)}</p><p class="meta">${attribution}</p></section>`
    : `<section><h3>故事摘要</h3><p class="missing">尚无原创故事摘要。</p></section>`;
}

function image(logicalId: string, label: string, assets: Map<string, RenderAsset>): string {
  const asset = assets.get(logicalId);
  if (!asset) return `<div class="image-placeholder">${escapeHtml(label)}未缓存</div>`;
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(asset.dataUrl)) {
    throw new Error(`invalid embedded image data URL for ${logicalId}`);
  }
  return `<figure><img class="entry-image" src="${escapeHtml(asset.dataUrl)}" alt="${escapeHtml(label)}"><figcaption class="attribution">${escapeHtml(asset.attribution)}</figcaption></figure>`;
}

function featureSection(title: string, features: FeatureRevision[]): string {
  if (features.length === 0) return `<section><h3>${escapeHtml(title)}</h3><p class="missing">无资料。</p></section>`;
  return `<section><h3>${escapeHtml(title)}</h3>${features.map((feature) => (
    `<div class="feature"><strong>${escapeHtml(feature.name)}</strong> · ${escapeHtml(feature.kind)}<p>${textToHtml(feature.originalText)}</p>${sources(feature.provenance)}</div>`
  )).join("")}</section>`;
}

function toc(items: Array<{ logicalId: string; name: string }>): string {
  return `<nav><h2>目录</h2><ol class="toc">${items.map((item) => (
    `<li><a href="#${anchorFor(item.logicalId)}">${escapeHtml(item.name)}</a></li>`
  )).join("")}</ol></nav>`;
}

function renderCharacters(
  input: VolumeRenderInput,
  summaryMap: Map<string, StorySummary>,
  assetMap: Map<string, RenderAsset>,
): string {
  const body = `${toc(input.catalog.characters)}${input.catalog.characters.map((character) => `
    <article class="entry" id="${anchorFor(character.logicalId)}">
      <h2>${escapeHtml(character.name)}</h2>
      <p class="meta">${character.rarity}★ · ${escapeHtml(character.element)} · ${escapeHtml(character.path)} · ${escapeHtml(input.catalog.release.id)}</p>
      ${image(character.logicalId, "角色图片", assetMap)}
      <p>${textToHtml(character.description)}</p>
      ${featureSection("技能", character.abilities)}
      ${featureSection("行迹", character.traces)}
      ${featureSection("星魂", character.eidolons)}
      ${story(character.logicalId, summaryMap)}
      ${sources(character.provenance)}
      <p class="return"><a href="#top">返回目录</a></p>
    </article>`).join("")}`;
  return htmlDocument("角色图鉴", `${input.catalog.release.gameVersion} · ${input.catalog.release.id}`, body);
}

function renderEquipment(
  input: VolumeRenderInput,
  summaryMap: Map<string, StorySummary>,
  assetMap: Map<string, RenderAsset>,
  kind: "light-cone" | "relic-set",
): string {
  const items = kind === "light-cone" ? input.catalog.lightCones : input.catalog.relicSets;
  const title = kind === "light-cone" ? "光锥图鉴" : "遗器图鉴";
  const body = `${toc(items)}${items.map((item) => `
    <article class="entry" id="${anchorFor(item.logicalId)}">
      <h2>${escapeHtml(item.name)}</h2>
      <p class="meta">${item.rarity === null ? "套装" : `${item.rarity}★`} · ${item.pathRestriction ? escapeHtml(item.pathRestriction) : "无命途限制"} · ${escapeHtml(input.catalog.release.id)}</p>
      ${image(item.logicalId, "装备图片", assetMap)}
      <section><h3>能力效果</h3><p>${textToHtml(item.description)}</p></section>
      ${story(item.logicalId, summaryMap)}
      ${sources(item.provenance)}
      <p class="return"><a href="#top">返回目录</a></p>
    </article>`).join("")}`;
  return htmlDocument(title, `${input.catalog.release.gameVersion} · ${input.catalog.release.id}`, body);
}

function renderIndex(input: VolumeRenderInput): string {
  const { catalog } = input;
  const rows = [
    ["角色", catalog.characters.length, "01-角色图鉴.html"],
    ["光锥", catalog.lightCones.length, "02-光锥图鉴.html"],
    ["遗器", catalog.relicSets.length, "03-遗器图鉴.html"],
    ...LORE_FAMILY_INDEXES.map(({ family, label, filename }) => [
      label,
      catalog.lore.filter((record) => record.family === family).length,
      filename,
    ] as const),
  ] as const;
  const changes = input.changes;
  const entityIndex = [
    ["角色", "01-角色图鉴.pdf", catalog.characters],
    ["光锥", "02-光锥图鉴.pdf", catalog.lightCones],
    ["遗器", "03-遗器图鉴.pdf", catalog.relicSets],
  ].map(([label, filename, items]) => {
    const typedItems = items as Array<{ logicalId: string; name: string }>;
    return `<section><h2>${escapeHtml(label as string)}条目索引</h2><ol class="toc">${typedItems.map((item) => (
      `<li><a href="${filename}#${anchorFor(item.logicalId)}">${escapeHtml(item.name)}</a> <span class="meta">${escapeHtml(item.logicalId)}</span></li>`
    )).join("")}</ol></section>`;
  }).join("");
  const changeSection = changes ? `<section><h2>版本变化</h2><p>相对 ${escapeHtml(changes.baselineReleaseId ?? "无基准版本")}</p>
    <h3>新增（${changes.added.length}）</h3><ul>${changes.added.map((id) => `<li>${escapeHtml(id)}</li>`).join("")}</ul>
    <h3>变更（${changes.changed.length}）</h3><ul>${changes.changed.map((id) => `<li>${escapeHtml(id)}</li>`).join("")}</ul>
    <h3>移除（${changes.removed.length}）</h3><ul>${changes.removed.map((id) => `<li>${escapeHtml(id)}</li>`).join("")}</ul>
    <p>未变更：${changes.unchanged.length}</p></section>` : "";
  const rejectedLore = (metric: LoreCoverageMetric) => metric.rejectedLaterVersion
    + metric.rejectedAmbiguousVersion
    + metric.invalidRelationships
    + Object.values(metric.importRejections).reduce((sum, count) => sum + count, 0);
  const loreCoverage = catalog.loreCoverage.totals.baselineStatus === "complete"
    ? `基准完整；结构化 ${catalog.loreCoverage.totals.structured}/${catalog.loreCoverage.totals.expected}（覆盖率 ${catalog.loreCoverage.totals.percentage!.toFixed(1)}%）；本地全文 ${catalog.loreCoverage.totals.fullText}；拒绝 ${rejectedLore(catalog.loreCoverage.totals)}。`
    : `基准缺失；结构化 ${catalog.loreCoverage.totals.structured}；本地全文 ${catalog.loreCoverage.totals.fullText}；拒绝 ${rejectedLore(catalog.loreCoverage.totals)}；不报告覆盖百分比。`;
  const body = `<section><h2>资料覆盖</h2><table><thead><tr><th>分册</th><th>条目</th></tr></thead><tbody>${rows.map(([label, count, filename]) => (
    `<tr><td><a href="${filename}">${label}</a></td><td>${count}</td></tr>`
  )).join("")}</tbody></table><p>故事摘要：${catalog.summaryCoverage.available}（人工复核 ${catalog.summaryCoverage.reviewed}；自动生成 ${catalog.summaryCoverage.autoGenerated}）；缺少：${catalog.summaryCoverage.missing}。</p><p>背景资料：${loreCoverage}</p></section>${changeSection}${entityIndex}`;
  return htmlDocument("崩坏：星穹铁道离线图鉴总索引", `${catalog.release.gameVersion} · ${catalog.release.id}`, body);
}

export function renderVolumes(input: VolumeRenderInput): RenderedVolume[] {
  const summaryMap = new Map(input.summaries
    .filter((summary) => summary.releaseId === input.catalog.release.id)
    .map((summary) => [summary.logicalId, summary]));
  const assetMap = new Map((input.assets ?? []).map((asset) => [asset.logicalId, asset]));
  return [
    { filename: "00-总索引.html", title: "总索引", html: renderIndex(input) },
    { filename: "01-角色图鉴.html", title: "角色图鉴", html: renderCharacters(input, summaryMap, assetMap) },
    { filename: "02-光锥图鉴.html", title: "光锥图鉴", html: renderEquipment(input, summaryMap, assetMap, "light-cone") },
    { filename: "03-遗器图鉴.html", title: "遗器图鉴", html: renderEquipment(input, summaryMap, assetMap, "relic-set") },
  ];
}
