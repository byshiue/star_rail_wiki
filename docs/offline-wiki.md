# 离线 Wiki PDF 制作流程

这套流程把仓库中固定版本、附带来源的正式服资料转换为可搜索的简体中文离线图鉴。仓库提交短机制、事实、原创摘要、关系与来源；用户合法取得的官方长文只可经本地导入，和 HTML、PDF、图片缓存、草稿一样保存在被 Git 忽略的 `.local/offline-wiki/`。项目不会建立 HoYoWiki 全站镜像，也不会把这些本地资料上传 GitHub。

当前正式 release 是 `4.4-cn-2026-08-21`。角色、光锥、遗器沿用既有分册；新增差分宇宙、世界观、剧情、文本收藏四个索引，并只为有结构化记录的子类生成内容分册。生产 lore 目前没有获准条目，四类基准也都尚未建立，因此索引会诚实显示缺漏，而不是冒充完整 4.4 Wiki。

## 环境

需要 Node.js 24。首次安装：

```bash
npm ci
npx playwright install chromium
```

Chromium 只用于本地把 HTML 打印为 PDF。GitHub Actions 不安装浏览器、不调用 Agent，也不生成或上传完整 PDF。

## 两条完整工作流

### 未导入本地全文：公开摘要版

先确认默认 overlay 不存在；不要为取得“摘要版”而删除已有资料。若该文件已经存在，应先备份或在另一份干净 clone 中构建。

```bash
test ! -e .local/offline-wiki/imports/4.4-cn-2026-08-21/normalized/current.jsonl
npm run docs:prepare -- --release 4.4-cn-2026-08-21
npm run docs:html -- --release 4.4-cn-2026-08-21
npm run docs:build -- --release 4.4-cn-2026-08-21
npm run docs:verify -- --release 4.4-cn-2026-08-21
```

这不是强制忽略本地资料的开关。`docs:prepare`、`docs:html` 和 `docs:build` 都会自动尝试读取默认 overlay；只有默认 overlay 不存在时，结果才是纯公开摘要版。`docs:build` 会在事务性的 staging 目录重建 HTML 并生成 PDF，因此单独执行 `docs:html` 便于预览，但不是 `docs:build` 的前置条件。

### 已有合法本地资料：全文版

先为输入建立下述 manifest，再执行：

```bash
npm run docs:import-lore -- --release 4.4-cn-2026-08-21 --manifest /absolute/path/manifest.json --source-root /absolute/path/source
npm run docs:prepare -- --release 4.4-cn-2026-08-21
npm run docs:html -- --release 4.4-cn-2026-08-21
npm run docs:build -- --release 4.4-cn-2026-08-21
npm run docs:verify -- --release 4.4-cn-2026-08-21
```

导入成功会产生 `.local/offline-wiki/imports/<release>/normalized/current.jsonl` 和 `report.json`。同一组 build 命令随后自动合并 overlay；它只能附加到仓库中已经存在、release、locale、family、kind、来源 revision 与来源 checksum 全部匹配的 lore 条目，不能借本地全文绕过正式 catalog 的 4.4 准入。

## 本地输入 manifest

manifest 是严格 JSON，当前只接受 `schemaVersion: 1`、`adapterVersion: 1`、`locale: "zh-CN"`、精确 release ID 和 `userProvided: true`：

```json
{
  "schemaVersion": 1,
  "releaseId": "4.4-cn-2026-08-21",
  "locale": "zh-CN",
  "source": {
    "name": "User-provided export",
    "revision": "immutable-export-id",
    "exportedAt": "2026-08-21T12:00:00.000Z"
  },
  "adapter": "canonical-jsonl",
  "adapterVersion": 1,
  "families": ["worldview"],
  "userProvided": true,
  "files": [
    {
      "path": "worldview.jsonl",
      "bytes": 1234,
      "checksum": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    }
  ]
}
```

