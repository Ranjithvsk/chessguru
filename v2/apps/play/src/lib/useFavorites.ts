// Global favorites store — single Set + broadcast so every card re-renders
// when any card toggles. Avoids prop-drilling favorite state through the grid.
import { useEffect, useState, useSyncExternalStore } from "react";
import { listFavorites, toggleFavorite } from "./api";

let favSet = new Set<string>();
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

async function loadOnce() {
  if (loaded) return;
  loaded = true;
  try {
    const r = await listFavorites();
    favSet = new Set(r.rows.map((t: any) => t._id));
    emit();
  } catch { /* not signed in — leave empty */ }
}

export function useFavorites(): { favs: Set<string>; toggle: (id: string) => Promise<boolean> } {
  useEffect(() => { loadOnce(); }, []);
  useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => favSet,
    () => favSet,
  );
  const toggle = async (id: string): Promise<boolean> => {
    // Optimistic — flip locally, then confirm.
    const before = favSet.has(id);
    const next = new Set(favSet);
    if (before) next.delete(id); else next.add(id);
    favSet = next; emit();
    try {
      const r = await toggleFavorite(id);
      if (r?.error === "AuthRequired") {
        // Roll back + prompt sign-in.
        favSet = new Set([...favSet].filter((x) => x !== id));
        if (!before) favSet.add(id); // restore original
        emit();
        return false;
      }
      // Server truth wins in case of drift.
      const serverFav = r?.favorited ?? !before;
      const cur = new Set(favSet);
      if (serverFav) cur.add(id); else cur.delete(id);
      favSet = cur; emit();
      return true;
    } catch {
      // Network failure — revert.
      const cur = new Set(favSet);
      if (before) cur.add(id); else cur.delete(id);
      favSet = cur; emit();
      return false;
    }
  };
  return { favs: favSet, toggle };
}
