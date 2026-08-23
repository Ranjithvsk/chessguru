import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import App from "./App";
import PuzzlesPage from "./pages/Puzzles";
import HistoryPage from "./pages/History";
import BroadcastsPage from "./pages/Broadcasts";
import BroadcastGamePage from "./pages/BroadcastGame";
import DashboardPage from "./pages/Dashboard";
import StudyPage from "./pages/Study";
import StudyTrainer from "./pages/StudyTrainer";
import CoordinateTrainer from "./pages/CoordinateTrainer";
import NotationTrainer from "./pages/NotationTrainer";
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
import OpeningNames from "./pages/OpeningNames";
import OpeningsHub from "./pages/OpeningsHub";
import BlindfoldPage from "./pages/Blindfold";
import OpeningPage from "./pages/Opening";
import EngineBattlePage from "./pages/EngineBattle";
import BoardEditorPage from "./pages/BoardEditor";
import LoginPage from "./pages/Login";
import ResetPasswordPage from "./pages/ResetPassword";
import SignupAcademyPage from "./pages/SignupAcademy";
import ArbiterPage from "./pages/Arbiter";
import { PublicResultsHome, PublicResultsDetail } from "./pages/PublicResults";
import PublicPlayer from "./pages/PublicPlayer";
import PublicFederation from "./pages/PublicFederation";
import AcademyDashboardPage from "./pages/AcademyDashboard";
import StudentsManagerPage from "./pages/StudentsManager";
import StudentPerformancePage from "./pages/StudentPerformance";
import BatchPerformancePage from "./pages/BatchPerformance";
import AcademyPerformancePage from "./pages/AcademyPerformance";
import LeaderboardPage from "./pages/Leaderboard";
import AttendancePage from "./pages/Attendance";
import ParentPortalPage from "./pages/ParentPortal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import ZugzwangStudyPage from "./pages/ZugzwangStudy";
import AcceptInvitePage from "./pages/AcceptInvite";
// CallRoomPage + ClassPage removed 2026-08-12 (Jitsi + WebRTC mesh retired).
// Every live class URL funnels through /class-v2/ (Dream Meet).
import AccountLinksPage from "./pages/AccountLinks";
import ExternalGamePage from "./pages/ExternalGame";
import AdminPage from "./pages/Admin";
import AdminUsersPage from "./pages/AdminUsers";
import AdminMailLogPage from "./pages/AdminMailLog";
import AdminWhitelabelPage from "./pages/AdminWhitelabel";
import AdminDomainsPage from "./pages/AdminDomains";
import AcademyBrandingPage from "./pages/AcademyBranding";
import TenantHomePage from "./pages/TenantHome";
import TenantLoginPage from "./pages/TenantLogin";
import StudiesListPage from "./pages/StudiesList";
import StudyCreatePage from "./pages/StudyCreate";
import StudyViewPage from "./pages/StudyView";
import StudyChapterEditPage from "./pages/StudyChapterEdit";
import BooksListPage from "./pages/BooksList";
import BookDetailPage from "./pages/BookDetail";
import BookCreatePage from "./pages/BookCreate";
import RevisePage from "./pages/Revise";
import ExamsListPage from "./pages/ExamsList";
import ExamCreatePage from "./pages/ExamCreate";
import ExamEditPage from "./pages/ExamEdit";
import ExamTakePage from "./pages/ExamTake";
import ExamResultsPage from "./pages/ExamResults";
import MyGamesListPage from "./pages/MyGamesList";
import MyGamesImportPage from "./pages/MyGamesImport";
import MyGameViewPage from "./pages/MyGameView";
import MyInsightsPage, { StudentInsightsPage } from "./pages/MyInsights";
import CoachBoardPage from "./pages/CoachBoard";
import CoachClassPlanPage from "./pages/CoachClassPlan";
import ParentReportsListPage from "./pages/ParentReportsList";
import ParentReportGeneratePage from "./pages/ParentReportGenerate";
import ParentReportViewPage from "./pages/ParentReportView";

