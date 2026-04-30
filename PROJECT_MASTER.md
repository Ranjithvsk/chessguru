# CHESSGURU — COMPLETE PROJECT MASTER
## Last Updated: April 25, 2026 (Sessions 1–4 Full Chat)
## File: ~/chessguru/PROJECT_MASTER.md

---

## 1. PROJECT OVERVIEW

| | Firebase SGM (Live) | ChessGuru (Active) |
|---|---|---|
| **Status** | ✅ Live production | ✅ Live production |
| **URL** | https://super-grand-master.web.app | https://harinitharanjith.com |
| **Hosting** | Firebase Hosting | GCP VM + Nginx (migrating to OVH) |
| **Database** | Firestore + RTDB | MongoDB 7 |
| **Backend** | Firebase (serverless) | Node.js + Express (server3.js) |
| **Auth** | Firebase Auth | Own system (bcrypt + express-session) |
| **Puzzles** | 1,470,658 (Firestore) | 5,882,680 (MongoDB) |

---

## 2. SERVER INFO

### GCP (Current — migrating to OVH)
- **IP:** 34.143.245.57
- **SSH:** `ssh -i C:\Users\Ranji\.ssh\id_ed25519 ranjith_vsk@34.143.245.57`
- **Zone:** asia-southeast1-c (Singapore)
- **Machine:** e2-small (2 vCPU, 2GB RAM, 10GB SSD)
- **OS:** Ubuntu 24.04 LTS
- **Disk:** 8.65GB total, 86.5% used ⚠️
- **Cost:** ~$16/mo

### OVH KS-5 (Target)
- **Plan:** Kimsufi KS-5, Singapore
- **CPU:** Intel Xeon-E3 1270v6, 4c/8t
- **RAM:** 32GB
- **Storage:** 2×450GB HDD
- **Cost:** $19.90/mo (first month $39.80)
- **Status:** ⏳ Order pending

### Domain
- **Domain:** harinitharanjith.com
- **Registrar:** Cloudflare (~$10.46/yr)
- **DNS:** Cloudflare (grey cloud — NOT proxied, required for certbot)
- **SSL:** Let's Encrypt via Certbot (expires 2026-07-23, auto-renews)

---

## 3. SERVER STACK

| Tool | Version |
|------|---------|
| Ubuntu | 24.04 LTS |
| Node.js | 20.20.2 |
| npm | 10.8.2 |
| MongoDB | 7.0.31 |
| Nginx | 1.24.0 |
| Redis | 7.0.15 |
| PM2 | 6.0.14 |
| Certbot | latest |

**PM2:** `pm2 restart chessguru` | `pm2 logs chessguru --lines 20 --nostream`

---

## 4. FILE STRUCTURE

```
/home/ranjith_vsk/chessguru/
├── server3.js          ← ACTIVE main server (PORT 3000)
├── auth.js             ← Own login system (bcrypt, session)
├── routes.js           ← All API endpoints + per-user rating
├── models.js           ← Mongoose schemas (User, UserPerfs, Round, Puzzle)
├── glicko2.js          ← Lichess-exact Glicko-2 rating engine
├── gen_piece_pools.js  ← piecePools builder (run on OVH)
├── .gitignore
├── PROJECT_MASTER.md   ← THIS FILE
│
├── public/
│   ├── index.html      ← Main puzzle UI (240 lines) ✅ PRODUCTION
│   ├── blindfold.html  ← Blindfold mode UI (488 lines) ✅ PRODUCTION
│   ├── login.html      ← Login/Register page (134 lines) ✅ PRODUCTION
│   ├── index.html.bak  ← Backup from Apr 24 (PRE-auth changes)
│   ├── css/
│   ├── js/
│   └── pieces/
│
├── server.js           ⚠️ DELETE — old version
├── server2.js          ⚠️ DELETE — old version
├── add_piece_count.js  ⚠️ DELETE — one-time migration done
├── import2.js          ⚠️ DELETE — one-time import done
└── lichess_db_puzzle.csv ⚠️ DELETE — 1.1GB already imported
```

**Files to delete (free ~1.1GB):**
```bash
rm ~/chessguru/lichess_db_puzzle.csv
rm ~/chessguru/server.js ~/chessguru/server2.js
rm ~/chessguru/add_piece_count.js ~/chessguru/import2.js
```

---

## 5. DATABASE

