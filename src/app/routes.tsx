import type { RouteObject } from "react-router-dom";

type PlaceholderPageProps = {
  title: string;
  purpose: string;
};

function PlaceholderPage({ title, purpose }: PlaceholderPageProps) {
  return (
    <section className="placeholder-page" aria-labelledby="page-title">
      <p className="eyebrow">功能建设中</p>
      <h1 id="page-title">{title}</h1>
      <p>{purpose}</p>
    </section>
  );
}

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <PlaceholderPage title="资料库" purpose="这里将按已审核的数据版本检索角色、技能、星魂、光锥、遗器与位面饰品的完整说明和来源。" />,
  },
  {
    path: "/builds",
    element: <PlaceholderPage title="角色构筑" purpose="这里将展示角色配置能够产生的增益、减益、触发条件、持续时间与证据链。" />,
  },
  {
    path: "/simulator",
    element: <PlaceholderPage title="配队实验室" purpose="这里将评估四人队伍的增益、减益、行动与资源效果，不冒充完整伤害模拟器。" />,
  },
  {
    path: "/agent",
    element: <PlaceholderPage title="Agent 推荐" purpose="这里将基于固定数据版本生成确定、可解释且无需 API 密钥的配队建议。" />,
  },
  {
    path: "/community",
    element: <PlaceholderPage title="社区配队" purpose="这里将展示带作者、来源链接、发布日期和适用版本的社区配队摘要。" />,
  },
  {
    path: "/profiles",
    element: <PlaceholderPage title="账号与版本" purpose="这里将按 UID 隔离管理本地账号档案、数据版本、导入导出与明确授权的公开流程。" />,
  },
];