// Dispatch /login → tenant-branded login on custom domains (gunachess.com),
// canonical ChessGuru login on harinitharanjith.com / localhost / bare IP.
// Every "Sign in" link + auth-gate redirect (<Navigate to="/login">) flows
// through here — one place, everyone stays on-brand.
function SmartLoginRoute() {
  if (typeof window === "undefined") return <LoginPage />;
  const h = window.location.hostname.toLowerCase();
  // chessguru.cc + chessguru.com + harinitharanjith.com are the platform (canonical)
  // hosts. Any other domain (gunachess.com, coach vanity, tenant subdomain) hits
  // the tenant-branded login. Adding chessguru.cc here after 2026-08-21 domain
  // flip; without it, chessguru.cc landed on TenantLogin and errored
  // "Academy 'chessguru' not found".
  const isCanonical =
    /(^|\.)harinitharanjith\.com$/.test(h) ||
    /(^|\.)chessguru\.cc$/.test(h) ||
    /(^|\.)chessguru\.com$/.test(h) ||
    h === "localhost" || h === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(h);
  return isCanonical ? <LoginPage /> : <TenantLoginPage />;
}
import DailyPage from "./pages/Daily";
import PlayPage from "./pages/Play";
import FeedbackUITestPage from "./pages/FeedbackUITest";
import BookPage from "./pages/Book";
import ClassReplayPage from "./pages/ClassReplay";
import ClassV2Page from "./pages/ClassV2";
import CoachPublicPage from "./pages/CoachPublic";
import CoachProfileEditPage from "./pages/CoachEdit";
import AcademyPublicPage from "./pages/AcademyPublic";
import AcademyProfileEditPage from "./pages/AcademyProfileEdit";
// Jitsi is retired (owner 2026-08-12) — every live-class URL now funnels into
// Dream Meet (/class-v2/). These tiny redirect shims preserve old bookmarks +
// server-generated push-notification joinPaths without keeping the Jitsi UI
// or the old from-scratch mesh call code on the router. Uses replace so the
// browser history doesn't stack a dead route entry.
function ClassIdRedirect() {
  const { id } = useParams();
  return <Navigate to={`/class-v2/${encodeURIComponent(id ?? "")}`} replace />;
}
function CallRoomRedirect() {
  const { room } = useParams();
  return <Navigate to={`/class-v2/${encodeURIComponent(room ?? "")}`} replace />;
}
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/+$/, "")}>
        <Routes>
          {/* Public coach page — rendered standalone (no App chrome/nav) so it
              reads like a landing page, chessiverse-style. Must be BEFORE the
              App-wrapped block so it matches first. */}
          <Route path="coach/:username" element={<CoachPublicPage />} />
          {/* Public academy landing — also standalone (no App chrome) so it reads
              like a chessiverse-style creator page, matching CoachPublic. */}
          <Route path="academy-page/:slug" element={<AcademyPublicPage />} />
          <Route element={<App />}>
            <Route index element={<PuzzlesPage />} />
            <Route path="play" element={<PlayPage />} />
            <Route path="puzzles" element={<PuzzlesPage />} />
            <Route path="blindfold" element={<BlindfoldPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="broadcasts" element={<BroadcastsPage />} />
            <Route path="broadcasts/:id" element={<BroadcastGamePage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="study" element={<StudyPage />} />
            <Route path="study/coordinates" element={<CoordinateTrainer />} />
            <Route path="study/notation" element={<NotationTrainer />} />
            <Route path="study/endgame" element={<EndgameTrainer />} />
            <Route path="study/key-squares" element={<KeySquaresTrainer />} />
            <Route path="study/promote" element={<PromoteLesson />} />
            <Route path="study/opposition" element={<OppositionTrainer />} />
            <Route path="study/memory-palace" element={<MemoryPalace />} />
            <Route path="study/zugzwang" element={<ZugzwangStudyPage />} />
            <Route path="study/opening-memory" element={<OpeningMemory />} />
            <Route path="study/openings" element={<Openings />} />
            <Route path="study/openings/:slug" element={<OpeningDetail />} />
            <Route path="study/repertoire" element={<RepertoireWizard />} />
            <Route path="study/daily" element={<DailyStudy />} />
            <Route path="study/progress" element={<ProgressPage />} />
            <Route path="study/import-game" element={<ImportGame />} />
            <Route path="study/prep-test" element={<PrepTest />} />
            <Route path="study/tree" element={<OpeningTree />} />
            <Route path="study/openings-by-name" element={<OpeningNames />} />
            <Route path="study/:id" element={<StudyTrainer />} />
            <Route path="opening" element={<OpeningPage />} />
            <Route path="openings" element={<OpeningsHub />} />
            <Route path="engine-battle" element={<EngineBattlePage />} />
            <Route path="board-editor" element={<BoardEditorPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="admin/users" element={<AdminUsersPage />} />
            <Route path="admin/mail-log" element={<AdminMailLogPage />} />
            <Route path="admin/whitelabel" element={<AdminWhitelabelPage />} />
            <Route path="admin/domains" element={<AdminDomainsPage />} />
            <Route path="academy/branding" element={<AcademyBrandingPage />} />
            <Route path="a/:slug" element={<TenantHomePage />} />
            <Route path="a/:slug/login" element={<TenantLoginPage />} />
            <Route path="daily" element={<DailyPage />} />
            <Route path="studies" element={<StudiesListPage />} />
            <Route path="studies/new" element={<StudyCreatePage />} />
            <Route path="studies/:sid" element={<StudyViewPage />} />
            <Route path="studies/:sid/edit/:cid" element={<StudyChapterEditPage />} />
            <Route path="books" element={<BooksListPage />} />
            <Route path="books/new" element={<BookCreatePage />} />
            <Route path="books/:id" element={<BookDetailPage />} />
            <Route path="revise" element={<RevisePage />} />
            <Route path="exams" element={<ExamsListPage />} />
            <Route path="exams/new" element={<ExamCreatePage />} />
            <Route path="exams/:id/edit" element={<ExamEditPage />} />
            <Route path="exams/:id/take" element={<ExamTakePage />} />
            <Route path="exams/:id/results" element={<ExamResultsPage />} />
            <Route path="my-games" element={<MyGamesListPage />} />
            <Route path="my-games/import" element={<MyGamesImportPage />} />
            <Route path="my-games/:id" element={<MyGameViewPage />} />
            <Route path="my-insights" element={<MyInsightsPage />} />
            <Route path="insights/students/:userId" element={<StudentInsightsPage />} />
            <Route path="coach-board" element={<CoachBoardPage />} />
            <Route path="coach-board/plan/:tag" element={<CoachClassPlanPage />} />
            <Route path="coach-board/reports" element={<ParentReportsListPage />} />
            <Route path="coach-board/reports/new/:studentId" element={<ParentReportGeneratePage />} />
            <Route path="coach-board/reports/:id" element={<ParentReportViewPage />} />
            <Route path="login" element={<SmartLoginRoute />} />
            <Route path="reset-password" element={<ResetPasswordPage />} />
            <Route path="signup-academy" element={<SignupAcademyPage />} />
            <Route path="arbiter" element={<ArbiterPage />} />
            <Route path="arbiter/:id" element={<ArbiterPage />} />
            <Route path="results" element={<PublicResultsHome />} />
            <Route path="results/:id" element={<PublicResultsDetail />} />
            <Route path="t/:id" element={<PublicResultsDetail />} />
            <Route path="player/:fide_id" element={<PublicPlayer />} />
            <Route path="federation/:code" element={<PublicFederation />} />
            <Route path="academy" element={<AcademyDashboardPage />} />
            <Route path="students" element={<StudentsManagerPage />} />
            <Route path="academy/performance" element={<ErrorBoundary label="Student performance"><AcademyPerformancePage /></ErrorBoundary>} />
            <Route path="academy/leaderboard" element={<ErrorBoundary label="Academy leaderboard"><LeaderboardPage /></ErrorBoundary>} />
            <Route path="academy/attendance" element={<ErrorBoundary label="Academy attendance"><AttendancePage /></ErrorBoundary>} />
            <Route path="parent" element={<ErrorBoundary label="Parent portal"><ParentPortalPage /></ErrorBoundary>} />
            <Route path="academy/students/:studentId/performance" element={<ErrorBoundary label="Student performance"><StudentPerformancePage /></ErrorBoundary>} />
            <Route path="academy/batches/:batchId/performance" element={<ErrorBoundary label="Batch performance"><BatchPerformancePage /></ErrorBoundary>} />
            <Route path="accept-invite" element={<AcceptInvitePage />} />
            <Route path="call/:room" element={<CallRoomRedirect />} />
            <Route path="settings/accounts" element={<AccountLinksPage />} />
            <Route path="history/external/:id" element={<ExternalGamePage />} />
            <Route path="test/feedback-ui" element={<FeedbackUITestPage />} />
            <Route path="book" element={<BookPage />} />
            <Route path="class" element={<Navigate to="/dashboard" replace />} />
            <Route path="class/:id" element={<ClassIdRedirect />} />
            <Route path="class/:id/replay/:filename" element={<ClassReplayPage />} />
            <Route path="class-v2/:room" element={<ClassV2Page />} />
            <Route path="coach-profile/edit" element={<CoachProfileEditPage />} />
            <Route path="academy-profile/edit" element={<AcademyProfileEditPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        // Nudge SW to check for updates on load, but do NOT auto-reload —
        // that killed user sessions mid-upload (state lost, "no update"
        // reported). Users get the new bundle on their next natural
        // navigation instead.
        reg.update().catch(() => {});
      })
      .catch(() => {});
  });
}
