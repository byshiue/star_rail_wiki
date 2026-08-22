const STORAGE_KEY = "star-rail-wiki:selected-profile-uid";
export const PROFILE_SELECTION_EVENT = "star-rail-wiki:profile-selection";

export function readSelectedProfileUid(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function selectProfileUid(uid: string | null): void {
  try {
    if (uid === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, uid);
  } catch { /* Selection remains available for this page through the event. */ }
  window.dispatchEvent(new CustomEvent(PROFILE_SELECTION_EVENT, { detail: uid }));
}
