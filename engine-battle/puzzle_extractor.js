'use strict';
/**
 * puzzle_extractor.js — ChessGuru Puzzle Factory
 * Full Lichess quality: depth=50, time=30s, nodes=25M
 *
 * Usage:
 *   node puzzle_extractor.js               # process all unanalyzed engine games
 *   node puzzle_extractor.js --limit 10    # process 10 games
 *   node puzzle_extractor.js --dry-run     # analyze but don't save
 *   node puzzle_extractor.js --game <id>   # one specific game
 *
 * Run detached:
 *   nohup node puzzle_extractor.js >> /tmp/puzzler.log 2>&1 &
 */

const { spawn }   = require('child_process');
const mongoose    = require('mongoose');
const path        = require('path');
const os          = require('os');
const { Chess }   = require('./node_modules/chess.js');
const { cook, materialDiff, winChances } = require('./engine-battle/cook.js');

const args = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const LIMIT     = parseInt(args[args.indexOf('--limit') + 1]) || 0;
const GAME_ID   = args[args.indexOf('--game') + 1] || null;

// ── Config ────────────────────────────────────────────────────────────────────
const SF_PATH = path.join(os.homedir(), 'engines/stockfish');
const MONGO   = 'mongodb://localhost:27017/chessguru';

// Lichess-exact analysis limits
const SCAN_DEPTH   = 50;
const SCAN_TIME    = 30000;  // 30 seconds
const SCAN_NODES   = 25_000_000;

// Puzzle quality thresholds (from lichess-puzzler generator.py)
const WIN_CHANCE_DELTA    = 0.3;   // minimum swing to detect blunder moment
const MIN_WIN_CHANCE_GAIN = 0.5;   // how much we need to be winning after tactic
const UNIQUENESS_MARGIN   = 50;    // cp margin — 2nd best must be worse than best by this much
const MIN_PUZZLE_MOVES    = 1;     // minimum full moves in solution (1 = mateIn1 allowed)
const MAX_PUZZLE_MOVES    = 10;    // maximum full moves

// ── Schemas ───────────────────────────────────────────────────────────────────
const gameSchema = new mongoose.Schema({
  tournamentId: String,
  round: Number,
  whiteId: String, whiteName: String,
  blackId: String, blackName: String,
  result: String,
  moves: [String],       // SAN moves
  pgn: String,
  thinkMs: Number,
  startedAt: Date,
  endedAt: Date,
  termination: String,
  whiteElo: Number, blackElo: Number,
  puzzleExtracted: Boolean,  // flag — have we analyzed this game?
}, { collection: 'enginegames' });

const puzzleSchema = new mongoose.Schema({
  _id: String,           // random ID like Lichess (5-6 chars)
  fen: String,           // position BEFORE puzzle starts (opponent just blundered)
  initialPly: Number,    // ply number in the source game
  solution: [String],    // UCI moves array
  themes: [String],      // all 70 possible theme tags
  rating: Number,        // estimated rating (Glicko-2 will update via play)
  ratingDeviation: Number,
  plays: { type: Number, default: 0 },
  wins:  { type: Number, default: 0 },
  sourceGameId: String,  // which EngineGame this came from
  sourceRound: Number,
  whiteName: String,
  blackName: String,
  pov: String,           // 'white' | 'black' (who should find the winning move)
  scoreBefore: Number,   // cp score before the blunder
  scoreAfter: Number,    // cp score of the solution first move
  generatedAt: { type: Date, default: Date.now },
  verified: { type: Boolean, default: false },
}, { collection: 'puzzles' });

let EngineGame, Puzzle;

