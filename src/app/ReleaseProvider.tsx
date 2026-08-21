import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { loadRelease, loadReleaseIndex } from "../data/releaseRepository";
import type { GameReleaseBundle, ReleaseIndex } from "../domain/releases";

type ReleaseContextValue = { bundle: GameReleaseBundle | null; index: ReleaseIndex | null; loading: boolean; error: string | null };
const ReleaseContext = createContext<ReleaseContextValue | null>(null);

export function ReleaseProvider({ bundle: explicitBundle, children }: PropsWithChildren<{ bundle?: GameReleaseBundle }>) {
  const [state, setState] = useState<ReleaseContextValue>({
    bundle: explicitBundle ?? null,
    index: explicitBundle ? { currentReleaseId: null, releases: [explicitBundle.release] } : null,
    loading: explicitBundle === undefined,
    error: null,
  });
  useEffect(() => {
    if (explicitBundle) {
      setState({ bundle: explicitBundle, index: { currentReleaseId: null, releases: [explicitBundle.release] }, loading: false, error: null });
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
  }, [explicitBundle]);
  return <ReleaseContext.Provider value={state}>{children}</ReleaseContext.Provider>;
}

export function useRelease(): ReleaseContextValue {
  const value = useContext(ReleaseContext);
  if (!value) throw new Error("useRelease must be used inside ReleaseProvider");
  return value;
}
