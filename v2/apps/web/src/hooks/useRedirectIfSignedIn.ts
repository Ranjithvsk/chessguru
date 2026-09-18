import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/**
 * Send an already-signed-in visitor past the login form.
 *
 * Reaching /login or /a/<slug>/login with a live session showed a sign-in form
 * to someone who was already signed in — the academy page's own button now
 * routes around that page, but a bookmark or a typed URL still lands on it.
 *
 * Two deliberate details:
 *
 *  - `refetchOnMount: "always"` — never trust a cached "logged in" HERE. Sign-out
 *    invalidates the auth query but does not navigate, so a stale cache read on
 *    this page is exactly what would bounce someone who just signed out straight
 *    back into the app.
 *
 *  - `?switch=1` skips the redirect, so a coach on a shared academy PC can still
 *    reach the form to sign in as someone else. Without it, being signed in
 *    would make the login page unreachable.
 */
export function useRedirectIfSignedIn() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const wantsSwitch = new URLSearchParams(search).get("switch") === "1";

  const { data } = useQuery({
    queryKey: ["auth-me"],
    queryFn: api.me,
    staleTime: 0,
    refetchOnMount: "always",
    enabled: !wantsSwitch,
  });

  useEffect(() => {
    if (wantsSwitch || !data?.loggedIn) return;
    const staff = data.role === "academy_owner" || data.role === "coach";
    navigate(staff ? "/academy" : "/puzzles", { replace: true });
  }, [data, wantsSwitch, navigate]);
}
