import { Outlet } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Navbar from "./components/Navbar";
import { api } from "./lib/api";

export default function App() {
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const { data: rating } = useQuery({ queryKey: ["me-rating"], queryFn: api.myRating });

  const logout = async () => { await api.logout(); await qc.invalidateQueries(); };
  const userId = auth?.loggedIn ? auth.userId ?? null : rating?.userId ?? null;

  return (
    <div className="min-h-screen">
      <Navbar
        rating={rating?.rating}
        username={auth?.loggedIn ? auth.username : undefined}
        onLogout={logout}
      />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet context={{ userId, rating: rating?.rating ?? 1500 }} />
      </main>
    </div>
  );
}
