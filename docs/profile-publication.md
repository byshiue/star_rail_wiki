# 公开账号档案发布流程

本地 JSON 备份与公开档案是两个独立格式。普通备份留在浏览器中；只有在“账号与版本”页查看完整公开字段预览并主动勾选同意后，页面才会生成公开 JSON。公开文件包含 UID、数据版本、更新时间、同意时间以及角色、光锥和去除本地实例编号后的遗器库存；不包含显示名、地区、本地数据库元数据或任何凭证。

## 提交公开档案

1. 下载页面生成的 `<uid>.json`。页面不会上传文件、请求或保存 GitHub token，也不会自动 push。
2. Fork `byshiue/star_rail_wiki`，在 GitHub 网页中把文件添加为 `public/profiles/<uid>.json`。
3. 在 `public/profiles/index.json` 增加同一 UID、精确文件名和 `updatedAt`。一个 UID 只能出现一次。
4. 创建 Pull Request。仓库检查会验证 consent、schema 版本、路径与正文 UID、索引组合、文件大小、未知字段、疑似凭证，以及 release/角色/光锥/遗器套装引用。只有审查并合并后的静态档案才会在站点显示。

## 更正与撤回

更正需要新的 Pull Request 同时替换档案和索引时间戳。撤回需要新的 Pull Request 删除 `public/profiles/<uid>.json` 及索引条目。合并删除后当前站点将不再显示该档案，但这不等于从 Git、GitHub、缓存或 GitHub Pages 历史部署中抹除；旧公开内容仍可能通过历史记录访问。若无法接受这种长期公开风险，请不要生成或提交公开文件。
