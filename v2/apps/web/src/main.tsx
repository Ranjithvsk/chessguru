import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import PuzzlesPage from "./pages/Puzzles";
import HistoryPage from "./pages/History";
import DashboardPage from "./pages/Dashboard";
import StudyPage from "./pages/Study";
import StudyTrainer from "./pages/StudyTrainer";
import CoordinateTrainer from "./pages/CoordinateTrainer";
import EndgameTrainer from "./pages/EndgameTrainer";
import KeySquaresTrainer from "./pages/KeySquaresTrainer";
import PromoteLesson from "./pages/PromoteLesson";
import OppositionTrainer from "./pages/OppositionTrainer";
import MemoryPalace from "./pages/MemoryPalace";
import OpeningMemory from "./pages/OpeningMemory";
import Openings from "./pages/Openings";
import OpeningDetail from "./pages/OpeningDetail";
import RepertoireWizard from "./pages/RepertoireWizard";
import DailyStudy from "./pages/DailyStudy";
import ProgressPage from "./pages/Progress";
import ImportGame from "./pages/ImportGame";
import PrepTest from "./pages/PrepTest";
import OpeningTree from "./pages/OpeningTree";
import BlindfoldPage from "./pages/Blindfold";
import OpeningPage from "./pages/Opening";
import EngineBattlePage from "./pages/EngineBattle";
import BoardEditorPage from "./pages/BoardEditor";
import LoginPage from "./pages/Login";
import AdminPage from "./pages/Admin";
import AdminUsersPage from "./pages/AdminUsers";
import PlayPage from "./pages/Play";
import FeedbackUITestPage from "./pages/FeedbackUITest";
import BookPage from "./pages/Book";
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
            <Route path="history" element={<HistoryPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="study" element={<StudyPage />} />
            <Route path="study/coordinates" element={<CoordinateTrainer />} />
            <Route path="study/endgame" element={<EndgameTrainer />} />
            <Route path="study/key-squares" element={<KeySquaresTrainer />} />
            <Route path="study/promote" element={<PromoteLesson />} />
            <Route path="study/opposition" element={<OppositionTrainer />} />
            <Route path="study/memory-palace" element={<MemoryPalace />} />
            <Route path="study/opening-memory" element={<OpeningMemory />} />
            <Route path="study/openings" element={<Openings />} />
            <Route path="study/openings/:slug" element={<OpeningDetail />} />
            <Route path="study/repertoire" element={<RepertoireWizard />} />
            <Route path="study/daily" element={<DailyStudy />} />
            <Route path="study/progress" element={<ProgressPage />} />
            <Route path="study/import-game" element={<ImportGame />} />
            <Route path="study/prep-test" element={<PrepTest />} />
            <Route path="study/tree" element={<OpeningTree />} />
            <Route path="study/:id" element={<StudyTrainer />} />
            <Route path="opening" element={<OpeningPage />} />
            <Route path="engine-battle" element={<EngineBattlePage />} />
            <Route path="board-editor" element={<BoardEditorPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="admin/users" element={<AdminUsersPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="test/feedback-ui" element={<FeedbackUITestPage />} />
            <Route path="book" element={<BookPage />} />
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
