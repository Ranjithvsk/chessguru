// Long-form marketing content: per-feature pages, changelog (from real git
// history), blog articles, help guides, about/contact copy, terms + privacy.
// Owner 2026-09-13: "make it more like chessplay, add more pages".

import type { FeatureCategory } from "../../lib/features";

// ── Feature pages (ChessPlay: hero → 3 blocks × 3 bullets → 5 FAQ → CTA) ──
export type FeatureBlock = { tag: string; title: string; body: string; bullets: [string, string, string] };
export const FEATURE_PAGES: Record<FeatureCategory, { h1: [string, string]; sub: string; blocks: [FeatureBlock, FeatureBlock, FeatureBlock]; faq: Array<{ q: string; a: string }> }> = {
  classes: {
    h1: ["Get your classes online", "without the headache"],
    sub: "Set up a class in seconds — topic, day, time, coach. Students see it on their dashboard, join with one tap, and Dream Meet video runs on the same screen as the board. No Zoom link, no \"when was that class?\" messages.",
    blocks: [
      { tag: "Key feature", title: "One-tap class setup", body: "Add the topic, pick the batch, set the time, assign a coach — it's on every student's schedule instantly, with reminders 24 h, 1 h and 15 min before.",
        bullets: ["Create a class in under 30 seconds", "Weekly recurring classes — set once, run all term", "Dream Meet video built in, no external link"] },
      { tag: "For students", title: "A board that follows the coach", body: "The coach's board syncs live to every student's phone: arrows, circles, a frozen Snap-position, captions. Students raise a hand, react, or answer in chat.",
        bullets: ["Works on any phone or laptop, nothing to install", "Recording + replay for students who missed class", "Live captions from the coach's speech"] },
      { tag: "For coaches", title: "Everything you need in one view", body: "Your classes across batches in one calendar. Attendance is captured the moment a student joins; reschedule or cancel with one tap and everyone is told.",
        bullets: ["Unified calendar across coaches and batches", "Attendance captured automatically on join", "Class plans you can reuse week after week"] },
    ],
    faq: [
      { q: "Can I run recurring classes on a fixed weekly schedule?", a: "Yes. Set a topic, coach, time and recurrence and ChessGuru generates every session. Students see the full calendar on their dashboard." },
      { q: "Do I need Zoom or Google Meet?", a: "No. Dream Meet video is built into the class board. If you prefer another tool for a session, you can still attach a link." },
      { q: "How is attendance tracked?", a: "When a student joins the live class, they are marked present automatically. Coaches can override or mark in-person attendance from the same screen." },
      { q: "Can several coaches share one calendar?", a: "Yes, unlimited coaches. The academy has one calendar plus per-coach views, so nothing double-books." },
      { q: "What if I need to reschedule?", a: "Move the session or cancel one occurrence; students and parents are notified in-app and by email." },
    ],
  },
  puzzles: {
    h1: ["Homework that", "grades itself"],
    sub: "Rated puzzles across 60+ tactical themes, a Puzzle of the Day the whole academy solves together, and blindfold training with its own rating. Assign by theme and difficulty; see who solved what.",
    blocks: [
      { tag: "Key feature", title: "Assign by theme and difficulty", body: "Pick a theme (forks, back-rank, deflection…) and a difficulty band relative to each student's rating. Homework lands on their phone the moment class ends.",
        bullets: ["Glicko-rated trainer, per-theme ratings", "Difficulty adapts to each student automatically", "Wrong-move review shows the refutation"] },
      { tag: "For students", title: "A reason to open the app every day", body: "Puzzle of the Day, streaks, milestones with confetti, a separate blindfold rating to earn. Practice between classes happens without nagging.",
        bullets: ["Daily puzzle shared across the academy", "Streak-save reminders in the evening", "Blindfold mode with its own belt"] },
      { tag: "For coaches", title: "See the weak themes at a glance", body: "Per-student and per-batch views of solve rate, speed and rating by theme. Turn the weakest theme into next week's homework in one click.",
        bullets: ["Homework completion per student", "Per-theme strengths and weaknesses", "Speed by theme and best time of day"] },
    ],
    faq: [
      { q: "Where do the puzzles come from?", a: "A curated pool of rated tactical positions across 60+ themes, plus positions extracted from engine games and student games." },
      { q: "Can I set a puzzle from a printed book?", a: "Yes. Point your phone at the printed diagram; it opens on your board and you can assign it." },
      { q: "Do students need an account?", a: "Yes, and it takes a minute: invite by link, by email, or with your academy code." },
      { q: "Does the difficulty adapt?", a: "Yes. Each student has a Glicko rating overall and per theme; the trainer serves puzzles around their current level." },
      { q: "Can I see who did the homework?", a: "Yes — completion, accuracy and time per student, per assignment." },
    ],
  },
  study: {
    h1: ["A curriculum your coaches", "can assign week by week"],
    sub: "Coordinate trainer, opening trainer, endgame manual, memory palace and an opening tree of master games. From the first lesson to club strength, without building your own material.",
    blocks: [
      { tag: "Beginners", title: "The basics, drilled", body: "Coordinates, notation, piece movement and the first checkmates as interactive drills students can repeat until they're automatic.",
        bullets: ["Coordinate and notation trainers", "Rule of the square, KPK, opposition — guided", "Rated pawn-endgame practice"] },
      { tag: "Improvers", title: "Openings and endgames with structure", body: "Named openings taught move by move, an opening tree to explore master games, and endgame courses verified against tablebases.",
        bullets: ["Opening trainer with spaced repetition", "Opening tree explorer", "Endgame manual: Promote One Pawn, Opposition, Key Squares"] },
      { tag: "For coaches", title: "Your own studies and books", body: "Build studies with chapters and variations, snap a position from a printed book straight into a chapter, and assign the chapter to a batch.",
        bullets: ["Studies with chapters, comments and variations", "Board from notebook: photo → chapter", "Kindle-style bookshelf for endgame books"] },
    ],
    faq: [
      { q: "Can I add my own lesson material?", a: "Yes. Studies let you build chapters with moves, variations and comments, and assign them to a batch." },
      { q: "Is the endgame content verified?", a: "Yes — the guided endgame courses are checked against tablebases, so every claimed win or draw is correct." },
      { q: "Can students study on their own?", a: "Yes. Openings, endgames, memory palace and the coordinate trainer are all self-serve with ratings." },
      { q: "Does the opening trainer use spaced repetition?", a: "Yes. Lines you miss come back sooner; lines you know come back later." },
      { q: "Can I import PGN?", a: "Yes, into studies and into a student's games for analysis." },
    ],
  },
  play: {
    h1: ["Games, engines, arbiter,", "scoresheets"],
    sub: "Pass & play, engine battles and a board editor for students. A tournament arbiter with Swiss pairings and public results for the academy. And a scanner that turns handwritten scoresheets into PGN.",
    blocks: [
      { tag: "Tournaments", title: "Host internal tournaments effortlessly", body: "Swiss pairings, live standings, tiebreaks and a public results page you can share with parents. Weekly blitz nights become a two-minute setup.",
        bullets: ["Swiss pairings with colour balancing", "Live standings on a public link", "Results history per student"] },
      { tag: "Scoresheets", title: "Paper games become PGN", body: "Photograph a handwritten scoresheet (or two copies of the same game) and the scanner reads it move by move, flags what it isn't sure about, and gives you a PGN to correct on screen.",
        bullets: ["Reads about nine moves in ten on a clean sheet", "Two copies merged for higher accuracy", "One tap to open the game for analysis"] },
      { tag: "For students", title: "Play, then learn from it", body: "Play a friend by link with premoves and rematches, watch engines battle, set up any position in the board editor — then analyse every game move by move.",
        bullets: ["Challenge a friend by link, draw offers, rematch", "Engine battle viewer", "Board editor + engine analysis"] },
    ],
    faq: [
      { q: "What tournament formats are supported?", a: "Swiss with automatic pairings and tiebreaks, plus manual round-robin style events. Public results pages are included." },
      { q: "How accurate is the scoresheet scanner?", a: "On a clean, flat photo it reads about 90% of moves correctly and marks uncertain moves so you can fix them in seconds. Scanning both players' sheets improves it further." },
      { q: "Can students play each other online?", a: "Yes — challenge a friend by link, with premoves, draw offers and rematches." },
      { q: "Is there an engine for analysis?", a: "Yes, Stockfish runs in the browser for analysis and engine battles." },
      { q: "Can I export tournament results?", a: "Yes, as a public page link and as CSV." },
    ],
  },
  academy: {
    h1: ["The running of the academy,", "on one dashboard"],
    sub: "Coaches, students, batches, invites, fees over UPI and attendance. Everything an owner does in a week, on one screen — with each coach seeing exactly their own batches.",
    blocks: [
      { tag: "Key feature", title: "Fees on autopilot", body: "Set a monthly fee per batch or per student. ChessGuru tracks paid, due and waived, collects over UPI, and sends the reminders so you don't have to.",
        bullets: ["Batch-wise fee programmes", "UPI collection, receipts, dues list", "Reminders that go out automatically"] },
      { tag: "Roster", title: "Onboard a batch in a click", body: "Paste names, send invite links, or let students self-sign-up with your academy code. Parents get their login the same minute.",
        bullets: ["Bulk add, invite link, or academy code", "Coach invites by email", "Undo when you remove someone by mistake"] },
      { tag: "Attendance", title: "Know who showed up, automatically", body: "Attendance is captured when a student joins a live class and can be marked by hand for in-person sessions. Spot who's drifting before they leave.",
        bullets: ["Auto-marked on join, manual for in-person", "Weekly and monthly summaries per batch", "Attendance in every parent report"] },
    ],
    faq: [
      { q: "How do I collect fees?", a: "Configure a fee programme per batch or student; students and parents pay over UPI; you see paid / due / waived and get a dues list." },
      { q: "Can a coach see only their batches?", a: "Yes. Owners see everything; coaches see the batches assigned to them." },
      { q: "Can I run more than one branch?", a: "Yes — batches can be grouped by branch, with the same coaches and one bill." },
      { q: "Is there a limit on students or coaches?", a: "No. ₹1,000/month covers unlimited students and coaches." },
      { q: "Can I use my own domain?", a: "Yes. Your logo, colours and login page on your own domain — students and parents see your academy." },
    ],
  },
  analytics: {
    h1: ["Smart insights,", "zero extra effort"],
    sub: "Rating curves, per-theme strengths, activity heatmaps, personal bests and exports — tracked automatically for every student, and turned into a parent report in one click.",
    blocks: [
      { tag: "Per student", title: "Every student's journey", body: "Rating over time, per-theme Glicko, solve speed, best hour of the day, a 13-week activity heatmap. Data-driven coaching without a spreadsheet.",
        bullets: ["Rating and per-theme trends", "13-week heatmap and personal bests", "CSV export of every solve"] },
      { tag: "For parents", title: "Reports parents brag about", body: "A branded monthly progress report with rating curve, puzzles solved, attendance and the coach's note — shared as a link or PDF, no login needed.",
        bullets: ["Generated from live data in one click", "Your logo and colours on every report", "Share by WhatsApp link or PDF"] },
      { tag: "Academy view", title: "The whole academy in one screen", body: "Batch comparisons, coach load, dues per batch, top performers, students at risk of drifting.",
        bullets: ["Batch-level comparisons", "Dues and attendance trends", "Student insights per coach"] },
    ],
    faq: [
      { q: "What goes into a parent report?", a: "Rating progress, puzzles solved, accuracy, attendance, homework completion and a coach note, in a branded one-page layout." },
      { q: "Can parents view without logging in?", a: "Yes, reports are shared as a link (or PDF) that opens without a login." },
      { q: "Can I add my academy's logo?", a: "Yes. Branding applies to reports, the login page and the student app." },
      { q: "Is there an academy-wide view?", a: "Yes. Owners see batches, coaches, dues and attendance across the academy." },
      { q: "Can I export data?", a: "Yes — CSV exports of solves and results, any time." },
    ],
  },
  notifications: {
    h1: ["Nudges that", "respect the student"],
    sub: "Weekly digests, streak-save reminders, class reminders and browser push. Enough to keep practice going; never so much that a parent asks you to stop.",
    blocks: [
      { tag: "Students", title: "The right nudge at the right time", body: "An evening reminder when a streak is at risk, a push when a milestone is hit, a Sunday-morning digest of the week.",
        bullets: ["Streak-save reminder", "Milestone push notifications", "Weekly progress digest"] },
      { tag: "Classes", title: "Nobody misses a class", body: "Reminders 24 hours, 1 hour and 15 minutes before every session, with a one-tap join.",
        bullets: ["24 h / 1 h / 15 min reminders", "One-tap join from the notification", "In-app banner when a class is live"] },
      { tag: "Control", title: "Quiet by default", body: "Students and parents choose what they get. Push works on installed PWAs on Android and iOS 16.4+.",
        bullets: ["Per-user preferences", "No marketing messages, ever", "Email fallback when push is off"] },
    ],
    faq: [
      { q: "Do notifications work on iPhone?", a: "Yes, on iOS 16.4+ when the app is installed to the home screen." },
      { q: "Can parents get reminders?", a: "Yes, class reminders and reports can go to the parent's email." },
      { q: "Can I turn them off?", a: "Yes, per user, per type." },
      { q: "Do you send marketing messages?", a: "No. Only class, homework and progress messages." },
      { q: "Is WhatsApp supported?", a: "Fee reminders and reports can be shared as WhatsApp links; automated WhatsApp sending is on the roadmap." },
    ],
  },
  engagement: {
    h1: ["Practice that becomes", "a habit"],
    sub: "Streaks, milestones and celebrations turn daily practice into something kids look forward to — and something parents can see.",
    blocks: [
      { tag: "Streaks", title: "One puzzle a day keeps the rating climbing", body: "A solve streak and a separate daily-puzzle streak, with a 7-day strip that makes consistency visible.",
        bullets: ["Solve streak + daily-puzzle streak", "7-day history strip", "Streak-save reminders"] },
      { tag: "Milestones", title: "Celebrate the small wins", body: "Rating milestones and solve-count milestones trigger a confetti overlay and a push notification worth screenshotting.",
        bullets: ["Rating milestones (1200, 1400, 1600…)", "Solve-count milestones (25, 100, 250…)", "Personal bests on the dashboard"] },
      { tag: "Academy", title: "Friendly competition", body: "Batch leaderboards and Puzzle of the Day rankings give students a reason to check back, and coaches a reason to praise.",
        bullets: ["Batch and academy leaderboards", "Daily puzzle ranking", "Blindfold rating as a separate belt"] },
    ],
    faq: [
      { q: "Is the leaderboard optional?", a: "Yes. Coaches can hide it for younger batches." },
      { q: "Does it work for adults too?", a: "Yes — streaks and personal bests are the same; celebrations are tasteful." },
      { q: "Can parents see streaks?", a: "Yes, in the monthly report and on the student's dashboard." },
      { q: "Is there a risk of over-gamification?", a: "We keep it to streaks, milestones and a leaderboard. No coins, no loot boxes." },
      { q: "Can I reward top students?", a: "Yes — the Puzzle of the Day and batch leaderboards make it easy to pick a student of the week." },
    ],
  },
};

