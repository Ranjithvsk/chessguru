import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import Landing from "./pages/Landing";
import TournamentDetail from "./pages/TournamentDetail";
import Submit from "./pages/Submit";
import Admin from "./pages/Admin";
import Favorites from "./pages/Favorites";
import Players from "./pages/Players";
import CalendarPage from "./pages/Calendar";
import Outreach from "./pages/Outreach";
import Connect from "./pages/Connect";
import InstallPrompt from "./components/InstallPrompt";
// Map page pulls in maplibre-gl (~700 KB) — lazy-load so the landing bundle stays small.
const MapPage = lazy(() => import("./pages/Map"));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/t" element={<TournamentDetail />} />
        <Route path="/submit-tournament" element={<Submit />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/me/favorites" element={<Favorites />} />
        <Route path="/me/players" element={<Players />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/map" element={<Suspense fallback={<div className="min-h-screen flex items-center justify-center opacity-60">Loading map…</div>}><MapPage /></Suspense>} />
        <Route path="/admin/outreach" element={<Outreach />} />
        <Route path="/connect" element={<Connect />} />
      </Routes>
      <InstallPrompt />
    </BrowserRouter>
  </React.StrictMode>
);
