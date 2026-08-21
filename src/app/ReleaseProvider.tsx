import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { loadRelease, loadReleaseIndex } from "../data/releaseRepository";
import type { GameReleaseBundle, ReleaseIndex } from "../domain/releases";

export type ReleaseContextValue = {
  bundle: GameReleaseBundle | null;
  index: ReleaseIndex | null;
  loading: boolean;
  error: string | null;
};
const ReleaseContext = createContext<ReleaseContextValue | null>(null);

type ReleaseProviderProps = PropsWithChildren<{ bundle?: GameReleaseBundle; index?: ReleaseIndex }>;

export function ReleaseProvider({ bundle: explicitBundle, index: explicitIndex, children }: ReleaseProviderProps) {
  const explicitState = explicitBundle ? {
    bundle: explicitBundle,
    index: explicitIndex ?? { currentReleaseId: null, releases: [explicitBundle.release] },
    loading: false,
    error: null,
  } : null;
  const [state, setState] = useState<ReleaseContextValue>(explicitState ?? {
    bundle: null, index: null, loading: true, error: null,
  });
  useEffect(() => {
    if (explicitState) {
      setState(explicitState);
      return;
    }
    let active = true;
    void loadReleaseIndex().then(async (index) => {
      const bundle = index.currentReleaseId === null ? null : await loadRelease(index.currentReleaseId);
      if (active) setState({ bundle, index, loading: false, error: null });
    }).catch((error: unknown) => {
      if (active) setState({ bundle: null, index: null, loading: false, error: error instanceof Error ? error.message : "版本资料加载失败" });
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
