# Star Rail Wiki

简体中文、非官方的《崩坏：星穹铁道》版本化资料库与配队工具。当前资料固定到中国正式服 4.4（审计日期 2026-08-21），不包含测试服、预载、泄露或未发布资料。

功能包括中文角色/技能/行迹/星魂/光锥/遗器说明、版本来源、Buff 模拟、确定性 Agent 推荐、社区队伍，以及按 UID 隔离的 IndexedDB 私有库存。公开 UID JSON 只会在明确同意后生成，并由使用者通过 GitHub Pull Request 提交；浏览器不会保存 GitHub 凭证或自动上传。

> **覆盖率提示：**4.4 的 2,780 项含数值说明产生 4,667 条效果候选，其中 42 条经审核可计算（0.90%）；其余 4,625 条保留原文与具体不支持原因。42 条中只有 1 条是全队目标；另外新增 1 条单体队友与 1 条全体敌人效果。静默数值说明、未映射候选与未解析参数均为 0。

## 本地运行

需要 Node.js 24：

```bash
npm ci
npm run dev -- --host 127.0.0.1
```

远端开发时，在自己的电脑执行：

```bash
ssh -N -L 5173:127.0.0.1:5173 USER@REMOTE_HOST
```

然后打开 `http://127.0.0.1:5173/star_rail_wiki/`。若 Vite 使用其他端口，请同步替换两个 `5173`；有跳板机可加 `-J USER@JUMP_HOST`。不要把开发服务器绑定到公网接口。

## 验证与构建

```bash
npm run check
npm run test:e2e
npm audit --audit-level=high
```

production 使用 `/star_rail_wiki/` base path、hash routes，输出在 `dist/`。资料更新和覆盖率语义见 `docs/data-sources.md`；公开档案隐私说明见 `docs/profile-publication.md`。

## 免责声明

这是社区维护的非官方项目，与米哈游、HoYoverse 或资料/攻略作者无隶属关系。游戏名称、文字及相关知识产权归各权利人所有。移除或更正请求可通过 GitHub Issue 提交。
