// Tiny "am I signed in?" hook used by favorites + player-profile flows.
import { useEffect, useState } from "react";
import { me as apiMe } from "./api";

export interface Me { loggedIn: boolean; userId?: string; username?: string }
export function useMe(): Me | null {
  const [m, setM] = useState<Me | null>(null);
  useEffect(() => { apiMe().then(setM).catch(() => setM({ loggedIn: false })); }, []);
  return m;
}
