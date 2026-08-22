import type { RouteObject } from "react-router-dom";
import { RecommendationPage } from "../recommendations/RecommendationPage";
import { ProfilePage } from "../profiles/ProfilePage";
import { CommunityTeamsPage } from "../community/CommunityTeamsPage";
import { CharacterBuilderPage } from "../simulator/CharacterBuilderPage";
import { TeamSimulatorPage } from "../simulator/TeamSimulatorPage";
import { EntityDetailPage } from "../wiki/EntityDetailPage";
import { WikiPage } from "../wiki/WikiPage";
import { ReleaseProvider } from "./ReleaseProvider";

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
    element: <ReleaseProvider><ProfilePage /></ReleaseProvider>,
  },
];