`files` 必须精确列出 `source-root` 下的所有普通文件；manifest 位于 source root 内时是唯一例外，且不能把自己列为输入。路径必须是规范化相对路径，不接受绝对路径、`..`、反斜线或逃逸 symlink。每个文件先核对声明字节数、严格 UTF-8 和 SHA-256，再交给 adapter；单文件上限 16 MiB，整个 manifest 声明的批次上限 512 MiB。命令不接受 Cookie、token、账号导出或扫描器个人资料。

## 三种 adapter

### `canonical-jsonl`

manifest 必须只声明一个 JSONL 文件。每个非空行是一个严格 JSON object：

```json
{"logicalId":"lore:worldview:term:example","family":"worldview","kind":"term","name":"示例","releaseId":"4.4-cn-2026-08-21","locale":"zh-CN","sourceRevision":"immutable-export-id","sections":[{"order":0,"title":null,"speaker":null,"branch":null,"body":"用户本地提供的正文。"}]}
```

输入字段是 `logicalId`、`family`、`kind`、`name`、`sections`，以及可省略但若出现必须与 manifest 一致的 `releaseId`、`locale`、`sourceRevision`。`sections` 至少一项；每项包含非负且不重复的 `order`、可空的 `title`/`speaker`/`branch` 与非空 `body`。换行会统一为 LF，section 按 `order` 排序，branch 不会被合并。

成功导出的规范格式是 JSONL v2，每条记录额外包含 `schemaVersion: 2`、来源文件 `sourcePath`/`sourceChecksum`、按路径唯一排序的 `sourceDependencies: [{path, checksum}]`、`inputChecksum`、`contentChecksum`、`importedAt` 和 `adapterVersion`。`sourceDependencies` 把一个条目的全部输入依赖绑定到 manifest checksum；旧的无 `schemaVersion` v1 记录仅为了读取既有 overlay，新的导入永远写 v2，用户不应手写 normalized 文件。

### `saved-hoyowiki`

source root 必须含并在 manifest 中声明：

- `aggregate-list.json`：`{releaseId, locale, entries:[{id, category, name}]}`；`releaseId` 必须明确等于 manifest。
- `category-mapping.json`：`categories` 将原分类映射到批准的 `family`/`kind`，`entries` 将每个来源 ID 映射到 `logicalId` 与正文 `sourcePath`。
- mapping 引用的每个本地 HTML 文件。

adapter 只读取这些已声明的保存文件，不补抓网页。HTML 会被缩减为允许的标题与纯文本块；脚本、样式、表单、iframe、事件属性、远端媒体和危险 URL 不进入正文。聚合列表中的每个条目都必须有 mapping，且正文至少产生一个允许的文本块。

### `compatible-game-data`

source root 必须含并在 manifest 中声明这三个严格 JSON 文件：

- `ExcelOutput/LoreEntries.json`：`{releaseId, locale, rows:[{id, logicalId, family, kind, nameHash, storyId}]}`。
- `TextMap/TextMapCHS.json`：hash 到中文字符串的 object mapping。
- `Story/Story.json`：`{stories:[{id, sections:[{order, titleHash?, speakerHash?, branch?, bodyHash}]}]}`。

`LoreEntries.json` 的 release 必须明确等于 manifest。任何缺失的名称、正文、标题、说话人或 branch hash 都会拒绝对应批次；adapter 不猜测缺字，也不读取其他目录。

## 事务、拒绝报告与恢复

导入先在 `.local/offline-wiki/imports/<release>/` 相邻的 staging 目录写出 `current.jsonl` 与成功报告，重新读取并验证 checksum 后才用 rename 提升为 `normalized/`。若新输入、adapter 或 canonical 校验失败，旧的 `normalized/` 保持逐字节不变；失败摘要写到 `reports/last-rejected.json`，只记录 reason、source path、logical ID 和稳定的 adapter detail，不复制被拒正文。