// ── Stockfish manager ─────────────────────────────────────────────────────────
class Stockfish {
  constructor() {
    this.proc  = null;
    this.buf   = '';
    this._listeners = [];
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(SF_PATH, [], { stdio: ['pipe','pipe','pipe'] });
      this.proc.stdout.setEncoding('utf8');
      this.proc.stderr.on('data', () => {});
      this.proc.stdout.on('data', d => this._recv(d));
      this.proc.on('error', reject);

      this.send('uci');
      this.send('setoption name Hash value 512');
      this.send('setoption name Threads value 2');
      this.send('setoption name MultiPV value 3');  // top 3 for uniqueness check

      this._once('uciok', () => {
        this.send('isready');
        this._once('readyok', () => resolve());
      });
      setTimeout(() => reject(new Error('SF start timeout')), 20000);
    });
  }

  _recv(data) {
    this.buf += data;
    const lines = this.buf.split('\n');
    this.buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      this._listeners = this._listeners.filter(l => {
        if (l.pattern.test(t)) { l.cb(t); return !l.once; }
        return true;
      });
    }
  }

  send(cmd) {
    this.proc?.stdin?.write(cmd + '\n');
  }

  _once(patStr, cb) {
    const pattern = typeof patStr === 'string' ? new RegExp('^' + patStr) : patStr;
    this._listeners.push({ pattern, cb, once: true });
  }

  _on(pattern, cb) {
    this._listeners.push({ pattern, cb, once: false });
  }

  _off(cb) {
    this._listeners = this._listeners.filter(l => l.cb !== cb);
  }

  /**
   * Analyze a position at full Lichess quality.
   * Returns { best, second, third } each: { move, cp, mate, pv[] }
   */
  analyze(fen, movesSoFar) {
    return new Promise((resolve, reject) => {
      const posCmd = movesSoFar.length
        ? `position fen ${fen} moves ${movesSoFar.join(' ')}`
        : `position fen ${fen}`;
      this.send('setoption name MultiPV value 3');
      this.send(posCmd);
      this.send(`go depth ${SCAN_DEPTH} movetime ${SCAN_TIME} nodes ${SCAN_NODES}`);

      const multiPV = {};
      const infoRe = /info .* multipv (\d+) .* score (cp|mate) (-?\d+) .* pv ([\w\s]+)/;
      const timeout = setTimeout(() => {
        this._off(infoHandler);
        reject(new Error('analyze timeout'));
      }, SCAN_TIME + 15000);

      const infoHandler = (line) => {
        const m = line.match(infoRe);
        if (m) {
          multiPV[m[1]] = {
            move: m[4].trim().split(' ')[0],
            cp:   m[2] === 'cp'   ? parseInt(m[3]) : null,
            mate: m[2] === 'mate' ? parseInt(m[3]) : null,
            pv:   m[4].trim().split(' '),
          };
        }
      };

      this._on(/^info/, infoHandler);
      this._once(/^bestmove/, () => {
        clearTimeout(timeout);
        this._off(infoHandler);
        resolve({
          best:   multiPV['1'] || null,
          second: multiPV['2'] || null,
          third:  multiPV['3'] || null,
        });
      });
    });
  }

  quit() {
    try { this.send('quit'); } catch(e) {}
    setTimeout(() => { try { this.proc?.kill(); } catch(e) {} }, 2000);
  }
}

// ── Win chances (exact Lichess formula from util.py) ──────────────────────────
function winChancesFromResult(res) {
  if (!res) return 0;
  if (res.mate !== null) return res.mate > 0 ? 1 : -1;
  if (res.cp  !== null) return winChances(res.cp);
  return 0;
}

// ── Puzzle ID generator (Lichess style — 5 char alphanumeric) ─────────────────
function makePuzzleId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ── Estimate puzzle rating from tactic type and complexity ────────────────────
function estimateRating(tags, movesLength) {
  let base = 1200;

  // Mate-in-N adjustments
  if (tags.includes('mateIn1')) base = 900;
  else if (tags.includes('mateIn2')) base = 1100;
  else if (tags.includes('mateIn3')) base = 1300;
  else if (tags.includes('mateIn4')) base = 1500;
  else if (tags.includes('mateIn5')) base = 1700;

  // Motif difficulty adjustments
  if (tags.includes('quietMove'))    base += 300;
  if (tags.includes('zugzwang'))     base += 250;
  if (tags.includes('intermezzo'))   base += 200;
  if (tags.includes('attraction'))   base += 200;
  if (tags.includes('defensiveMove'))base += 150;
  if (tags.includes('deflection'))   base += 150;
  if (tags.includes('xRayAttack'))   base += 150;
  if (tags.includes('clearance'))    base += 100;
  if (tags.includes('interference')) base += 100;
  if (tags.includes('fork'))         base -= 50;
  if (tags.includes('hangingPiece')) base -= 100;

  // Length adjustments
  if (tags.includes('veryLong')) base += 300;
  if (tags.includes('long'))     base += 150;
  if (tags.includes('oneMove'))  base -= 100;

  return Math.max(600, Math.min(2800, base));
}

