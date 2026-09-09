# 4.5 IPA 完整故事导入设计

## 目标

从用户提供的 `com.HoYoverse.hkrpgoversea_4.5.0_und3fined.ipa` 建立独立的 4.5 简体中文离线故事资料库和 PDF。正文必须是完整原文；摘要、AI 扩写、截断字符串和占位文本都不得进入“全文”区域。

## 来源与版本

- IPA 是版本锚点和第一正文来源。必须从 `BinaryVersion.bytes` 取得 `V4.5Live` 与构建时间，并记录 IPA SHA-256。
- IPA 只含启动资源。内置中文 TextMap 实测 58,144 条，不能冒充完整安装数据。
- 缺失映射和安装后文本只从固定提交 `5d064ec9bdf7b8983957abc6e45494dd76c8a8fa` 的 Dimbreath `TurnBasedGameData` 最早 4.5 正式版快照补齐。导出记录该提交，不读取可变分支内容。
- IPA 与补充 TextMap 的重叠哈希默认必须逐字节一致；任何冲突、版本不符或缺失正文均使对应条目拒绝或使严格构建失败。
- 对已确认的 4.5 预载版/正式发布版差异，导入命令必须显式启用 `prefer-supplement`，采用正式发布正文，并仅在审计中记录冲突哈希、两侧 SHA-256 与 UTF-8 字节长度，不复制冲突正文。

## 输出边界

- 原文、规范化 JSONL、HTML、PDF、来源缓存和审计报告全部位于 `.local/offline-wiki/ipa-imports/4.5-cn-2026-08-13/`，受现有 `.gitignore` 保护。
- Git 只提交通用提取器、测试、文档和不包含官方长文的短来源配置。
- 4.4 release 和现有 PDF 不覆盖、不迁移。

## 数据模型

本地记录包含 `logicalId`、`family`、`kind`、`name`、有序 `sections` 和来源证明。每个 section 保存标题、说话人、分支和完整正文。来源证明至少包含 IPA checksum、内部条目名、游戏版本、构建时间、映射提交和所有输入文件 checksum。

首批结构化家族：

- `character`：`AvatarConfig`、`StoryAtlas`、`StoryAtlasTextmap`。
- `light-cone`：`EquipmentConfig`、`ItemConfigEquipment`。
- `relic-set`：`RelicConfig`、`RelicSetConfig`、`ItemConfigRelic`，按套装和部位保留每段故事。
- `worldview`：`NounAtlas`。
- `collectible`：`BookSeriesConfig`、`LocalbookConfig`。
- `divergent-universe`：差分宇宙图鉴和故事显示表；仅接受显式名称/正文哈希字段。
- `mission`：`Story/` 中对话节点；按文件和分支顺序保留说话人及正文，不把控制参数当正文。

## 完整性规则

1. TextMap 二进制解析必须消费并验证主表边界，拒绝越界、非法 UTF-8、重复哈希冲突及不支持的字段掩码。
2. 每个结构化条目的所有正文哈希都必须可解析为非空文本；缺一段即不标记完整。
3. 任务分支不得合并或重排；同一节点的选项分别保存。
4. HTML 清除游戏富文本控制标签但保留可见文字、换行和段落；JSONL 保存规范化后的完整可见文本。
5. 报告分别列出完整、缺失哈希、未知类别、重复冲突和未归属文本，不以覆盖百分比掩盖未知基准。

## 构建

新增 `docs:extract-ipa-lore` 生成本地规范化数据和审计报告，新增 `docs:build-ipa-lore` 生成分册 HTML/PDF。默认严格模式只在无冲突且所有已建模条目都有完整正文时成功；未建模表会出现在审计报告而非被摘要替代。