提升过程有独占 lock、阶段 journal 和同目录 backup。异常退出后，下次导入会根据 journal、旧/新 output checksum 恢复唯一可证明的状态；状态含糊、lock 所有者仍活着或恢复资料不安全时会 fail closed，并在报告列出需人工检查的 recovery artifact 名称。已提交新 overlay 但 backup 清理失败时成功报告会含 `backup-cleanup-pending` warning。不要在导入运行中手动移动这些文件。

PDF 构建本身也使用 staging、lock、journal 与原子替换；失败不会把半套 HTML/PDF 冒充成功 build。

## 覆盖率与候选准入

`docs:prepare` 写入 `.local/offline-wiki/previews/<release>/prepare-report.json`，单独执行 `docs:html` 则写入同目录的 `html/`。preview 与最终 `builds/<release>/` 分离，所以重复预览不会在原子 build 开始前改动上一套已验证输出。每个 family/kind 分别报告结构化记录、原创摘要（人工审核/自动生成）、本地全文、来源缺漏、版本拒绝、关系错误及本地 adapter 拒绝。

`baselineStatus: "complete"` 只有在已有可信 expected count 与来源时才计算 `percentage = structured / expected × 100`（零条完整基准为 100%）；`baselineStatus: "missing"` 时 `expected` 和 `percentage` 都必须为 `null`。当前 HoYoWiki 目录是会变化的线上视图，可能已经包含 4.5 或更晚内容，也不提供每项的历史 4.4 revision，因此当前条目数不能建立 4.4 基准。

正式候选还必须有条目级、不可变、在 4.4 结束时刻之前发布的 release 证据与来源 artifact checksum。当前非穷尽 ledger 只有 4 个候选、0 个获准，四项分别记录为 1 个晚于版本、1 个版本不明、2 个缺来源；它是保守决策样本，不是 4.4 内容总表。

## 输出、检查与版本更新

构建目录为 `.local/offline-wiki/builds/4.4-cn-2026-08-21/`。manifest v2 要求 HTML 与 PDF 一一对应、checksum、PDF 页数、family/group、连续输出顺序和确定性命名。至少总会有八个 PDF：

```text
00-总索引.pdf
01-角色图鉴.pdf
02-光锥图鉴.pdf
03-遗器图鉴.pdf
04-差分宇宙-索引.pdf
05-世界观-索引.pdf
06-剧情-索引.pdf
07-文本收藏-索引.pdf
```

有结构化内容时才增加诸如 `04-差分宇宙-方程-001.pdf` 的分册。family 索引在基准缺失时显示“基准未建立”；存在正式记录但没有匹配 overlay 时，条目显示“本地全文未导入”。`docs:verify` 会验证 manifest v2、必需索引、连续分册、HTML/PDF 集合、每个 checksum 与实际 PDF 页数。

图片来源清单位于 `data/offline-wiki/assets.json`，`npm run docs:assets -- --release 4.4-cn-2026-08-21` 只把已验证图片写到 `.local/offline-wiki/assets/<release>/`。原创摘要草稿/审核流程仍可使用 `docs:draft` 与只监听 `127.0.0.1:4174` 的 `docs:review`；远端访问方法见 README 的 SSH tunnel 范例。

更新 release 时必须先加入新的正式服 release、官方版本时界、不可变 revision/checksum 和实体差异，再分别审核 lore baseline 与候选。禁止用 `latest`，禁止用当前目录计数倒推历史，禁止覆盖其他 release 的本地档案。完成后执行：

```bash
npm run docs:verify:repository
npm run check
```

仓库卫生检查会拒绝任何被 Git 追踪的 `.local/offline-wiki/` 路径、`data/offline-wiki/` 下的 `official-full-text`、`full-text-overlay`、`source-cache`、离线图片/PDF 和 `*.draft.json`。只提交生成器、测试、短结构化资料、来源清单与原创摘要；不要提交官方长文或本地生成物。