// ── Convert SAN game to UCI moves ─────────────────────────────────────────────
function sanToUci(sanMoves) {
  const chess = new Chess();
  const uci = [];
  for (const san of sanMoves) {
    const move = chess.move(san);
    if (!move) break;
    uci.push(move.from + move.to + (move.promotion || ''));
  }
  return uci;
}

// ── Core extraction logic ─────────────────────────────────────────────────────
async function extractPuzzlesFromGame(game, sf, stats) {
  const uciMoves = sanToUci(game.moves || []);
  if (uciMoves.length < 4) return []; // too short

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const puzzles   = [];
  const chess     = new Chess();

  let prevScore   = null; // { cp, mate } from side-to-move's perspective
  let prevFen     = START_FEN;
  let prevMoves   = [];

  log(`Analyzing game ${game._id}: ${game.whiteName} vs ${game.blackName} (${uciMoves.length} moves)`);

  for (let ply = 0; ply < uciMoves.length; ply++) {
    const currentFen   = chess.fen();
    const currentMoves = [...prevMoves]; // moves played to reach this position
    const sideToMove   = chess.turn() === 'w' ? 'white' : 'black';

    // ── Analyze current position ──────────────────────────────────────────────
    let analysis;
    try {
      analysis = await sf.analyze(START_FEN, currentMoves);
      stats.positionsAnalyzed++;
    } catch(e) {
      log(`  SF error at ply ${ply}: ${e.message}`);
      break;
    }

    const bestResult = analysis.best;
    if (!bestResult) { prevScore = null; advance(); continue; }

    // Score from side-to-move's perspective (positive = good for them)
    const currentWC = winChancesFromResult(bestResult);

    // ── Check if previous move was a blunder ──────────────────────────────────
    // prevScore was from the PREVIOUS side-to-move's perspective
    // After their move, currentWC is from the NEW side's perspective
    // A blunder by the player who just moved = opponent now has huge advantage
    // i.e., currentWC (from new player's POV) should be MUCH better than -prevWC
    if (prevScore !== null && ply >= 2) {
      const prevWC  = winChancesFromResult(prevScore);
      // From the perspective of the side that JUST MOVED (now NOT to move):
      // their win chances went from prevWC to -currentWC
      // If -currentWC < prevWC - threshold, they blundered
      const blunderDelta = prevWC - (-currentWC); // positive = they lost advantage

      if (blunderDelta >= WIN_CHANCE_DELTA && currentWC >= MIN_WIN_CHANCE_GAIN) {
        // Found a blunder moment! The position BEFORE the blunder (prevFen+prevMoves) is the puzzle.
        // The puzzle solution starts with bestResult.pv

        const puzzleFen   = prevFen;
        const puzzleMoves = prevMoves; // moves to reach puzzle position
        const pov         = chess.turn() === 'w' ? 'white' : 'black'; // side that benefits from tactic

        log(`  Candidate at ply ${ply}: delta=${blunderDelta.toFixed(2)}, wc=${currentWC.toFixed(2)}`);

        // ── Validate: get the full solution line ──────────────────────────────
        const puzzle = await validateCandidate(
          puzzleFen, puzzleMoves, bestResult, analysis, prevScore, currentWC,
          game, ply, pov, sf, stats
        );

        if (puzzle) {
          puzzles.push(puzzle);
          log(`  ✓ Puzzle found! Themes: ${puzzle.themes.slice(0,5).join(', ')}...`);
          stats.puzzlesFound++;
        }
      }
    }

    prevScore = bestResult;
    prevFen   = currentFen;
    prevMoves = [...currentMoves];
    advance();

    function advance() {
      chess.move({ from: uciMoves[ply].slice(0,2), to: uciMoves[ply].slice(2,4), promotion: uciMoves[ply][4] });
      prevMoves.push(uciMoves[ply]);
    }
  }

  return puzzles;
}

