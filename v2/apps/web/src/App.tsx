import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "./components/Navbar";
import { api } from "./lib/api";

export default function App() {
  const { data: rating } = useQuery({
    queryKey: ["me-rating"],
    queryFn: api.myRating,
  });

  return (
    <div className="min-h-screen">
      <Navbar rating={rating?.rating} />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet context={{ userId: rating?.userId ?? null, rating: rating?.rating ?? 1500 }} />
      </main>
    </div>
  );
}
