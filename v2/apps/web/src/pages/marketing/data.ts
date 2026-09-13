// Marketing copy shared across the academy pages. Keep prices in ONE place:
// ₹1,000/month flat, unlimited students + coaches (owner 2026-09-13), yearly
// ₹10,000 (2 months free), 30-day free trial, no card.

export const PRICE_MONTHLY = 1000;
export const PRICE_YEARLY = 10000;
export const TRIAL_DAYS = 30;
export const TRIAL_HREF = "/signup-academy#signup";

export const WHATSAPP_NUMBER = "918248353593";
export const WHATSAPP_DISPLAY = "+91 82483 53593";
export const WHATSAPP_URL = (text: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

export const FAQ = [
  { q: "Is my card required for the free trial?",
    a: `No. You get ${TRIAL_DAYS} days completely free — no card, no risk. After that it's ₹${PRICE_MONTHLY.toLocaleString("en-IN")}/month, with every feature, unlimited students and unlimited coaches.` },
  { q: "How many students and coaches can I add?",
    a: `Unlimited, both. ₹${PRICE_MONTHLY.toLocaleString("en-IN")}/month covers every student and every coach you add, at every branch. Pay for a year (₹${PRICE_YEARLY.toLocaleString("en-IN")}) and get 2 months free. Questions? WhatsApp ${WHATSAPP_DISPLAY}.` },
  { q: "Can we run live classes on ChessGuru?",
    a: "Yes — Dream Meet video is built in, no separate meeting link. The shared chess board syncs live to every student's screen, with arrows, snap-position and recording." },
  { q: "Does ChessGuru handle fees?",
    a: "Yes. Set a monthly fee per batch or student, track paid / due / waived across the roster, and collect over UPI. Parents get reminders; you get a dues list." },
  { q: "Can parents see progress?",
    a: "Yes. Coaches generate branded parent reports — rating curve, puzzles solved, attendance, coach notes — and share them as a link or PDF." },
  { q: "Does it work for an offline (in-person) academy?",
    a: "Yes. Most of our academies teach in a room. Attendance, homework, fees and reports work whether the class is on a real board or on Dream Meet; the scoresheet scanner turns paper games into PGN." },
  { q: "Where is the data stored?",
    a: "On our own servers in France + India — never sold, never used to train AI. Full export is one click away, anytime." },
  { q: "How quickly can we get started?",
    a: "Two minutes. Sign up, invite your coaches by email, paste student names — the first live class can happen today. Migration help over WhatsApp is free." },
  { q: "What happens after the trial? Can I cancel?",
    a: "You stay on your data. You get an email a week before the trial ends. Add a payment method or pause — no auto-charge without your consent. Cancel any time, one click, export before you go." },
];

export type AudienceKey = "academies" | "coaches" | "schools";
export const AUDIENCES: Record<AudienceKey, {
  key: AudienceKey; nav: string; eyebrow: string; h1: [string, string, string]; sub: string; img: string;
  jobs: Array<{ t: string; d: string }>; big: Array<{ t: string; d: string }>; quote: { text: string; who: string; meta: string };
  cta: [string, string];
}> = {
  academies: {
    key: "academies", nav: "Chess academies", eyebrow: "Built for chess academies",
    h1: ["The operating system for", "serious", "chess academies"],
    sub: "From a single room to several branches, ChessGuru replaces the spreadsheet, the WhatsApp groups and the Zoom link with one platform — so coaches teach, parents stay, and you finally see the whole academy on one screen.",
    img: "/marketing/persona-owner.webp",
    jobs: [
      { t: "Multi-coach scheduling", d: "Every coach's classes, every batch, one calendar. Weekly recurring classes, one-off sessions, reminders 24h / 1h / 15 min before." },
      { t: "Onboard 50 students in a click", d: "Paste names, send invite links, or let students self-sign-up with your academy code. Parents get their login the same minute." },
      { t: "Fees on autopilot", d: "Monthly fee per batch or student, UPI collection, paid / due / waived at a glance, and reminders that go out without you." },
      { t: "Reports parents brag about", d: "Branded monthly progress reports with rating curves, puzzle stats, attendance and coach notes. Shared as a link or PDF." },
      { t: "Role-based access", d: "Owner, coach, student, parent — everyone sees exactly what they should. Coaches see their batches, you see everything." },
      { t: "Your brand, your domain", d: "Academy logo, colours and login page on your own domain. Students and parents see your academy, not ours." },
    ],
    big: [
      { t: "Built for multi-batch, multi-branch operations", d: "Compare batches side by side: attendance trends, dues per batch, top-performing students, coach load. The first time you'll see the whole academy in one screen." },
      { t: "Built for the chess business", d: "Tournament arbiter with Swiss pairings and public results, scoresheet scanning that turns paper games into PGN, engine analysis of every student game. The workflows a chess academy actually has." },
      { t: "Priced like an Indian academy, not a Silicon Valley SaaS", d: "₹1,000 a month, flat. Unlimited students, unlimited coaches, every feature. No per-student fees, no add-ons, no surprises when you grow." },
    ],
    quote: { text: "We moved from three apps and two WhatsApp groups to one login. The trial gave us time to migrate at our own pace.", who: "Early ChessGuru academy", meta: "Owner · Tamil Nadu · quote to be attributed with permission" },
    cta: ["Ready to run a", "real academy?"],
  },
  coaches: {
    key: "coaches", nav: "Chess coaches", eyebrow: "Built for chess coaches",
    h1: ["Spend your evenings", "coaching,", "not doing admin"],
    sub: "Solo coach with private students? ChessGuru gives you the live board, the homework engine, the fee tracker and the parent report — the tools an academy has, at a price one coach can pay.",
    img: "/marketing/persona-coach.webp",
    jobs: [
      { t: "Live classes on your own board", d: "Dream Meet video is built in. Share a board, draw arrows, freeze a position with Snap-position, record the class for replay." },
      { t: "Homework that grades itself", d: "Assign puzzles by theme and difficulty the moment class ends. Students get them on their phone; you see who solved what." },
      { t: "A position from any book, in one photo", d: "Point your phone at a printed diagram — it opens on your board. Scan a student's handwritten scoresheet and get the PGN." },
      { t: "Your students' games, analysed", d: "Import games, get engine analysis move by move, and turn a student's own blunder into their next homework." },
      { t: "Fees without awkward reminders", d: "Set a monthly fee, collect over UPI, and let ChessGuru send the reminder so you don't have to." },
      { t: "Your public coach page", d: "A shareable page with your bio, batches and a join button. Parents find you, students self-enrol." },
    ],
    big: [
      { t: "One login for you, one for each student", d: "No juggling Zoom + Lichess + Google Sheets + WhatsApp. Class, homework, ratings and fees live in one place your students already open daily for the puzzle streak." },
      { t: "Students who actually practise", d: "Daily puzzle, streaks, blindfold rating, milestones with confetti. The gamification is built for kids, so practice between classes happens without nagging." },
      { t: "Grow into an academy when you're ready", d: "Add a second coach, then a branch — same account, same ₹1,000/month. ChessGuru grows with you without changing the price." },
    ],
    quote: { text: "My students actually want to open the daily puzzle now. That never happened with our old tool.", who: "Early ChessGuru coach", meta: "Head coach · quote to be attributed with permission" },
    cta: ["Ready to coach", "without the admin?"],
  },
  schools: {
    key: "schools", nav: "Schools & clubs", eyebrow: "Built for schools & clubs",
    h1: ["Chess for every", "classroom,", "without the chaos"],
    sub: "After-school clubs, school chess programmes and community clubs: easy enrolment, batch-wise classes, parent updates and in-house tournaments with public results, all under the school's own name.",
    img: "/marketing/persona-student.webp",
    jobs: [
      { t: "Enrol a whole class in minutes", d: "Paste a list of names, get a login for every child. Group them into batches by grade or level." },
      { t: "Coaches and PE teachers on one roster", d: "External coaches and school staff share one calendar and one attendance sheet." },
      { t: "Parent updates that write themselves", d: "Monthly progress reports and attendance, branded with the school's logo, shared as a link." },
      { t: "Inter-house and inter-school tournaments", d: "Swiss pairings, live standings and a public results page you can link from the school website." },
      { t: "Safe by design", d: "No open chat with strangers, no ads. Students only see their coach, their batch and their puzzles." },
      { t: "Works on the school's devices", d: "Runs in the browser on any laptop, tablet or phone. Nothing to install; the PWA works offline for puzzles." },
    ],
    big: [
      { t: "One programme, many schools", d: "Run a chess programme across several schools from one account: each school is a batch group with its own coaches, reports and results." },
      { t: "Curriculum built in", d: "Coordinate trainer, opening trainer, endgame manual, memory palace — a beginner-to-club curriculum your coaches can assign week by week." },
      { t: "Budget-friendly for institutions", d: "₹1,000 a month for the whole programme, unlimited students. Pay yearly at ₹10,000 and get two months free." },
    ],
    quote: { text: "Setting up the roster took an evening. Attendance, homework, the live board — everything just worked.", who: "Early ChessGuru programme", meta: "Director · quote to be attributed with permission" },
    cta: ["Ready to bring chess to", "every classroom?"],
  },
};

// Why page: problem → fix
export const PROBLEMS = [
  { p: "System chaos", pd: "Juggling 6+ tools means nothing talks to each other. Coaches double-enter attendance, parents get inconsistent updates, and progress slips through the cracks.",
    f: "One unified platform", fd: "Classes, attendance, homework, ratings, fees — every record lives in one place. No more swivel-chair admin between five tabs." },
  { p: "Revenue leakage", pd: "Trial students never get followed up. Fees slip past the due date. It's not the kids, it's the cracks in the system.",
    f: "Fees on autopilot", fd: "Monthly fees per batch, UPI collection, automatic reminders and a live dues list. Recover the revenue you didn't know you were losing." },
  { p: "Coach overload", pd: "Your best coaches are stuck doing admin instead of teaching. Lesson prep, attendance, parent updates, homework marking — it eats their evenings.",
    f: "Less admin, more chess", fd: "Auto-graded puzzles, attendance captured when a student joins, reusable class plans and one-click parent reports. Give coaches their evenings back." },
  { p: "Parents in the dark", pd: "Parents pay every month but don't see the progress. They quietly drift away, or switch to the academy that shows them what's happening.",
    f: "Reports parents brag about", fd: "Branded monthly progress reports with rating curves, puzzle stats and coach notes. Renewals stop being a conversation." },
  { p: "No way to scale", pd: "Growing past 100 students breaks every spreadsheet. Hiring more coaches doesn't help when your operations have no backbone.",
    f: "Built to grow with you", fd: "Batches, branches, role-based access and your own domain. Run 30 students or 3,000 with the same tools, at the same price." },
];

// Why page: the hidden cost of the DIY stack (INR, rounded monthly figures)
export const DIY_STACK: Array<{ tool: string; inr: number }> = [
  { tool: "Zoom Pro / Google Meet for live classes", inr: 1300 },
  { tool: "Chess.com / Lichess premium (coach + demo boards)", inr: 900 },
  { tool: "ChessBase / analysis subscription", inr: 700 },
  { tool: "Puzzle & course app for students", inr: 800 },
  { tool: "Swiss-Manager / pairing software", inr: 500 },
  { tool: "Google Workspace (Sheets, Forms, attendance)", inr: 300 },
  { tool: "Payment links + invoicing", inr: 400 },
  { tool: "WhatsApp Business + report templates", inr: 0 },
];
export const DIY_ADMIN_HOURS_PER_WEEK = 10;
export const DIY_ADMIN_HOUR_INR = 300;

// Compare page. Only claims we can stand behind from each product's own public
// site (checked 2026-09-13). "?" = not stated publicly; we say so on the page.
export type Mark = "yes" | "partial" | "no" | "?";
export const COMPARE_COLUMNS = ["ChessGuru", "ChessPlay.io", "ChessLang", "ChessKid Classroom", "Sheets + WhatsApp"] as const;
export const COMPARE_ROWS: Array<{ cap: string; marks: Mark[] }> = [
  { cap: "Self-serve signup, first class today (no demo call needed)", marks: ["yes", "no", "no", "yes", "yes"] },
  { cap: "Live classroom with built-in video + shared board",          marks: ["yes", "yes", "yes", "no", "no"] },
  { cap: "Auto-graded puzzles & homework",                             marks: ["yes", "yes", "yes", "partial", "no"] },
  { cap: "Attendance + fee collection (UPI)",                          marks: ["yes", "yes", "partial", "no", "partial"] },
  { cap: "Branded parent progress reports",                            marks: ["yes", "yes", "partial", "no", "no"] },
  { cap: "Tournaments (Swiss pairings, public results)",               marks: ["yes", "yes", "yes", "no", "no"] },
  { cap: "Handwritten scoresheet → PGN scanner",                       marks: ["yes", "?", "?", "no", "no"] },
  { cap: "Snap a printed diagram → board (phone camera)",              marks: ["yes", "?", "?", "no", "no"] },
  { cap: "Blindfold training with its own rating",                     marks: ["yes", "?", "?", "no", "no"] },
  { cap: "Your own domain + branding",                                  marks: ["yes", "yes", "partial", "no", "no"] },
  { cap: "Data export any time",                                        marks: ["yes", "?", "?", "partial", "yes"] },
];
export const COMPARE_PRICE: Record<(typeof COMPARE_COLUMNS)[number], string> = {
  "ChessGuru": "₹1,000 flat",
  "ChessPlay.io": "$99 flat (≈ ₹8,300)",
  "ChessLang": "Not public",
  "ChessKid Classroom": "Per-seat, content only",
  "Sheets + WhatsApp": "Free + your evenings",
};
export const COMPARE_VERDICTS: Array<{ name: string; tagline: string; good: string[]; wins: string[]; verdict: string }> = [
  { name: "ChessPlay.io", tagline: "Polished academy platform, demo-led, $99/month flat.",
    good: ["Mature classrooms, tournaments, reports and white-label", "Big feature set for multi-branch academies", "Flat pricing, unlimited students"],
    wins: ["Onboarding is a booked demo; ChessGuru is a two-minute self-serve trial", "$99 ≈ ₹8,300/month versus ₹1,000/month", "Scoresheet scanning and printed-diagram capture are ChessGuru specialities"],
    verdict: "A strong product if you sell in dollars. For an Indian academy, ChessGuru gives the same core operations at roughly an eighth of the price." },
  { name: "ChessLang", tagline: "Long-standing Indian classroom + tournament platform.",
    good: ["Mature live classroom and curriculum", "Strong tournament tools", "Well known among Indian coaches"],
    wins: ["Fees, parent reports and renewals in the same product, not a separate add-on", "Modern, mobile-first UI that students open daily for the puzzle streak", "Transparent flat price on the website"],
    verdict: "Solid for online classes and tournaments; academies still glue other tools on for operations and parent reporting." },
  { name: "ChessKid Classroom", tagline: "Kid-safe content network from Chess.com.",
    good: ["Huge content library, trusted by parents", "Great for self-study between classes", "Kid-safe environment"],
    wins: ["Built for academy operations: fees, attendance, batches, coaches", "Students and parents see your academy's brand, not a third party's", "Live classes with your own board and video"],
    verdict: "Wonderful for kids practising at home. It is a content product, not a platform to run an academy on — many academies use both." },
  { name: "Sheets + WhatsApp", tagline: "The DIY stack most academies start with.",
    good: ["Free or nearly free", "Maximum flexibility", "No learning curve"],
    wins: ["Ten-plus admin hours a week come back", "Fees and trials stop slipping through the cracks", "One source of truth for every student's progress"],
    verdict: "Works up to about 50 students. Past that, the hidden cost in lost fees and coach time dwarfs ₹1,000 a month." },
];
