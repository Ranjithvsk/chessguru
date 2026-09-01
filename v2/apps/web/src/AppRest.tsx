// AppRest — one lazy chunk containing every non-initial route.
//
// Split out of main.tsx on 2026-08-30 so first paint on `/login` doesn't
// pay to parse ~60 chess-app pages a fresh visitor won't touch. The main
// bundle now contains only: App shell + Login/TenantLogin + SmartLoginRoute.
// Everything else lives here and is `import()`-ed lazily.
//
// main.tsx also fires a `requestIdleCallback(() => import("./AppRest"))`
// as soon as the initial render commits, so by the time a user finishes
// typing their password the "rest of the app" chunk is already downloaded
// (or nearly so) — the click on "Login" then feels instant, without
// the first-paint tax.
//
// Rule for adding a new route: if the route is reachable from a first-
// visit URL (like /login, /coach/foo), it goes in main.tsx. Everything
// else (post-auth pages, admin, tools) belongs here.

import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { lazy, Suspense } from "react";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Pages — full eager list mirrors old main.tsx. They all live in ONE
// chunk (this file's chunk); Rollup won't split further unless we add
// per-page React.lazy calls. That's intentional: post-first-paint, we
// prefetch this whole chunk once, and every subsequent navigation is
// zero-network. Per-route splitting is a future slice if this chunk
// grows past ~1 MB gzip.
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
import AttendanceDashboardPage from "./pages/AttendanceDashboard";
import CheckinPage from "./pages/Checkin";
import FaceEnrollPage from "./pages/FaceEnroll";
import ParentPortalPage from "./pages/ParentPortal";
import ZugzwangStudyPage from "./pages/ZugzwangStudy";
import AcceptInvitePage from "./pages/AcceptInvite";
import AccountLinksPage from "./pages/AccountLinks";
import ExternalGamePage from "./pages/ExternalGame";
import AdminPage from "./pages/Admin";
import AdminUsersPage from "./pages/AdminUsers";
import AdminMailLogPage from "./pages/AdminMailLog";
import AdminWhitelabelPage from "./pages/AdminWhitelabel";
import AdminDomainsPage from "./pages/AdminDomains";
import AcademyBrandingPage from "./pages/AcademyBranding";
import TenantHomePage from "./pages/TenantHome";
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
import CoachChessdbPage from "./pages/CoachChessdb";
import { StudentGameplayReviseListPage, StudentGameplayRevisePlayPage } from "./pages/StudentGameplayRevise";
import ParentReportsListPage from "./pages/ParentReportsList";
import ParentReportGeneratePage from "./pages/ParentReportGenerate";
import ParentReportViewPage from "./pages/ParentReportView";
import DailyPage from "./pages/Daily";
import PlayPage from "./pages/Play";
import FeedbackUITestPage from "./pages/FeedbackUITest";
import BookPage from "./pages/Book";
import ClassReplayPage from "./pages/ClassReplay";
import ClassV2Page from "./pages/ClassV2";
import NotebookPage, { NotebookPackDetailPage, NotebookReviseSessionPage } from "./pages/Notebook";
import RepertoirePage from "./pages/Repertoire";
import CoachProfileEditPage from "./pages/CoachEdit";
import AcademyProfileEditPage from "./pages/AcademyProfileEdit";

// Fees — kept lazy inside this already-lazy chunk so recharts (heavy)
// stays out of the shared code path even for post-auth users who never
// open /fees. Nested React.lazy is fine; each nested lazy makes its own
// deferred chunk that only downloads if that route mounts.
const FeesLandingPage       = lazy(() => import("./pages/Fees"));
const FeesProgramsPage      = lazy(() => import("./pages/FeesPrograms"));
const FeesProgramDetailPage = lazy(() => import("./pages/FeesProgramDetail"));
const FeesInvoicesPage      = lazy(() => import("./pages/FeesInvoices"));
const FeesSettingsPage      = lazy(() => import("./pages/FeesSettings"));
const FeesReportsPage       = lazy(() => import("./pages/FeesReports"));
const FeesBatchesPage       = lazy(() => import("./pages/FeesBatches"));
const MyChallengesPage       = lazy(() => import("./pages/MyChallenges"));

function LazyFallback() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="animate-spin h-8 w-8 rounded-full border-2 border-ink-800 border-t-brand-500" />
    </div>
  );
}

// Retired-route shims (kept for old push-notification joinPaths + bookmarks).
function ClassIdRedirect() {
  const { id } = useParams();
  return <Navigate to={`/class-v2/${encodeURIComponent(id ?? "")}`} replace />;
}
function CallRoomRedirect() {
  const { room } = useParams();
  return <Navigate to={`/class-v2/${encodeURIComponent(room ?? "")}`} replace />;
}

