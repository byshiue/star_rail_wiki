# 4.5 IPA 完整故事导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 4.5 IPA 与固定同版映射快照自动生成只保存在本地的完整中文故事 JSONL、审计报告和 PDF。

**Architecture:** 用小型、独立的 IPA 读取器和 TextMap 解码器建立可信文本层，再由分类提取器把固定映射表转换为统一 story records。渲染器只接受通过完整性审计的 records，输出到被 Git 忽略的 4.5 专属目录，完全独立于现有 4.4 release。

**Tech Stack:** TypeScript、Node.js 24、Vitest、系统 `/usr/bin/unzip`、现有 HTML/PDF 渲染基础设施。

**Spec:** `docs/superpowers/specs/2026-09-09-ipa-lore-import-design.md`

## Global Constraints

- 不提交或发布任何官方长文、PDF、HTML、TextMap 或来源缓存。
- 不用摘要、AI 扩写、字符串扫描结果或占位文本代替完整原文。
- IPA 与补充快照重叠 TextMap 哈希默认必须逐字一致。
- 本次 4.5 正式发布构建经用户批准显式采用补充快照正文覆盖 3 条预载差异，并把哈希、两侧 checksum 和长度写入本地审计，不复制正文。
- 4.5 输出不得覆盖 4.4 数据与构建。
- 不修改或暂存用户已有的三个未跟踪 character-buffs 文件。

---

### Task 1: IPA 与 TextMap 可信读取层

**Files:**
- Create: `scripts/offline-wiki/ipa/ipa-reader.ts`
- Create: `scripts/offline-wiki/ipa/text-map.ts`
- Test: `scripts/offline-wiki/ipa/ipa-reader.test.ts`
- Test: `scripts/offline-wiki/ipa/text-map.test.ts`

**Interfaces:**
- Produces: `inspectIpa(path): IpaBuildInfo`、`readIpaEntry(path, entry): Buffer`、`decodeTextMap(bytes): DecodedTextMap`。

- [ ] 写入失败测试：拒绝非 ZIP、缺少 `BinaryVersion.bytes`、非 `V4.5Live`、截断 varint、非法 UTF-8、重复哈希冲突与未知 mask。
- [ ] 运行 `npx vitest run scripts/offline-wiki/ipa/ipa-reader.test.ts scripts/offline-wiki/ipa/text-map.test.ts`，确认因 API 尚不存在而失败。
- [ ] 实现最小读取和解析逻辑；TextMap 支持 4.5 的 legacy hash、64-bit hash、正文和参数标记，并验证尾部索引边界。
- [ ] 重跑测试并确认通过。

### Task 2: 固定 4.5 映射快照与原文一致性

**Files:**
- Create: `scripts/offline-wiki/ipa/source.ts`
- Create: `scripts/offline-wiki/ipa/source.test.ts`
- Create: `data/offline-wiki/ipa-sources/4.5-cn-2026-08-13.json`

**Interfaces:**
- Consumes: `DecodedTextMap`。
- Produces: `loadPinnedMapping(root, config): MappingSnapshot`、`mergeVerifiedTextMaps(ipa, supplement): VerifiedTextMap`。

- [ ] 写入失败测试：拒绝错误提交、错误版本、可变来源、重叠文字不一致、重复 hash 和缺少必需表。
- [ ] 运行测试确认正确失败。
- [ ] 实现固定提交配置、输入 checksum 清单、重叠逐字校验和来源报告；短配置不得包含正文。
- [ ] 重跑测试并确认通过。

### Task 3: 七类完整故事结构化提取

**Files:**
- Create: `scripts/offline-wiki/ipa/story-schema.ts`
- Create: `scripts/offline-wiki/ipa/extractors.ts`
- Create: `scripts/offline-wiki/ipa/extractors.test.ts`
- Create: `scripts/offline-wiki/ipa/mission.ts`
- Create: `scripts/offline-wiki/ipa/mission.test.ts`

**Interfaces:**
- Produces: `extractStoryArchive(snapshot, textMap): StoryArchive`，家族为 `character | light-cone | relic-set | worldview | collectible | divergent-universe | mission`。

- [ ] 为每个家族写最小 fixture 测试，断言逻辑 ID、章节顺序、标题、说话人、分支与正文哈希解析。
- [ ] 写缺一段即不完整、控制节点不进入正文、任务分支不合并的失败测试并运行 RED。
- [ ] 实现显式表适配器与任务节点遍历；禁止依据长文本关键字猜分类。
- [ ] 重跑全部提取测试并确认通过。

### Task 4: 本地事务输出、审计与 CLI

**Files:**
- Create: `scripts/offline-wiki/ipa/write.ts`
- Create: `scripts/offline-wiki/ipa/write.test.ts`
- Create: `scripts/offline-wiki/ipa/cli.ts`
- Modify: `package.json`
- Modify: `docs/offline-wiki.md`

**Interfaces:**
- Produces: `npm run docs:extract-ipa-lore -- --ipa <path> --mapping-root <path> --release 4.5-cn-2026-08-13`。

- [ ] 写入失败测试：输出只能位于 `.local/offline-wiki/ipa-imports/<release>`，失败不替换 last-good，报告不复制被拒正文。
- [ ] 运行测试确认 RED。
- [ ] 实现 staging、checksum、原子提升、`archive.jsonl` 与 `audit.json`；报告列出每类完整/拒绝/未建模数量。
- [ ] 重跑测试、typecheck 与仓库卫生检查。

### Task 5: 分册 HTML/PDF 与实际 4.5 构建

**Files:**
- Create: `scripts/offline-wiki/ipa/render.ts`
- Create: `scripts/offline-wiki/ipa/render.test.ts`
- Create: `scripts/offline-wiki/ipa/build.ts`
- Modify: `package.json`
- Modify: `docs/offline-wiki.md`

**Interfaces:**
- Produces: `npm run docs:build-ipa-lore -- --release 4.5-cn-2026-08-13` 与本地 build manifest。

- [ ] 写渲染测试，断言完整正文按 section 显示、没有摘要回退、HTML 转义正确、分册索引连续。
- [ ] 运行测试确认 RED。
- [ ] 实现七类分册、总索引和 PDF 打印，复用现有安全 HTML/CSS 与 Playwright 基础设施。
- [ ] 取得固定 4.5 映射文件，运行实际 IPA 提取；对比 58,144 个内置条目的所有重叠值。
- [ ] 生成 PDF 并运行 manifest/checksum、页数、checksum、全文缺失与 Git hygiene 验证。

### Task 6: 最终验证

**Files:**
- Modify only if verification exposes an in-scope defect.

- [ ] 运行 `npx vitest run scripts/offline-wiki/ipa`。
- [ ] 运行 `npm run typecheck`、`npm run lint`、`npm run docs:verify:repository`。
- [ ] 运行实际 4.5 audit，确认 `summaryFallbackCount = 0`、`textConflictCount = 0`，并报告仍未建模或缺少的官方类别。
- [ ] 用 `git status --short` 与 `git diff --check` 确认正文/PDF 未被追踪且用户文件未改变。
