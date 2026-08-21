import type { RouteObject } from "react-router-dom";
import { RecommendationPage } from "../recommendations/RecommendationPage";
import { CommunityTeamsPage } from "../community/CommunityTeamsPage";
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
    element: <ReleaseProvider><RecommendationPage /></ReleaseProvider>,
  },
  {
    path: "/community",
    element: <ReleaseProvider><CommunityTeamsPage /></ReleaseProvider>,
  },
  {
    path: "/profiles",
    element: <PlaceholderPage title="账号与版本" purpose="这里将按 UID 隔离管理本地账号档案、数据版本、导入导出与明确授权的公开流程。" />,
  },
];