- **DB name:** chessguru
- **Collections:**
  - `puzzles` — 5,882,680 docs (1.6GB)
  - `paths` — pre-computed puzzle paths (4,299 docs)
  - `piecePools` — 7/670 built (finish on OVH)
  - `users` — registered accounts
  - `userperfs` — per-user Glicko-2 ratings
  - `rounds` — puzzle attempt history
  - `sessions` — express-session store (MongoDB)

---

## 6. ALL CHANGES THIS SESSION (April 25, 2026)

### 6.1 Own Login System (Phase 4 Auth)

**Problem:** No auth existed. Added complete own login system like Lichess.

**Files created/modified:**

#### `auth.js` (NEW — 83 lines)
- `register(req,res)` — validates username (2-20 chars, alphanumeric), hashes password with bcrypt(10), inserts to `users` collection via raw MongoDB driver
- `signin(req,res)` — case-insensitive username/email lookup, normalizes `bpass` from BSON Binary/Buffer/string before bcrypt.compare, sets session
- `me(req,res)` — returns `{loggedIn, username, userId}` from session
- `logout(req,res)` — destroys session
- Uses raw `mongoose.connection.db.collection('users')` — bypasses Mongoose to avoid BSON Binary issues
- Rate limited: 10 attempts per 15 min on auth endpoints

**Key bug fixed:** `bpass` field defined as `Buffer` in Mongoose schema → stored as BSON Binary → `bcrypt.compare()` failed with "data and hash must be strings". Fix: normalize with `hash.buffer.toString('utf8')` for BSON Binary, `hash.toString('utf8')` for Node Buffer.

**Second bug fixed:** `lichessId_1` unique index on `users` collection caused `E11000 duplicate key` for null values (users without Lichess ID). Fix: `db.users.dropIndex("lichessId_1")` in mongosh.

#### `server3.js` (MODIFIED)
Added:
- `express-session` with MongoStore (30-day TTL sessions in MongoDB)
- `connect-mongo` (used as `.default` — v4+ ESM export)
- `authLimiter` — 10 req/15min for auth endpoints
- Session middleware inside mongoose.connect().then() callback
- Auth routes: `POST /auth/register`, `POST /auth/signin`, `GET /auth/me`, `POST /auth/logout`
- Login page route: `GET /login`
- Fixed catch-all route: `app.get("/*splat",...)` (Express v5 path-to-regexp requires named wildcards)
- `cors({origin:true, credentials:true})`

**Packages installed:**
```bash
npm install bcrypt express-session connect-mongo passport passport-lichess
```
(passport/passport-lichess installed but NOT used — replaced by own system)

#### `public/login.html` (NEW — 134 lines)
Lichess-exact design:
- Dark card, rounded, centered
- **Sign in tab:** Username or email + Password (👁 toggle) + Keep me logged in checkbox + Sign in button
- **Register tab:** Username + Password + Email (optional) + fair play notice
- Orange active tab underline (Lichess style)
- Blue Sign in / Create account button
- Red error box, green success box
- Enter key submits
- `?tab=register` URL param opens Register tab directly
- JS: `doSignin()`, `doRegister()` — fetch POST to `/auth/signin` and `/auth/register`
- On success: redirects to `/` (or `?back=` URL)

#### `public/index.html` (MODIFIED)
Added navbar user widget before `</nav>`:
```html
<div id="userWidget">
  <a id="loginBtn" href="/login">Sign in</a>
  <span id="userInfo">
    <a id="userNameDisplay">username</a>
    <button onclick="doLogout()">Sign out</button>
  </span>
</div>
<script>
  fetch('/auth/me') → if loggedIn show username + fetch /api/me/rating
  window._userId = userId
  window.doLogout = POST /auth/logout then reload
</script>
```

Also modified complete call:
```js
body: JSON.stringify({win, difficulty:currentDiff, rating:myRating, userId:window._userId||null})
```

#### `public/blindfold.html` (MODIFIED)
- Same userWidget added
- Complete call body: added `userId:window._userId||null`
- Auth/me block: added `fetch('/api/me/rating')` to load saved rating into `myGlicko`

---

### 6.2 Per-User Rating System

**Problem:** Rating was hardcoded to 1500 on every page load. Not saved per user.

**Solution:**

#### `routes.js` (MODIFIED)
Added new endpoint:
```js
GET /api/me/rating
→ reads req.session.userId
→ fetches UserPerfs.puzzle.gl.r from MongoDB
→ returns {rating, loggedIn, userId}
→ guests get {rating:1500, loggedIn:false}
```