// ── Changelog — every entry maps to shipped commits in this repo ───────────
export type ChangeTag = "New" | "Improved" | "Fixed" | "Design" | "Performance";
export const CHANGELOG: Array<{ v: string; month: string; piece: string; title: string; items: Array<{ tag: ChangeTag; t: string; d: string }> }> = [
  { v: "v2.6", month: "September 2026", piece: "Queen", title: "Scoresheet scanning, flat pricing and a new front door.",
    items: [
      { tag: "New", t: "Handwritten scoresheet → PGN", d: "Photograph a scoresheet (or both players' copies) from Tools → Scan scoresheet; the reader returns a PGN with uncertain moves flagged for a quick fix." },
      { tag: "New", t: "Board from notebook in Studies", d: "Snap a position from a printed book or notebook straight into a study chapter." },
      { tag: "New", t: "Flat ₹1,000/month, unlimited students", d: "One price for every academy; yearly ₹10,000 with two months free. Razorpay subscription with monthly or yearly auto-renew." },
      { tag: "Improved", t: "30-day trial, phone at signup", d: "The free trial is now 30 days; owners and coaches leave a mobile number so we can help with onboarding." },
      { tag: "Design", t: "Academy marketing pages", d: "A new home, built-for pages, why, compare, features, blog, changelog, help and contact — the pages you're reading." },
      { tag: "Fixed", t: "iPhone file pickers", d: "Scanning inputs now offer Photos as well as the camera." },
    ] },
  { v: "v2.5", month: "August 2026", piece: "Rook", title: "Fees, from configuration to collection to reports.",
    items: [
      { tag: "New", t: "Batch-wise fee programmes", d: "Configure fees per batch or per student, with enrolments that sync live from batches." },
      { tag: "New", t: "Fee reports", d: "Collections, dues and waivers as charts; status filter chips on enrolments." },
      { tag: "New", t: "Per-academy payment settings", d: "Self-serve UPI settings and webhook per academy." },
      { tag: "Performance", t: "Faster first paint", d: "The initial bundle was split from the rest of the app; fee pages load lazily; assets are long-cached." },
      { tag: "Fixed", t: "Puzzle rating inflation on same-theme grinds", d: "Repeated solves of one theme no longer inflate the global rating." },
    ] },
  { v: "v2.4", month: "July 2026", piece: "Bishop", title: "Guided endgame courses and the book reader.",
    items: [
      { tag: "New", t: "Opposition and Promote One Pawn courses", d: "Guided, tablebase-verified chapters: direct, distant and very distant opposition; the floating square; one king holding two pawns." },
      { tag: "New", t: "Rated pawn-endgame practice", d: "A pool of 636–2744 rated positions from Dvoretsky and Lichess." },
      { tag: "New", t: "Book reader", d: "Kindle-style bookshelf, position editor for misprinted diagrams, on-demand engine moves, play-both-sides toggle." },
      { tag: "Fixed", t: "Any checkmate is accepted", d: "Puzzles accept every mating move, not only the stored line." },
    ] },
  { v: "v2.3", month: "June 2026", piece: "Knight", title: "Study ratings and the admin console.",
    items: [
      { tag: "New", t: "Per-study Glicko rating and matchmaking", d: "Each study trainer has its own rating; positions are served around the student's level." },
      { tag: "New", t: "Pawn drills", d: "Queen and rook versus pawns with draw-aware scoring." },
      { tag: "New", t: "Admin analytics", d: "Overview stats, 14-day trends, content and per-user depth; last-login tracking." },
      { tag: "Fixed", t: "Admin endpoints locked to admins", d: "Factory and extractor endpoints are admin-only." },
    ] },
  { v: "v2.0", month: "May 2026", piece: "Pawn", title: "ChessGuru v2: play, PWA and a faster puzzle engine.",
    items: [
      { tag: "New", t: "Play a friend by link", d: "Realtime games with premoves, promotion chooser, draw offers and rematches." },
      { tag: "New", t: "Installable app", d: "ChessGuru is a PWA on Android and iOS; resume your unsolved puzzle across refreshes." },
      { tag: "Performance", t: "Puzzle selection in ~20 ms", d: "Pre-built rating pools replaced a 4–6 second query." },
      { tag: "Design", t: "Tablet two-column layout", d: "Full-screen board with a Next button beside the heading." },
    ] },
];

