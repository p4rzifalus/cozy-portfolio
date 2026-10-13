import { useSyncExternalStore } from "react";

// Shared state of the site: what is under the cursor and what is open. Read in the 3D scene (useFrame -> store.get())
// and in the HTML overlay (useStore hook).
export type Mode =
  | { kind: "room" }
  | { kind: "project"; id: string }
  | { kind: "contacts" }
  | { kind: "meditation" };

export interface State {
  hovered: string | null;   // hotspot id (see HOTSPOTS in content.ts)
  mode: Mode;
  music: boolean;
}

let state: State = { hovered: null, mode: { kind: "room" }, music: false };
const subs = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<State>) {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(state));
}

export const closeAll = () => store.set({ mode: { kind: "room" } });

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__store = store;