export default function AppRest() {
  return (
    <Routes>
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
        <Route path="repertoire" element={<ErrorBoundary label="Repertoire"><RepertoirePage /></ErrorBoundary>} />
        <Route path="engine-battle" element={<EngineBattlePage />} />
        <Route path="board-editor" element={<BoardEditorPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="admin/users" element={<AdminUsersPage />} />
        <Route path="admin/mail-log" element={<AdminMailLogPage />} />
        <Route path="admin/whitelabel" element={<AdminWhitelabelPage />} />
        <Route path="admin/domains" element={<AdminDomainsPage />} />
        <Route path="academy/branding" element={<AcademyBrandingPage />} />
        <Route path="a/:slug" element={<TenantHomePage />} />
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
        <Route path="coach-board/chessdb" element={<CoachChessdbPage />} />
        <Route path="revise/games" element={<StudentGameplayReviseListPage />} />
        <Route path="revise/games/:id" element={<StudentGameplayRevisePlayPage />} />
        <Route path="coach-board/plan/:tag" element={<CoachClassPlanPage />} />
        <Route path="coach-board/reports" element={<ParentReportsListPage />} />
        <Route path="coach-board/reports/new/:studentId" element={<ParentReportGeneratePage />} />
        <Route path="coach-board/reports/:id" element={<ParentReportViewPage />} />
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
        <Route path="fees"                element={<ErrorBoundary label="Fees"><Suspense fallback={<LazyFallback />}><FeesLandingPage /></Suspense></ErrorBoundary>} />
        <Route path="fees/programs"       element={<ErrorBoundary label="Fee programs"><Suspense fallback={<LazyFallback />}><FeesProgramsPage /></Suspense></ErrorBoundary>} />
        <Route path="fees/programs/:id"   element={<ErrorBoundary label="Fee program"><Suspense fallback={<LazyFallback />}><FeesProgramDetailPage /></Suspense></ErrorBoundary>} />
        <Route path="fees/invoices"       element={<ErrorBoundary label="Fee invoices"><Suspense fallback={<LazyFallback />}><FeesInvoicesPage /></Suspense></ErrorBoundary>} />
        <Route path="fees/settings"       element={<ErrorBoundary label="Fee settings"><Suspense fallback={<LazyFallback />}><FeesSettingsPage /></Suspense></ErrorBoundary>} />
        <Route path="fees/reports"        element={<ErrorBoundary label="Fee reports"><Suspense fallback={<LazyFallback />}><FeesReportsPage /></Suspense></ErrorBoundary>} />
        <Route path="fees/batches"        element={<ErrorBoundary label="Fee batches"><Suspense fallback={<LazyFallback />}><FeesBatchesPage /></Suspense></ErrorBoundary>} />
        <Route path="challenges"          element={<ErrorBoundary label="My challenges"><Suspense fallback={<LazyFallback />}><MyChallengesPage /></Suspense></ErrorBoundary>} />
        <Route path="students" element={<StudentsManagerPage />} />
        <Route path="academy/performance" element={<ErrorBoundary label="Student performance"><AcademyPerformancePage /></ErrorBoundary>} />
        <Route path="academy/leaderboard" element={<ErrorBoundary label="Academy leaderboard"><LeaderboardPage /></ErrorBoundary>} />
        <Route path="academy/attendance" element={<ErrorBoundary label="Academy attendance"><AttendancePage /></ErrorBoundary>} />
        <Route path="academy/attendance/dashboard" element={<ErrorBoundary label="Attendance dashboard"><AttendanceDashboardPage /></ErrorBoundary>} />
        <Route path="checkin/:token" element={<ErrorBoundary label="QR Check-in"><CheckinPage /></ErrorBoundary>} />
        <Route path="settings/face" element={<ErrorBoundary label="Face enrollment"><FaceEnrollPage /></ErrorBoundary>} />
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
        <Route path="notebook" element={<ErrorBoundary label="Notebook"><NotebookPage /></ErrorBoundary>} />
        <Route path="notebook/:packId" element={<ErrorBoundary label="Notebook pack"><NotebookPackDetailPage /></ErrorBoundary>} />
        <Route path="notebook/:packId/revise" element={<ErrorBoundary label="Revise pack"><NotebookReviseSessionPage /></ErrorBoundary>} />
        <Route path="coach-profile/edit" element={<CoachProfileEditPage />} />
        <Route path="academy-profile/edit" element={<AcademyProfileEditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