// ── Blog ───────────────────────────────────────────────────────────────────
export type Post = { slug: string; title: string; date: string; excerpt: string; tag: string; minutes: number; body: string[] };
export const POSTS: Post[] = [
  { slug: "start-a-chess-academy-india-2026", title: "How to start a chess academy in India in 2026: a practical checklist", date: "2026-09-13", tag: "Playbook", minutes: 6,
    excerpt: "Room, coaches, batches, fees, parents, software. The order matters less than most people think — except for one thing.",
    body: [
      "Every week a coach messages us the same question: I have ten students and a room, how do I turn this into an academy? The honest answer is that you already have one. What you need now is a system that survives the jump from ten students to a hundred without you becoming a full-time administrator.",
      "Start with batches, not students. Group by level and by time slot: Beginners Tuesday 5 pm, Improvers Thursday 6 pm. Every later decision — fees, homework, reports — attaches to a batch, so get this right first. Two batches is enough to begin.",
      "Decide the fee per batch before the first parent asks. In most Indian cities a group class runs between ₹1,000 and ₹2,500 per month; private lessons two to four times that. Write it down, collect it monthly over UPI, and never make an exception you would not make for every parent.",
      "Recruit a second coach earlier than feels comfortable. The moment you cannot cover a Tuesday because you are at a tournament, the academy needs to run without you. A coach who takes one batch a week is enough to make the academy real.",
      "Give parents something to see. The academies that keep students for years all do one thing: they show progress. A monthly report with a rating curve, puzzles solved and a short note from the coach does more for renewals than any discount.",
      "Then pick software that does all of this in one place. The spreadsheet-plus-WhatsApp stack works until about fifty students; past that, fees slip, attendance is guesswork and reports never get written. ChessGuru does batches, live classes, homework, fees, attendance and reports for ₹1,000 a month, unlimited students, and the first 30 days are free.",
    ] },
  { slug: "fees-on-autopilot-upi", title: "Fees on autopilot: how ChessGuru collects academy fees over UPI", date: "2026-09-06", tag: "Product", minutes: 4,
    excerpt: "Configure a fee per batch, let parents pay over UPI, and never send an awkward reminder again.",
    body: [
      "Fee collection is the part of running an academy nobody enjoys. It is also where most academies quietly lose money: a student joins mid-month, a parent pays late, a sibling gets a discount that nobody wrote down, and by the end of the quarter the numbers do not add up.",
      "ChessGuru's fee module starts from the batch. You create a fee programme — say ₹1,500 per month for the Improvers batch — and every student enrolled in that batch is billed automatically. Move a student to another batch and the enrolment follows.",
      "Parents pay over UPI from the link they receive. The payment is matched to the student, a receipt is issued, and the dues list updates. Waivers and discounts are recorded per student, so a sibling discount is a setting, not a memory.",
      "Reminders go out automatically before and after the due date. Owners see a dues list by batch and a collections chart by month; coaches see nothing about money unless you want them to.",
      "The result is boring, in the best sense: fees arrive, the numbers add up, and you spend the first week of the month coaching instead of chasing.",
    ] },
  { slug: "scoresheet-to-pgn", title: "From paper scoresheet to PGN: how the scanner works and how to photograph a sheet", date: "2026-09-12", tag: "Product", minutes: 5,
    excerpt: "The reader gets about nine moves in ten on a clean photo. Here is how it works and how to make the photo clean.",
    body: [
      "Tournament games live on paper. Every academy has a drawer of scoresheets nobody has time to type up, which means the most valuable games a student plays — the ones under a clock, against a stranger — are the ones that never get analysed.",
      "ChessGuru's scanner takes a photo of a handwritten scoresheet, finds the table, cuts it into move cells, and reads each cell with a handwriting model trained on thousands of real scoresheets. A chess engine then checks the sequence: if a read is illegal, the reader looks at the next most likely spellings; if it still cannot decide, it marks the move as uncertain instead of guessing.",
      "On our held-out test set the reader gets about 90% of moves right from one copy and slightly more when both players' sheets are scanned and merged. The rest are flagged, and fixing a flagged move on screen takes a couple of seconds because the board shows you the position.",
      "To get the best result: lay the sheet flat, photograph from directly above in good light, keep all four corners in frame, and avoid shadows from your hand. Green or red pen reads worse than blue or black. If the sheet is curled, weigh the corners down for the photo.",
      "Find it under Tools → Scan scoresheet. Upload one or two images, wait for the read, correct any flagged move, and open the game for engine analysis or assign the critical position as homework.",
    ] },
  { slug: "why-flat-pricing", title: "Why we price ChessGuru at ₹1,000 a month, flat", date: "2026-09-13", tag: "Company", minutes: 3,
    excerpt: "Per-student pricing punishes growth. A flat price means the software never becomes a reason to say no to a student.",
    body: [
      "Most academy software is priced per student. It sounds fair until you do the maths: an academy that grows from 60 to 120 students doubles its software bill while its margins barely move. The owner starts asking whether the next batch is worth it. That is the wrong question for a chess academy to be asking.",
      "We tried tiers for exactly one morning. By the afternoon the owner of ChessGuru had made the call: one price, ₹1,000 a month, unlimited students, unlimited coaches, every feature. Pay for a year and it is ₹10,000, two months free.",
      "The number is deliberate. It is less than one student's monthly fee at almost any academy in India, which means ChessGuru pays for itself if it keeps a single student from drifting away — and the monthly parent report alone does that.",
      "Flat pricing also keeps us honest. We cannot grow by charging you more; we can only grow by helping you grow. That is the relationship we want with every academy on the platform.",
    ] },
  { slug: "live-class-dream-meet-setup", title: "Running a live class on Dream Meet: a coach's setup guide", date: "2026-08-30", tag: "Guide", minutes: 5,
    excerpt: "Camera, board, arrows, snap-position, recording. Ten minutes of setup, then it just works every week.",
    body: [
      "Dream Meet is the video layer built into every ChessGuru class. There is no external link to paste and no second app for students to install: the coach opens the class, the video and the board are on the same screen, and students join from their dashboard.",
      "Before the first class, do a two-minute check: open a test class, allow camera and microphone, and confirm the board syncs to a second device — your phone is fine. Screen size matters less than you think; students follow the board, not your face.",
      "During class, teach on the board. Arrows and circles broadcast instantly. When you reach the position you want everyone to think about, use Snap-position: it freezes the board for students while you keep moving pieces on yours. Ask for answers in chat or with a raised hand.",
      "Record the class with one tap. Students who missed it get the replay, and you get a library of your own explanations to reuse. Live captions from your speech help students with weaker audio.",
      "After class, assign the homework straight from the position you finished on. Attendance was captured when students joined, so there is nothing to mark. Parents see both in the monthly report.",
    ] },
  { slug: "parent-reports-that-get-shared", title: "Parent reports that get shared: what to put in a monthly progress report", date: "2026-08-20", tag: "Playbook", minutes: 4,
    excerpt: "A report is not a certificate. It is the reason a parent renews without being asked.",
    body: [
      "Parents pay every month for something they cannot see. They do not attend the class, they cannot judge a position, and the only signal they get is whether their child seems to like it. A monthly report replaces that guesswork with evidence.",
      "The best reports are short and specific. One rating curve, so progress is visible at a glance. Puzzles solved and accuracy, so effort is visible. Attendance, so commitment is visible. And two sentences from the coach that could only be about this child: what they learned, what is next.",
      "Avoid the temptation to pad. A page is enough. Parents forward a page to grandparents; nobody forwards a five-page PDF.",
      "Send it the same week every month and brand it with the academy's logo. Consistency is what turns a report into a habit — and a habit into a renewal that never needs a reminder.",
      "In ChessGuru a coach generates the report from live data in one click, adds the note, and shares it as a link or PDF. The parent needs no login to open it.",
    ] },
];

