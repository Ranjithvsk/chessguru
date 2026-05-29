import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import PuzzlesPage from "./pages/Puzzles";
import ThemePage from "./pages/Theme";
import BlindfoldPage from "./pages/Blindfold";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/v2">
        <Routes>
          <Route element={<App />}>
            <Route index element={<PuzzlesPage />} />
            <Route path="puzzles" element={<PuzzlesPage />} />
            <Route path="theme" element={<ThemePage />} />
            <Route path="blindfold" element={<BlindfoldPage />} />
            {/* Next: opening, engine-battle, board-editor, admin */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