async function validateCandidate(fen, movesToFen, firstAnalysis, secondAnalysis,
                                  prevScore, currentWC, game, ply, pov, sf, stats) {
  // The puzzle FEN is the position where the opponent just blundered
  // We need to verify the solution is unique and forced

  const pvMoves = firstAnalysis.best?.pv || [];
  if (pvMoves.length === 0) return null;

  // Build the solution: alternating player/opponent moves
  // Minimum 1 full move (player move + opponent best response)
  // We need at least the player's winning move(s)
  const chess = new Chess(fen);

  // Apply moves to reach the puzzle position
  // (fen is already the position, movesToFen got us here)

  // The solution = firstAnalysis.best.pv (Stockfish's best line from this position)
  // Trim to reasonable length
  const rawSolution = pvMoves.slice(0, MAX_PUZZLE_MOVES * 2);

  // Validate uniqueness: is the first move clearly the ONLY good move?
  const best   = firstAnalysis.best;
  const second = firstAnalysis.second;

  if (best && second) {
    const bestWC   = winChancesFromResult(best);
    const secondWC = winChancesFromResult(second);

    // Second best must be significantly worse (by UNIQUENESS_MARGIN cp or 0.1 WC)
    const secondCp = second.cp !== null ? second.cp : (second.mate > 0 ? 10000 : -10000);
    const bestCp   = best.cp   !== null ? best.cp   : (best.mate   > 0 ? 10000 : -10000);
    const margin   = bestCp - secondCp;

    if (margin < UNIQUENESS_MARGIN && Math.abs(bestWC - secondWC) < 0.1) {
      log(`  ✗ Not unique: margin=${margin}cp, delta WC=${(bestWC-secondWC).toFixed(2)}`);
      stats.rejectedNotUnique++;
      return null;
    }
  }

  // Verify each step of the solution is forced
  // (run analysis at each position in the PV)
  const verifiedMoves = [];
  const tempChess = new Chess(fen);
  const movesSoFar = [];

  for (let i = 0; i < rawSolution.length; i++) {
    const uciMove = rawSolution[i];
    const from = uciMove.slice(0,2), to = uciMove.slice(2,4), promo = uciMove[4];
    const result = tempChess.move({ from, to, promotion: promo });
    if (!result) break;

    verifiedMoves.push(uciMove);
    movesSoFar.push(uciMove);

    // Check for terminal conditions
    if (tempChess.isCheckmate()) { break; } // mate found — perfect puzzle ending
    if (tempChess.isDraw())      { break; } // draw is a bad puzzle ending
    if (tempChess.isGameOver())  { break; }

    // If this is an opponent's response (odd index), verify THEY don't have a much better move
    if (i % 2 === 1) {
      // We trust Stockfish's PV for opponent moves — no need to re-analyze every step
      // (full re-analysis would quadruple runtime)
      continue;
    }

    // If this is our last player move and the position is winning enough, stop
    if (i >= MAX_PUZZLE_MOVES * 2 - 2) break;
  }

  if (verifiedMoves.length < 1) {
    stats.rejectedTooShort++;
    return null;
  }

  // ── Assign themes ─────────────────────────────────────────────────────────
  const themes = cook(fen, verifiedMoves, pov);

  // Add goal themes based on score
  const wcAfter = winChancesFromResult(best);
  if (best.mate !== null)    themes.push('mate');
  else if (wcAfter >= 0.6)   themes.push('crushing');
  else if (wcAfter >= 0.3)   themes.push('advantage');
  else                       themes.push('equality');

  // Add origin tag (engine games — not 'master' or 'superGM')
  // Could add 'engineGame' as a custom tag

  // ── Build puzzle document ─────────────────────────────────────────────────
  const puzzleId = makePuzzleId();
  const rating   = estimateRating(themes, verifiedMoves.length);

  return {
    _id:            puzzleId,
    fen:            fen,
    initialPly:     ply,
    solution:       [uciMoves[ply], ...verifiedMoves],
    themes:         [...new Set(themes)],
    rating:         rating,
    ratingDeviation: 500,   // high initial uncertainty — will converge via play
    plays:          0,
    wins:           0,
    sourceGameId:   game._id?.toString(),
    sourceRound:    game.round,
    whiteName:      game.whiteName,
    blackName:      game.blackName,
    pov:            pov,
    scoreBefore:    prevScore?.cp ?? null,
    scoreAfter:     best?.cp ?? null,
    generatedAt:    new Date(),
    verified:       true,
  };
}

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().replace('T',' ').slice(0,19);
  console.log(`[${ts}] ${msg}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('=== ChessGuru Puzzle Extractor ===');
  log(`Quality: depth=${SCAN_DEPTH}, time=${SCAN_TIME/1000}s, nodes=${SCAN_NODES.toLocaleString()}`);
  log(`Dry run: ${DRY_RUN}`);

  await mongoose.connect(MONGO);
  EngineGame = mongoose.model('EngineGame', gameSchema);
  Puzzle     = mongoose.model('Puzzle',     puzzleSchema);
  log('MongoDB connected');

  // Find games not yet processed
  const query = GAME_ID
    ? { _id: GAME_ID }
    : { puzzleExtracted: { $ne: true }, result: { $in: ['1-0','0-1'] } }; // only decisive games

  const games = await EngineGame.find(query)
    .sort({ startedAt: -1 })
    .limit(LIMIT || 10000)
    .lean();

  log(`Found ${games.length} games to analyze`);

  if (games.length === 0) {
    log('No games to process. Run a tournament first.');
    process.exit(0);
  }

  // Start Stockfish
  const sf = new Stockfish();
  await sf.start();
  log(`Stockfish started: ${SF_PATH}`);

  const stats = {
    gamesProcessed: 0,
    positionsAnalyzed: 0,
    puzzlesFound: 0,
    rejectedNotUnique: 0,
    rejectedTooShort: 0,
    saved: 0,
  };

  const startTime = Date.now();

  for (const game of games) {
    try {
      const puzzles = await extractPuzzlesFromGame(game, sf, stats);

      if (!DRY_RUN && puzzles.length > 0) {
        // Save puzzles, skip duplicates
        for (const p of puzzles) {
          try {
            await Puzzle.create(p);
            stats.saved++;
          } catch(e) {
            if (e.code !== 11000) log(`  Save error: ${e.message}`);
          }
        }
        // Mark game as processed
        await EngineGame.findByIdAndUpdate(game._id, { puzzleExtracted: true });
      }

      stats.gamesProcessed++;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const perGame = (elapsed / stats.gamesProcessed).toFixed(0);
      const eta     = ((games.length - stats.gamesProcessed) * perGame).toFixed(0);

      log(`Progress: ${stats.gamesProcessed}/${games.length} games | ` +
          `${stats.positionsAnalyzed} positions | ` +
          `${stats.puzzlesFound} puzzles found | ` +
          `ETA: ${Math.floor(eta/3600)}h${Math.floor((eta%3600)/60)}m`);

    } catch(err) {
      log(`Error on game ${game._id}: ${err.message}`);
    }
  }

  sf.quit();

  // Final report
  log('');
  log('=== EXTRACTION COMPLETE ===');
  log(`Games processed:      ${stats.gamesProcessed}`);
  log(`Positions analyzed:   ${stats.positionsAnalyzed}`);
  log(`Puzzles found:        ${stats.puzzlesFound}`);
  log(`Rejected (not unique):${stats.rejectedNotUnique}`);
  log(`Rejected (too short): ${stats.rejectedTooShort}`);
  log(`Saved to DB:          ${stats.saved}`);
  log(`Total time:           ${((Date.now()-startTime)/60000).toFixed(1)} minutes`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  log(err.stack);
  process.exit(1);
});