Modified `POST /api/puzzles/:id/complete`:
- Already had per-user rating logic using `userId` from `req.body`
- Reads `UserPerfs.findById(userId)`, runs `updatePuzzleRating()`, saves back
- Increments `User.count.game/win/loss`
- Saves `Round` record

**Rating flow:**
```
Page load → GET /api/me/rating → myRating = saved value
Solve puzzle → POST /api/puzzles/:id/complete {userId} → Glicko-2 update → save to UserPerfs
Next load → rating persists ✅
```

---

### 6.3 Glicko-2 Rating System (glicko2.js)

**Source:** Lichess-exact port from `lichess-org/lila` GitHub (read via GitHub API)

**Constants (identical to Lichess):**
```
DEFAULT_RATING    = 1500
DEFAULT_DEVIATION = 500
DEFAULT_VOLATILITY = 0.09
TAU              = 0.75
RATING_PERIODS_PER_DAY = 0.21436
MAX_DEVIATION    = 500
MIN_DEVIATION    = 45
MAX_RATING_DELTA = 700
RATING_FLOOR     = 400
SCALE            = 173.7178
```

**Verified rating behaviour (tested live):**

| Puzzle vs User | Result | Diff (stable RD=83) |
|----------------|--------|---------------------|
| LOW (800) | WIN | +1 |
| LOW (800) | PARTIAL/hint | -17 |
| LOW (800) | LOSS | -36 |
| MEDIUM (1500) | WIN | +18 |
| MEDIUM (1500) | PARTIAL | 0 |
| MEDIUM (1500) | LOSS | -18 |
| HIGH (2200) | WIN | +36 |
| HIGH (2200) | PARTIAL | +18 |
| HIGH (2200) | LOSS | -1 |

**RD convergence:**
- Game 1: RD=306
- Game 10: RD=130
- Game 30: RD=90
- Game 50+: RD=83 (stable floor with rapid play)
- RD stays at 83 even after 1 year inactive (volatility too small to move it)

---

### 6.4 Test User

```
Username: TestUser
Password: test1234
_id:      testuser
DB:       chessguru.users
```

Create script (if DB wiped):
```bash
node -e "
const bcrypt=require('bcrypt'),mongoose=require('mongoose');
mongoose.connect('mongodb://localhost:27017/chessguru').then(async()=>{
  const hash=await bcrypt.hash('test1234',10);
  await mongoose.connection.db.collection('users').insertOne(
    {_id:'testuser',username:'TestUser',bpass:hash,createdAt:new Date()});
  console.log('done');process.exit(0);});
"
```

---

### 6.5 MongoDB Index Fix

**Problem:** Old `lichessId_1` unique index on `users` collection blocked registration.
**Fix:**
```bash
mongosh chessguru --eval 'db.users.dropIndex("lichessId_1")'
```

---

### 6.6 Git Setup (April 25, 2026)

```bash
cd ~/chessguru
git init
git config user.email "ranjith.vsk@gmail.com"
git config user.name "Ranjith VSK"
git branch -m main
```

`.gitignore` created with: `node_modules/, *.csv, import2.js, add_piece_count.js, .env`

**⚠️ FIRST COMMIT NOT YET DONE — must do before any new features**

**Branch strategy (to implement):**
```
main          ← production only, always working
test/         ← test branches for new features
test/feature-name  ← each new feature tested here first
```

**Test page workflow (NEW RULE — agreed April 25):**
1. ALL new features → `/public/test/feature-name.html` first
2. Test fully, 0 bugs confirmed by Ranjith
3. ONLY then merge to production `index.html` / `blindfold.html`
4. Git commit after every successful merge

---

## 7. API ENDPOINTS (complete list)

```
# Auth
POST /auth/register      → register new user
POST /auth/signin        → sign in
GET  /auth/me            → current session user
POST /auth/logout        → destroy session

# Pages
GET  /login              → login.html
GET  /blindfold          → blindfold.html
GET  /*                  → index.html (catch-all)

# Puzzles
GET  /api/themes                    → 68 themes list
GET  /api/me/rating                 → user's saved rating
GET  /api/puzzles/daily             → daily puzzle
GET  /api/puzzles/random            → path-based selection
GET  /api/puzzles/:id               → puzzle by ID
POST /api/puzzles/:id/complete      → submit result + Glicko-2 update
GET  /api/puzzles/batch             → up to 50 puzzles
GET  /api/streak                    → 150-puzzle streak pool
POST /api/streak/complete           → save streak score
GET  /api/dashboard/:days           → stats by theme
GET  /api/history                   → paginated round history
GET  /api/health                    → system status
```