// ── Help centre ────────────────────────────────────────────────────────────
export type Guide = { slug: string; title: string; audience: "Owners" | "Coaches" | "Students & parents"; steps: string[] };
export const GUIDES: Guide[] = [
  { slug: "set-up-your-academy", title: "Set up your academy in 10 minutes", audience: "Owners", steps: ["Start the free trial at chessguru.cc/signup-academy — academy name, your name, mobile, email, password.", "Open Academy → Batches and create your first batch (level + time slot).", "Invite coaches by email from Academy → Coaches; assign each coach to a batch.", "Add students: paste names, send the invite link, or share your academy code for self-signup.", "Set a fee programme per batch under Fees, and your first class under Classes."] },
  { slug: "invite-coaches", title: "Invite coaches and set what they see", audience: "Owners", steps: ["Academy → Coaches → Invite by email.", "The coach opens the link, chooses a username and password and enters a mobile number.", "Assign the coach to one or more batches. Coaches only see their own batches; owners see everything."] },
  { slug: "add-students", title: "Add students three ways", audience: "Owners", steps: ["Bulk: Academy → Students → Add, paste one name per line.", "Invite link: copy the batch invite link and send it on WhatsApp; the student creates their login.", "Academy code: students sign up at chessguru.cc/register with your code and land in the right academy.", "Removed someone by mistake? Use Undo on the roster within the session."] },
  { slug: "schedule-a-class", title: "Schedule a live class", audience: "Coaches", steps: ["Classes → New class: topic, batch, date, time, recurrence.", "Students see it on their dashboard and get reminders 24 h, 1 h and 15 min before.", "At class time open the class; Dream Meet video and the shared board start together.", "Attendance is captured when each student joins."] },
  { slug: "teach-on-dream-meet", title: "Teach on Dream Meet: board, arrows, snap-position, recording", audience: "Coaches", steps: ["Allow camera and microphone on first use.", "Move pieces on your board; every student's screen follows.", "Draw arrows and circles to explain; use Snap-position to freeze the board for students while you explore.", "Tap Record to save the class for replay.", "End the class; assign homework from the final position."] },
  { slug: "assign-homework", title: "Assign puzzles as homework", audience: "Coaches", steps: ["Coach board → Homework → New: pick a batch, a theme and a difficulty band.", "Students get it on their phone immediately.", "Check completion and accuracy per student from the same page."] },
  { slug: "fees", title: "Configure fees and collect over UPI", audience: "Owners", steps: ["Fees → Programs → New: choose a batch or students, the monthly amount and the due day.", "Enrolments are created for every student in the batch and stay in sync.", "Parents pay from their link over UPI; receipts and dues update automatically.", "Fees → Reports shows collections, dues and waivers by month."] },
  { slug: "parent-report", title: "Generate a parent report", audience: "Coaches", steps: ["Coach board → Reports → New, pick the student and the month.", "Review the rating curve, puzzles, attendance and homework; add your note.", "Share as a link on WhatsApp or download the PDF. Parents need no login."] },
  { slug: "scan-scoresheet", title: "Scan a handwritten scoresheet", audience: "Coaches", steps: ["Tools → Scan scoresheet.", "Photograph the sheet flat, from above, in good light, all four corners in frame. Add the opponent's copy if you have it.", "Wait for the read (an estimate is shown). Uncertain moves are highlighted.", "Fix any flagged move on the board, copy the PGN or open the game for analysis."] },
  { slug: "board-from-notebook", title: "Put a position from a book into a study", audience: "Coaches", steps: ["Open a study chapter and tap Scan notebook.", "Photograph the printed diagram; the position opens in the board editor.", "Tap Use in study to make it the chapter's starting position."] },
  { slug: "install-the-app", title: "Install ChessGuru on a phone", audience: "Students & parents", steps: ["Open your academy's link in Safari (iPhone) or Chrome (Android).", "iPhone: Share → Add to Home Screen. Android: menu → Install app.", "Allow notifications if you want class reminders and streak nudges."] },
  { slug: "custom-domain", title: "Use your own domain and branding", audience: "Owners", steps: ["Academy → Settings → Branding: upload the logo and pick colours.", "Message us on WhatsApp with the domain you own (for example classes.youracademy.in); we send you one DNS record to add.", "Your login page, student app and reports show your academy's name and logo."] },
];

