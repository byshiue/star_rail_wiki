import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { loadRelease, loadReleaseIndex } from "../data/releaseRepository";
import type { GameReleaseBundle, ReleaseIndex } from "../domain/releases";

export type ReleaseContextValue = {
  bundle: GameReleaseBundle | null;
  historyBundles: GameReleaseBundle[];
  index: ReleaseIndex | null;
  loading: boolean;
  error: string | null;
};
const ReleaseContext = createContext<ReleaseContextValue | null>(null);

type ReleaseProviderProps = PropsWithChildren<{ bundle?: GameReleaseBundle; index?: ReleaseIndex }>;

export function ReleaseProvider({ bundle: explicitBundle, index: explicitIndex, children }: ReleaseProviderProps) {
  const hasExplicitState = explicitBundle !== undefined || explicitIndex !== undefined;
  const explicitState: ReleaseContextValue | null = hasExplicitState ? {
    bundle: explicitBundle ?? null,
    historyBundles: explicitBundle ? [explicitBundle] : [],
    index: explicitIndex ?? (explicitBundle ? { currentReleaseId: null, releases: [explicitBundle.release] } : null),
    loading: false,
    error: null,
  } : null;
  const [state, setState] = useState<ReleaseContextValue>(explicitState ?? {
    bundle: null, historyBundles: [], index: null, loading: true, error: null,
  });
  useEffect(() => {
    if (explicitState) {
      setState(explicitState);
      return;
    }
    let active = true;
    void loadReleaseIndex().then(async (index) => {
      const bundle = index.currentReleaseId === null ? null : await loadRelease(index.currentReleaseId);
      const historyBundles = bundle ? [bundle] : [];
      const seen = new Set(historyBundles.map(({ release }) => release.id));
      let previousReleaseId = bundle?.release.previousReleaseId ?? null;
      while (previousReleaseId !== null && !seen.has(previousReleaseId)) {
        const historical = await loadRelease(previousReleaseId);
        historyBundles.unshift(historical);
        seen.add(previousReleaseId);
        previousReleaseId = historical.release.previousReleaseId;
      }
      if (active) setState({ bundle, historyBundles, index, loading: false, error: null });
    }).catch((error: unknown) => {
      if (active) setState({
        bundle: null, historyBundles: [], index: null, loading: false,
        error: error instanceof Error ? error.message : "版本资料加载失败",
      });
    });
    return () => { active = false; };
  }, [explicitBundle, explicitIndex]);
  return <ReleaseContext.Provider value={state}>{children}</ReleaseContext.Provider>;
}

export function useRelease(): ReleaseContextValue {
  const value = useContext(ReleaseContext);
  if (!value) throw new Error("useRelease must be used inside ReleaseProvider");
  return value;
}
