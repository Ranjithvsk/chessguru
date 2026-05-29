import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import PuzzlesPage from "./pages/Puzzles";
import ThemePage from "./pages/Theme";
import BlindfoldPage from "./pages/Blindfold";
import OpeningPage from "./pages/Opening";
import EngineBattlePage from "./pages/EngineBattle";
import BoardEditorPage from "./pages/BoardEditor";
import LoginPage from "./pages/Login";
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
            <Route path="opening" element={<OpeningPage />} />
            <Route path="engine-battle" element={<EngineBattlePage />} />
            <Route path="board-editor" element={<BoardEditorPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