---

## 8. LICHESS SOURCE READ (GitHub API)

Read via: `https://api.github.com/repos/lichess-org/lila/contents/ui/puzzle/src/view/`

Files read:
- `feedback.ts` — exact structure of "Your turn" + hint button
- `main.ts` — puzzle controls layout
- `side.ts` — userBox structure

**Lichess feedback.ts exact structure:**
```
div.puzzle__feedback.play
  div.player
    div.no-square → piece.king.{white|black}
    div.instruction
      strong → "Your turn"
      em → "Find the best move for White/Black"
  div.view_solution
    button.button (hint — active = filled green, inactive = .button-empty)
    button.button.button-empty (View the solution)
```

**⚠️ This change was ATTEMPTED but REVERTED** — changes to index.html feedback block were incomplete/buggy. Must be done properly via test page workflow.

---

## 9. PENDING TASKS (Priority Order)

### Immediate
- [ ] `git add -A && git commit -m "feat: auth system, per-user rating, login page"`
- [ ] Create `public/test/` directory for test pages
- [ ] Delete junk files on GCP (free 1.1GB)

### Feature: Lichess-exact feedback UI (test first!)
- [ ] Create `public/test/feedback-ui.html`
- [ ] Implement: `piece.king.white/black`, hint button, exact CSS
- [ ] Test fully → Ranjith confirms → merge to index.html + blindfold.html

### Server Migration
- [ ] Order OVH KS-5 Singapore
- [ ] mongodump + rsync to OVH
- [ ] Run `gen_piece_pools.js` on OVH (32GB RAM)
- [ ] DNS cutover → shutdown GCP

### Phase 5 Features (each via test page first)
- [ ] Leaderboard
- [ ] Dashboard/stats by theme
- [ ] Storm mode
- [ ] Daily puzzle page
- [ ] Keyboard shortcuts
- [ ] Opening field display

---

## 10. IMPORTANT LESSONS (This Session)

| Issue | Solution |
|-------|----------|
| `connect-mongo` `.create` not a function | Use `require('connect-mongo').default` |
| `bcrypt` fails with "data and hash must be strings" | `bpass` stored as BSON Binary — normalize via `hash.buffer.toString('utf8')` |
| `E11000 duplicate key lichessId_1` | Drop old unique index: `db.users.dropIndex("lichessId_1")` |
| Express catch-all `app.use(*)` crashes | Use `app.get("/*splat", ...)` — Express v5 path-to-regexp requires named wildcards |
| `OverwriteModelError: Cannot overwrite User model` | Two files defining User model — remove from auth.js, import from models.js |
| `MongoStore.create is not a function` | `require('connect-mongo').default` not `.default.create` |
| Session not accessible in routes.js | Session middleware must be in server3.js BEFORE routes are loaded |
| index.html backup was from Apr 24 | `.bak` files only saved at specific points — SET UP GIT immediately |
| Partial HTML edits left page broken | Always use test pages — never edit production HTML directly |
| Sign in failed with correct password | `bpass` was a BSON Binary object, not a string — needed `hash.buffer.toString('utf8')` |

---

## 11. NEXT SESSION — START HERE

```bash
# Connect
ssh -i C:\Users\Ranji\.ssh\id_ed25519 ranjith_vsk@34.143.245.57

# Check status
cd ~/chessguru
pm2 status
curl -s https://harinitharanjith.com/api/health

# FIRST THING: commit current state
git add -A && git commit -m "feat: auth, per-user rating, login page — Apr 25 2026"

# Test user
# URL: harinitharanjith.com/login
# Username: TestUser | Password: test1234

# Tell Claude:
ChessGuru chess puzzle app — harinitharanjith.com
GCP: 34.143.245.57, e2-small, Ubuntu 24.04
Auth: own bcrypt+session system (login.html, auth.js)
Per-user Glicko-2 rating: routes.js GET /api/me/rating + POST /api/puzzles/:id/complete
Test user: TestUser / test1234

Pending:
1. git commit (not done yet!)
2. public/test/ framework for new features
3. Feedback UI (piece.king.white/black + hint button) — test page first
4. OVH migration
5. Delete: lichess_db_puzzle.csv, server.js, server2.js, add_piece_count.js, import2.js

RULE: Every new feature → public/test/feature.html first
       Only after Ranjith confirms → merge to production
```

---

## END OF PROJECT MASTER
## Sessions completed: 4 (full chat)
## ChessGuru live: https://harinitharanjith.com
## Last updated: April 25, 2026
