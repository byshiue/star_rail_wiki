import type { RouteObject } from "react-router-dom";
import { CharacterBuilderPage } from "../simulator/CharacterBuilderPage";
import { TeamSimulatorPage } from "../simulator/TeamSimulatorPage";
import { EntityDetailPage } from "../wiki/EntityDetailPage";
import { WikiPage } from "../wiki/WikiPage";
import { ReleaseProvider } from "./ReleaseProvider";

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
    element: <ReleaseProvider><WikiPage /></ReleaseProvider>,
  },
  {
    path: "/wiki/:kind/:logicalId",
    element: <ReleaseProvider><EntityDetailPage /></ReleaseProvider>,
  },
  {
    path: "/builds",
    element: <ReleaseProvider><CharacterBuilderPage /></ReleaseProvider>,
  },
  {
    path: "/simulator",
    element: <ReleaseProvider><TeamSimulatorPage /></ReleaseProvider>,
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
