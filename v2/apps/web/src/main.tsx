import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import PuzzlesPage from "./pages/Puzzles";
import BlindfoldPage from "./pages/Blindfold";
import OpeningPage from "./pages/Opening";
import EngineBattlePage from "./pages/EngineBattle";
import BoardEditorPage from "./pages/BoardEditor";
import LoginPage from "./pages/Login";
import AdminPage from "./pages/Admin";
import PlayPage from "./pages/Play";
import FeedbackUITestPage from "./pages/FeedbackUITest";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/+$/, "")}>
        <Routes>
          <Route element={<App />}>
            <Route index element={<PuzzlesPage />} />
            <Route path="play" element={<PlayPage />} />
            <Route path="puzzles" element={<PuzzlesPage />} />
            <Route path="blindfold" element={<BlindfoldPage />} />
            <Route path="opening" element={<OpeningPage />} />
            <Route path="engine-battle" element={<EngineBattlePage />} />
            <Route path="board-editor" element={<BoardEditorPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="test/feedback-ui" element={<FeedbackUITestPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
  });
}