// ── About ──────────────────────────────────────────────────────────────────
export const HOUSE_RULES = [
  { n: "Rule 1", t: "Coaches first", d: "Every screen is designed by watching a real coach use it in a real class. If it does not make Tuesday evening calmer, it does not ship." },
  { n: "Rule 2", t: "Replace, don't add", d: "Each new feature has to retire a tool from your stack — the Zoom link, the fee spreadsheet, the report template — not pile on top of it." },
  { n: "Rule 3", t: "Built from real games", d: "Scoresheet scanning, printed-diagram capture and tablebase-verified endgame courses exist because our own students needed them." },
  { n: "Rule 4", t: "One price, one promise", d: "₹1,000 a month for everything. We grow only when your academy grows, so we build the things that grow academies." },
];

// ── Legal ──────────────────────────────────────────────────────────────────
export const LEGAL_UPDATED = "13 September 2026";
export const TERMS: Array<{ h: string; p: string[] }> = [
  { h: "The service", p: ["ChessGuru (chessguru.cc) is chess academy software operated from India. An academy account is created by the person who signs up (the owner), who may invite coaches, students and parents. The owner is responsible for the accounts they invite and for having permission to add minors' details."] },
  { h: "Trial and payment", p: ["Every new academy gets a 30-day free trial with full access and no card. After the trial the price is ₹1,000 per month, or ₹10,000 per year, for unlimited students and coaches and every feature. Prices include GST where applicable and may change with 30 days' notice on this page.", "Payments are processed by Razorpay. A monthly or yearly subscription renews automatically until cancelled. You can cancel at any time from the Billing page; access continues until the end of the paid period. We do not charge without your consent and do not offer refunds for partial periods, except where the service was unavailable for an extended time through our fault."] },
  { h: "Your data", p: ["Your academy's data — students, classes, fees, games, reports — belongs to you. You can export it at any time and ask us to delete it when you leave. We never sell it or use it to train AI models. See the Privacy policy for details."] },
  { h: "Acceptable use", p: ["Use ChessGuru for teaching and running chess programmes. Do not upload content you have no right to share, attempt to access other academies' data, or use the service to send unsolicited messages."] },
  { h: "Availability and liability", p: ["We aim for the service to be available at all times and announce maintenance in advance where possible. ChessGuru is provided as is; to the extent permitted by law our liability is limited to the fees you paid in the previous three months."] },
  { h: "Contact", p: ["hello@chessguru.cc · WhatsApp +91 82483 53593."] },
];
export const PRIVACY: Array<{ h: string; p: string[] }> = [
  { h: "What we collect", p: ["Account details (name, email, mobile number, username, password hash); academy details (batches, classes, attendance, fees, reports); learning activity (puzzles solved, ratings, games, study progress); technical logs (IP address, device and browser, timestamps) needed to run and secure the service.", "Photos uploaded for scanning (scoresheets, printed diagrams) are processed to extract the position or moves and are not used for any other purpose."] },
  { h: "Why", p: ["To run your academy: classes, homework, fees, reports and reminders. To keep accounts secure. To send service messages (class reminders, trial ending, receipts). We do not send marketing messages to students or parents."] },
  { h: "Where and how long", p: ["Data is stored on servers we control in France and India, with encrypted backups. We keep it while your academy is active and delete it within 90 days of a deletion request or account closure, except records we must keep for tax purposes."] },
  { h: "Who sees it", p: ["Your academy's owner and the coaches they assign; the student and their parent for their own data. Payment details are handled by Razorpay and never stored by us. We do not sell data and do not share it with advertisers. We use no third-party analytics on the student app."] },
  { h: "Children", p: ["Many students are minors. Accounts for minors are created by an academy owner or coach with the parent's permission, and are only visible to that academy. Parents can ask for a copy or deletion of their child's data at any time."] },
  { h: "Your rights", p: ["Export, correct or delete your data by asking us at hello@chessguru.cc or on WhatsApp +91 82483 53593. We answer within one working day."] },
];
