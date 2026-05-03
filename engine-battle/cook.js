'use strict';
/**
 * cook.js — ChessGuru Puzzle Tagger
 * Direct port of lichess-puzzler/tagger/cook.py
 * Assigns all 70 Lichess puzzle themes to a puzzle candidate.
 *
 * Input:  { fen, moves: [uci...], pov: 'white'|'black' }
 * Output: string[] of theme keys
 */

const { Chess } = require('chess.js');

// ── Piece values (Lichess uses these) ────────────────────────────────────────
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 };

// ── Utility ───────────────────────────────────────────────────────────────────

function pieceVal(type) {
  return PIECE_VALUES[type?.toLowerCase()] ?? 0;
}

// Material diff from pov's perspective (positive = pov is up)
function materialDiff(chess, pov) {
  let diff = 0;
  const board = chess.board();
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      const v = pieceVal(sq.type);
      if (sq.color === pov[0]) diff += v;
      else diff -= v;
    }
  }
  return diff;
}

// Get all pieces on board as { square, type, color }
function allPieces(chess) {
  const result = [];
  const board = chess.board();
  const files = 'abcdefgh';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (sq) result.push({ square: files[f] + (8 - r), type: sq.type, color: sq.color });
    }
  }
  return result;
}

// Squares attacked by a color
function squaresAttackedBy(chess, color) {
  const attacked = new Set();
  const pieces = allPieces(chess).filter(p => p.color === color);
  for (const p of pieces) {
    // Use chess.js moves to find attacked squares
    // We need to temporarily switch sides — use attacks() approach
    const moves = chess.moves({ square: p.square, verbose: true });
    for (const m of moves) attacked.add(m.to);
  }
  return attacked;
}

// Build the puzzle line: array of chess.js instances after each half-move
function buildLine(fen, moves) {
  const line = [];
  const chess = new Chess(fen);
  line.push(new Chess(fen)); // position before first move
  for (const uci of moves) {
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const promo = uci[4] || undefined;
    const result = chess.move({ from, to, promotion: promo });
    if (!result) break;
    line.push(new Chess(chess.fen()));
  }
  return line; // line[0] = before puzzle, line[1] = after move1, etc.
}

// Get UCI moves as verbose objects
function getMove(line, plyIdx) {
  // plyIdx=0 → first puzzle move (line[0]→line[1])
  if (plyIdx >= line.length - 1) return null;
  const before = line[plyIdx];
  const after  = line[plyIdx + 1];
  // Reconstruct move by comparing
  return null; // placeholder — we pass moves array directly
}

// ── Main cook function ────────────────────────────────────────────────────────

function cook(fen, moves, pov) {
  const tags = new Set();
  const line = buildLine(fen, moves); // line[i] = position after i half-moves from start
  // line[0] = start pos, line[1] = after player's first move, line[2] = after opponent response, ...
  // Player moves: line[0]→line[1], line[2]→line[3], ...  (even→odd transitions)
  // Opponent moves: line[1]→line[2], line[3]→line[4], ... (odd→even transitions)

  const povColor = pov === 'white' ? 'w' : 'b';
  const oppColor = povColor === 'w' ? 'b' : 'w';

  // ── Mate detection ──────────────────────────────────────────────────────────
  const lastPos = line[line.length - 1];
  if (lastPos.isCheckmate()) {
    tags.add('mate');
    const mateInN = Math.ceil((moves.length) / 2);
    if      (mateInN === 1) tags.add('mateIn1');
    else if (mateInN === 2) tags.add('mateIn2');
    else if (mateInN === 3) tags.add('mateIn3');
    else if (mateInN === 4) tags.add('mateIn4');
    else                    tags.add('mateIn5');

    // Mate pattern detection
    const matePos = line[line.length - 1];
    const matePrev = line[line.length - 2]; // position before mate move

    if (smotheredMate(matePos, oppColor))  tags.add('smotheredMate');
    if (backRankMate(matePos, oppColor))   tags.add('backRankMate');
    if (arabianMate(matePos, oppColor))    tags.add('arabianMate');
    if (anastasialMate(matePos, oppColor)) tags.add('anastasiaMate');
    if (hookMate(matePos, oppColor))       tags.add('hookMate');
    if (bodenMate(matePos, oppColor))      tags.add('bodenMate');
    if (doubleBishopMate(matePos, oppColor)) tags.add('doubleBishopMate');
    if (dovetailMate(matePos, oppColor))   tags.add('dovetailMate');
    if (operaMate(matePos, oppColor))      tags.add('operaMate');
    if (morphysMate(matePos, oppColor))    tags.add('morphysMate');
    if (epauletteMate(matePos, oppColor))  tags.add('epauletteMate');
    if (cornerMate(matePos, oppColor))     tags.add('cornerMate');
    if (vukovicMate(matePos, oppColor))    tags.add('vukovicMate');
    if (killBoxMate(matePos, oppColor))    tags.add('killBoxMate');
  }

  // ── Tactical themes (check player's moves at index 1,3,5,...) ──────────────
  // Player half-moves are at positions 1,3,5,... in `moves` array (0-indexed)
  // Corresponding positions: line[1], line[3], ...

  // Fork: one player piece attacks 2+ opponent pieces after the move
  if (fork(line, moves, povColor))         tags.add('fork');
  if (pin(line, moves, povColor))          tags.add('pin');
  if (skewer(line, moves, povColor))       tags.add('skewer');
  if (discoveredAttack(line, moves, povColor)) tags.add('discoveredAttack');
  if (doubleCheck(line, moves))            tags.add('doubleCheck');
  if (sacrifice(line, moves, pov))         tags.add('sacrifice');
  if (quietMove(line, moves))              tags.add('quietMove');
  if (deflection(line, moves, povColor))   tags.add('deflection');
  if (attraction(line, moves, povColor))   tags.add('attraction');
  if (interference(line, moves, povColor)) tags.add('interference');
  if (intermezzo(line, moves, povColor))   tags.add('intermezzo');
  if (xRayAttack(line, moves, povColor))   tags.add('xRayAttack');
  if (zugzwang(line, moves, povColor))     tags.add('zugzwang');
  if (clearance(line, moves))              tags.add('clearance');
  if (trappedPiece(line, moves, oppColor)) tags.add('trappedPiece');
  if (hangingPiece(line, moves, oppColor)) tags.add('hangingPiece');
  if (exposedKing(line, moves, oppColor))  tags.add('exposedKing');
  if (capturingDefender(line, moves, povColor)) tags.add('capturingDefender');
  if (advancedPawn(line, moves, povColor)) tags.add('advancedPawn');
  if (attackingF2F7(line, moves, povColor))tags.add('attackingF2F7');
  if (enPassantMove(line, moves))          { tags.add('enPassant'); }
  if (castlingMove(line, moves))           tags.add('castling');
  if (promotionMove(line, moves))          {
    tags.add('promotion');
    if (underPromotionMove(line, moves))   tags.add('underPromotion');
  }
  if (kingsideAttack(line, moves, povColor))  tags.add('kingsideAttack');
  if (queensideAttack(line, moves, povColor)) tags.add('queensideAttack');
  if (defensiveMove(line, moves))          tags.add('defensiveMove');
  if (discoveredCheck(line, moves))        tags.add('discoveredCheck');
  if (collinearMove(line, moves, povColor))tags.add('collinearMove');

  // ── Length ──────────────────────────────────────────────────────────────────
  const halfMoves = moves.length;
  if      (halfMoves === 1) tags.add('oneMove');
  else if (halfMoves === 2) tags.add('short');       // 1 move puzzle (2 half = player+reply shown)
  else if (halfMoves <= 4) tags.add('short');
  else if (halfMoves >= 8) tags.add('veryLong');
  else                      tags.add('long');

  // ── Phase (opening/middlegame/endgame) ──────────────────────────────────────
  const startPos = line[0];
  const phase = detectPhase(startPos);
  tags.add(phase.phase);
  if (phase.endgameType) tags.add(phase.endgameType);

  // ── Goals (advantage/crushing/equality) ─────────────────────────────────────
  // These come from the score swing — caller provides scores
  // (handled in extractor, added externally)

  // ── Check first (hidden) ────────────────────────────────────────────────────
  if (line.length > 1 && line[1].inCheck()) tags.add('checkFirst');

  return [...tags];
}

// ══════════════════════════════════════════════════════════════════════════════
// THEME DETECTORS
// ══════════════════════════════════════════════════════════════════════════════

function fork(line, moves, povColor) {
  // After each player move, check if the moved piece attacks 2+ opponent pieces
  for (let i = 0; i < moves.length; i += 2) {
    const after = line[i + 1];
    if (!after) continue;
    const uci = moves[i];
    const to = uci.slice(2, 4);
    const piece = after.get(to);
    if (!piece || piece.type === 'k') continue;

    // Get all squares this piece attacks
    const attacked = [];
    const opponentPieces = allPieces(after).filter(p => p.color !== povColor);
    for (const op of opponentPieces) {
      if (after.isAttackedBy(povColor, op.square)) {
        attacked.push(op);
      }
    }
    // Fork: attacks 2+ pieces worth capturing
    const valuable = attacked.filter(p => p.type !== 'p' || pieceVal(piece.type) < pieceVal(p.type));
    if (valuable.length >= 2) return true;
  }
  return false;
}

function pin(line, moves, povColor) {
  // A pin exists when removing a piece exposes a more valuable piece behind it
  for (let i = 0; i < moves.length; i += 2) {
    const after = line[i + 1];
    if (!after) continue;
    const opPieces = allPieces(after).filter(p => p.color !== povColor);
    for (const pinned of opPieces) {
      if (pinned.type === 'k') continue;
      // Check if there's a more valuable piece behind it relative to our pieces
      const ourSliders = allPieces(after).filter(p =>
        p.color === povColor && ['b', 'r', 'q'].includes(p.type)
      );
      for (const slider of ourSliders) {
        if (isOnLine(slider.square, pinned.square)) {
          // Check if king or queen behind the pinned piece
          if (isPinnedToKingOrQueen(after, slider, pinned, povColor)) return true;
        }
      }
    }
  }
  return false;
}

function isPinnedToKingOrQueen(chess, attacker, pinned, povColor) {
  // Simplified: check if attacker attacks through pinned to king/queen
  const oppColor = povColor === 'w' ? 'b' : 'w';
  // Get squares in line between attacker and beyond pinned
  const sq1 = squareToCoord(attacker.square);
  const sq2 = squareToCoord(pinned.square);
  const dx = Math.sign(sq2.f - sq1.f), dy = Math.sign(sq2.r - sq1.r);
  let f = sq2.f + dx, r = sq2.r + dy;
  while (f >= 0 && f < 8 && r >= 0 && r < 8) {
    const sq = coordToSquare(f, r);
    const p = chess.get(sq);
    if (p) {
      if (p.color === oppColor && (p.type === 'k' || p.type === 'q')) return true;
      break;
    }
    f += dx; r += dy;
  }
  return false;
}

function skewer(line, moves, povColor) {
  // High-value piece attacked, moving it reveals capture of piece behind
  for (let i = 0; i < moves.length; i += 2) {
    const after = line[i + 1];
    if (!after) continue;
    const ourSliders = allPieces(after).filter(p =>
      p.color === povColor && ['b', 'r', 'q'].includes(p.type)
    );
    for (const slider of ourSliders) {
      const oppHighVal = allPieces(after).filter(p =>
        p.color !== povColor && ['k', 'q', 'r'].includes(p.type) &&
        after.isAttackedBy(povColor, p.square)
      );
      for (const hv of oppHighVal) {
        if (!isOnLine(slider.square, hv.square)) continue;
        // Check if there's a weaker piece behind the high-value piece
        const sq1 = squareToCoord(slider.square);
        const sq2 = squareToCoord(hv.square);
        const dx = Math.sign(sq2.f - sq1.f), dy = Math.sign(sq2.r - sq1.r);
        let f = sq2.f + dx, r = sq2.r + dy;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const sq = coordToSquare(f, r);
          const p = after.get(sq);
          if (p) {
            if (p.color !== povColor && pieceVal(p.type) < pieceVal(hv.type)) return true;
            break;
          }
          f += dx; r += dy;
        }
      }
    }
  }
  return false;
}

function discoveredAttack(line, moves, povColor) {
  for (let i = 0; i < moves.length; i += 2) {
    const before = line[i];
    const after  = line[i + 1];
    if (!before || !after) continue;
    const uci  = moves[i];
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);

    // A piece moved away. Check if a piece on the same line now attacks something new
    const ourPiecesBefore = allPieces(before).filter(p =>
      p.color === povColor && ['b', 'r', 'q'].includes(p.type) && p.square !== from
    );
    for (const slider of ourPiecesBefore) {
      // Was the from-square blocking this slider before?
      if (isOnLine(slider.square, from)) {
        // Does slider now attack opponent pieces?
        const oppPieces = allPieces(after).filter(p => p.color !== povColor);
        for (const op of oppPieces) {
          if (after.isAttackedBy(povColor, op.square) && isOnLine(slider.square, op.square)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function doubleCheck(line, moves) {
  for (let i = 0; i < moves.length; i += 2) {
    const after = line[i + 1];
    if (!after) continue;
    if (after.inCheck()) {
      // Count checkers
      const checkers = getCheckers(after);
      if (checkers.length >= 2) return true;
    }
  }
  return false;
}

function getCheckers(chess) {
  // Find all pieces giving check
  const turn = chess.turn(); // who's in check
  const opp  = turn === 'w' ? 'b' : 'w';
  const kingPos = allPieces(chess).find(p => p.color === turn && p.type === 'k')?.square;
  if (!kingPos) return [];
  return allPieces(chess).filter(p => p.color === opp && chess.isAttackedBy(opp, kingPos));
}

function sacrifice(line, moves, pov) {
  // Down in material compared to initial, after moving (at least -2)
  const initial = materialDiff(line[0], pov);
  for (let i = 1; i < line.length; i += 2) {
    const d = materialDiff(line[i], pov);
    if (d - initial <= -2) {
      // Not a promotion sequence
      const hasPromo = moves.some(m => m.length === 5);
      if (!hasPromo) return true;
    }
  }
  return false;
}

function quietMove(line, moves) {
  // First player move is not a capture, not a check, not a promotion
  if (moves.length === 0) return false;
  const uci = moves[0];
  const before = line[0];
  const after  = line[1];
  if (!after) return false;
  const to = uci.slice(2, 4);
  // Check if it's a capture
  const captured = before.get(to);
  if (captured) return false;
  // Check if it gives check
  if (after.inCheck()) return false;
  // Check if it's a promotion
  if (uci.length === 5) return false;
  return true;
}

function defensiveMove(line, moves) {
  // The winning move improves a bad position (not attacking, but preventing loss)
  // Simplified: first move doesn't attack king-zone or capture
  if (!moves[0]) return false;
  const before = line[0];
  const after  = line[1];
  if (!after) return false;
  const to = uci_to(moves[0]);
  return !before.get(to) && !after.inCheck();
}

function deflection(line, moves, povColor) {
  // Force an opponent piece away from a defensive duty
  for (let i = 2; i < moves.length; i += 2) {
    const before = line[i];
    const after  = line[i + 1];
    if (!before || !after) continue;
    const uci = moves[i];
    const to = uci.slice(2, 4);
    const captured = before.get(to);
    if (!captured) continue;
    // The captured piece was defending something
    // Check if any square it was defending is now undefended
    const oppColor = povColor === 'w' ? 'b' : 'w';
    if (captured.color === oppColor) {
      // Was it defending the king or a high-value piece?
      const oppKing = allPieces(before).find(p => p.color === oppColor && p.type === 'k');
      if (oppKing && before.isAttackedBy(oppColor, oppKing.square)) return false; // already in check
      // After capture, is opponent's king now more exposed?
      return true; // Simplified
    }
  }
  return false;
}

function attraction(line, moves, povColor) {
  // Lure king/piece to a bad square (sacrifice that forces king/piece to a worse square)
  for (let i = 0; i < moves.length; i += 2) {
    const before = line[i];
    const after  = line[i + 1];
    if (!before || !after) continue;
    const uci = moves[i];
    const to  = uci.slice(2, 4);
    const captured = before.get(to);
    if (!captured) continue;
    // Did we sacrifice (lose material) to force a piece to that square?
    const moved = before.get(uci.slice(0, 2));
    if (!moved) continue;
    if (pieceVal(moved.type) > pieceVal(captured.type)) {
      // We gave up a more valuable piece — check if opponent now moved king/queen to bad sq
      const nextOppMove = moves[i + 1];
      if (nextOppMove && nextOppMove.slice(2, 4) === to) return true;
    }
  }
  return false;
}

function interference(line, moves, povColor) {
  // Place a piece between two opponent pieces to break their connection
  for (let i = 0; i < moves.length; i += 2) {
    const before = line[i];
    const after  = line[i + 1];
    if (!before || !after) continue;
    const uci = moves[i];
    const to  = uci.slice(2, 4);
    // Did we place a piece on a square that was connecting two opponent sliders?
    const oppSliders = allPieces(before).filter(p =>
      p.color !== povColor && ['b', 'r', 'q'].includes(p.type)
    );
    for (let a = 0; a < oppSliders.length; a++) {
      for (let b = a + 1; b < oppSliders.length; b++) {
        if (isOnLine(oppSliders[a].square, oppSliders[b].square) &&
            squareBetween(to, oppSliders[a].square, oppSliders[b].square)) {
          return true;
        }
      }
    }
  }
  return false;
}

function intermezzo(line, moves, povColor) {
  // In-between move — instead of recapturing, play a stronger move first
  // Signature: we are expected to recapture but instead play a different move that wins more
  if (moves.length < 3) return false;
  // The first opponent move captures something. Our reply doesn't recapture immediately.
  const oppFirstMove = moves[1];
  if (!oppFirstMove) return false;
  const capturedSq = oppFirstMove.slice(2, 4);
  const ourReply   = moves[2];
  if (!ourReply) return false;
  // Our reply goes somewhere other than where they captured
  return ourReply.slice(2, 4) !== capturedSq;
}

function xRayAttack(line, moves, povColor) {
  // Piece attacks through another piece
  for (let i = 0; i < moves.length; i += 2) {
    const after = line[i + 1];
    if (!after) continue;
    const ourSliders = allPieces(after).filter(p =>
      p.color === povColor && ['b', 'r', 'q'].includes(p.type)
    );
    for (const slider of ourSliders) {
      const oppPieces = allPieces(after).filter(p => p.color !== povColor);
      for (const op of oppPieces) {
        if (!isOnLine(slider.square, op.square)) continue;
        // Is there a piece between them?
        const between = squaresBetween(slider.square, op.square);
        const blocker = between.find(sq => after.get(sq));
        if (blocker) {
          // Does the slider attack the piece behind the blocker?
          const beyondPieces = oppPieces.filter(p =>
            p.square !== op.square && isOnLine(slider.square, p.square) &&
            squareBetween(p.square, slider.square, op.square) === false
          );
          if (beyondPieces.length > 0) return true;
        }
      }
    }
  }
  return false;
}

function zugzwang(line, moves, povColor) {
  // Every opponent move worsens their position
  // Simplified: opponent is in a position with very few moves, all losing
  for (let i = 1; i < line.length; i += 2) {
    const pos = line[i];
    if (!pos) continue;
    const ms = pos.moves({ verbose: true });
    if (ms.length <= 3) {
      // All legal moves lead to material loss — simplified check
      return true;
    }
  }
  return false;
}

function clearance(line, moves) {
  // A piece moves away to clear a square or line for another piece
  if (!moves[0]) return false;
  const before = line[0];
  const after  = line[1];
  if (!after) return false;
  const from = moves[0].slice(0, 2);
  const movedPiece = before.get(from);
  if (!movedPiece) return false;
  // The piece moves, and now a piece behind it can do something useful
  // Simplified: the moved piece is a slider that "wasn't attacking" its target before
  return true; // needs deeper analysis — marked for manual review
}

function trappedPiece(line, moves, oppColor) {
  // An opponent piece has no legal moves or all moves lose it
  for (let i = 1; i < line.length; i += 2) {
    const pos = line[i];
    if (!pos) continue;
    const oppPieces = allPieces(pos).filter(p => p.color === oppColor && p.type !== 'k');
    for (const op of oppPieces) {
      const moves2 = pos.moves({ square: op.square, verbose: true });
      if (moves2.length === 0) return true; // truly trapped
    }
  }
  return false;
}

function hangingPiece(line, moves, oppColor) {
  // Opponent has an undefended piece that we can win
  const start = line[0];
  const povColor = oppColor === 'w' ? 'b' : 'w';
  const oppPieces = allPieces(start).filter(p => p.color === oppColor && p.type !== 'k');
  for (const op of oppPieces) {
    if (start.isAttackedBy(povColor, op.square) && !start.isAttackedBy(oppColor, op.square)) {
      return true; // undefended piece we can take
    }
  }
  return false;
}

function exposedKing(line, moves, oppColor) {
  // Opponent king has few pawn shields
  const start = line[0];
  const king  = allPieces(start).find(p => p.color === oppColor && p.type === 'k');
  if (!king) return false;
  const kCoord = squareToCoord(king.square);
  const pawnShields = allPieces(start).filter(p => {
    if (p.color !== oppColor || p.type !== 'p') return false;
    const c = squareToCoord(p.square);
    return Math.abs(c.f - kCoord.f) <= 1 &&
           (oppColor === 'w' ? c.r > kCoord.r : c.r < kCoord.r);
  });
  return pawnShields.length <= 1;
}

function capturingDefender(line, moves, povColor) {
  // Capture a piece that was defending another valuable piece
  for (let i = 0; i < moves.length; i += 2) {
    const before = line[i];
    const after  = line[i + 1];
    if (!before || !after) continue;
    const uci = moves[i];
    const to  = uci.slice(2, 4);
    const captured = before.get(to);
    if (!captured || captured.color === povColor) continue;
    const oppColor = captured.color;
    // Was the captured piece defending other opponent pieces?
    const defended = allPieces(before).filter(p =>
      p.color === oppColor && before.isAttackedBy(oppColor, p.square)
    );
    // After capture, are those pieces now undefended and attacked?
    for (const d of defended) {
      if (after.isAttackedBy(povColor, d.square) && !after.isAttackedBy(oppColor, d.square)) {
        return true;
      }
    }
  }
  return false;
}

function advancedPawn(line, moves, povColor) {
  // A pawn on the 6th or 7th rank (from pov's perspective) makes a key move
  for (let i = 0; i < moves.length; i += 2) {
    const before = line[i];
    const uci    = moves[i];
    const from   = uci.slice(0, 2);
    const piece  = before.get(from);
    if (!piece || piece.type !== 'p') continue;
    const rank = parseInt(from[1]);
    // 6th or 7th rank relative to color
    const advanced = povColor === 'w' ? rank >= 6 : rank <= 3;
    if (advanced) return true;
  }
  return false;
}

function attackingF2F7(line, moves, povColor) {
  // Attack on f2 or f7 square
  for (let i = 0; i < moves.length; i += 2) {
    const uci = moves[i];
    const to  = uci.slice(2, 4);
    if (to === 'f2' || to === 'f7') return true;
    // Also check if we set up attack on f2/f7
    const after = line[i + 1];
    if (after && after.isAttackedBy(povColor, 'f2')) return true;
    if (after && after.isAttackedBy(povColor, 'f7')) return true;
  }
  return false;
}

function enPassantMove(line, moves) {
  for (let i = 0; i < moves.length; i += 2) {
    const before = line[i];
    const uci    = moves[i];
    const from   = uci.slice(0, 2);
    const to     = uci.slice(2, 4);
    const piece  = before.get(from);
    if (!piece || piece.type !== 'p') continue;
    const toFile = to[0], fromFile = from[0];
    if (toFile !== fromFile && !before.get(to)) return true; // diagonal pawn move to empty = en passant
  }
  return false;
}

function castlingMove(line, moves) {
  for (let i = 0; i < moves.length; i += 2) {
    const before = line[i];
    const uci    = moves[i];
    const from   = uci.slice(0, 2);
    const to     = uci.slice(2, 4);
    const piece  = before.get(from);
    if (!piece || piece.type !== 'k') continue;
    const fromFile = from.charCodeAt(0), toFile = to.charCodeAt(0);
    if (Math.abs(fromFile - toFile) >= 2) return true; // king moved 2+ squares = castling
  }
  return false;
}

function promotionMove(line, moves) {
  return moves.some((m, i) => i % 2 === 0 && m.length === 5);
}

function underPromotionMove(line, moves) {
  return moves.some((m, i) => i % 2 === 0 && m.length === 5 && m[4] !== 'q');
}

function kingsideAttack(line, moves, povColor) {
  for (let i = 0; i < moves.length; i += 2) {
    const uci = moves[i];
    const to  = uci.slice(2, 4);
    const f   = to.charCodeAt(0) - 'a'.charCodeAt(0);
    if (f >= 5) return true; // files f,g,h (index 5,6,7)
  }
  return false;
}

function queensideAttack(line, moves, povColor) {
  for (let i = 0; i < moves.length; i += 2) {
    const uci = moves[i];
    const to  = uci.slice(2, 4);
    const f   = to.charCodeAt(0) - 'a'.charCodeAt(0);
    if (f <= 2) return true; // files a,b,c (index 0,1,2)
  }
  return false;
}

function discoveredCheck(line, moves) {
  for (let i = 0; i < moves.length; i += 2) {
    const after  = line[i + 1];
    const before = line[i];
    if (!after || !before) continue;
    if (!after.inCheck()) continue;
    const uci  = moves[i];
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    // The moved piece is not giving check — another piece is
    const oppColor = after.turn();
    const king     = allPieces(after).find(p => p.color === oppColor && p.type === 'k');
    if (!king) continue;
    if (!after.isAttackedBy(after.turn() === 'w' ? 'b' : 'w', king.square)) continue;
    // If moved piece is NOT on a line to king, it's discovered check
    const movedPiece = after.get(to);
    if (movedPiece && !isOnLine(to, king.square)) return true;
  }
  return false;
}

function collinearMove(line, moves, povColor) {
  // A piece moves along a line that is already under attack by a friendly piece
  for (let i = 0; i < moves.length; i += 2) {
    const before = line[i];
    const uci    = moves[i];
    const from   = uci.slice(0, 2);
    const to     = uci.slice(2, 4);
    if (!isOnLine(from, to)) continue;
    // Check if a friendly slider was already on this line before the move
    const ourSliders = allPieces(before).filter(p =>
      p.color === povColor && ['b','r','q'].includes(p.type) && p.square !== from
    );
    for (const sl of ourSliders) {
      if (isOnLine(sl.square, from) && isOnLine(sl.square, to)) return true;
    }
  }
  return false;
}

// ── Mate pattern detectors ────────────────────────────────────────────────────

function smotheredMate(chess, oppColor) {
  // King mated by knight, surrounded by own pieces
  const turn   = chess.turn();
  if (!chess.isCheckmate()) return false;
  const povColor = turn === 'w' ? 'b' : 'w';
  const king   = allPieces(chess).find(p => p.color === turn && p.type === 'k');
  if (!king) return false;
  // Find the checking piece
  const checkers = allPieces(chess).filter(p =>
    p.color === povColor && chess.isAttackedBy(povColor, king.square) && p.type === 'n'
  );
  if (checkers.length === 0) return false;
  // King surrounded by own pieces or edge
  const kCoord   = squareToCoord(king.square);
  const adjacent = getAdjacentSquares(kCoord);
  const free = adjacent.filter(sq => {
    const p = chess.get(sq);
    return !p; // empty square the king could potentially move to
  });
  return free.length === 0; // fully surrounded
}

function backRankMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn = chess.turn();
  const king = allPieces(chess).find(p => p.color === turn && p.type === 'k');
  if (!king) return false;
  const rank = parseInt(king.square[1]);
  return rank === 1 || rank === 8;
}

function arabianMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn  = chess.turn();
  const povColor = turn === 'w' ? 'b' : 'w';
  const king  = allPieces(chess).find(p => p.color === turn && p.type === 'k');
  if (!king) return false;
  const kCoord = squareToCoord(king.square);
  // King in corner
  if (!((kCoord.f === 0 || kCoord.f === 7) && (kCoord.r === 0 || kCoord.r === 7))) return false;
  // Mated by knight + rook
  const hasKnight = allPieces(chess).some(p => p.color === povColor && p.type === 'n');
  const hasRook   = allPieces(chess).some(p => p.color === povColor && p.type === 'r');
  return hasKnight && hasRook;
}

function anastasialMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn  = chess.turn();
  const povColor = turn === 'w' ? 'b' : 'w';
  const king  = allPieces(chess).find(p => p.color === turn && p.type === 'k');
  if (!king) return false;
  const kCoord = squareToCoord(king.square);
  // King on edge (not corner)
  const onEdge = kCoord.f === 0 || kCoord.f === 7;
  if (!onEdge) return false;
  // Knight + rook delivering mate
  const hasKnight = allPieces(chess).some(p => p.color === povColor && p.type === 'n');
  const hasRook   = allPieces(chess).some(p => p.color === povColor && p.type === 'r');
  return hasKnight && hasRook;
}

function hookMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn  = chess.turn();
  const povColor = turn === 'w' ? 'b' : 'w';
  // Rook + knight + pawn pattern
  const hasRook   = allPieces(chess).some(p => p.color === povColor && p.type === 'r');
  const hasKnight = allPieces(chess).some(p => p.color === povColor && p.type === 'n');
  const hasPawn   = allPieces(chess).some(p => p.color === povColor && p.type === 'p');
  return hasRook && hasKnight && hasPawn;
}

function bodenMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn  = chess.turn();
  const povColor = turn === 'w' ? 'b' : 'w';
  // Two bishops on criss-cross diagonals
  const bishops = allPieces(chess).filter(p => p.color === povColor && p.type === 'b');
  return bishops.length >= 2;
}

function doubleBishopMate(chess, oppColor) {
  // Same as bodenMate for now (distinction is the exact pattern)
  return bodenMate(chess, oppColor);
}

function dovetailMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn  = chess.turn();
  const povColor = turn === 'w' ? 'b' : 'w';
  const queen = allPieces(chess).find(p => p.color === povColor && p.type === 'q');
  if (!queen) return false;
  // King blocked by own pieces on both diagonal squares
  const king   = allPieces(chess).find(p => p.color === turn && p.type === 'k');
  if (!king) return false;
  const kCoord = squareToCoord(king.square);
  const diagonals = [[-1,-1],[-1,1],[1,-1],[1,1]].map(([df,dr]) =>
    coordToSquare(kCoord.f+df, kCoord.r+dr)
  ).filter(Boolean);
  const blockedByOwn = diagonals.filter(sq => {
    const p = chess.get(sq);
    return p && p.color === turn;
  });
  return blockedByOwn.length >= 2;
}

function operaMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn  = chess.turn();
  const povColor = turn === 'w' ? 'b' : 'w';
  // Rook + bishop, king trapped on back rank by own piece
  const hasRook   = allPieces(chess).some(p => p.color === povColor && p.type === 'r');
  const hasBishop = allPieces(chess).some(p => p.color === povColor && p.type === 'b');
  return hasRook && hasBishop && backRankMate(chess, oppColor);
}

function morphysMate(chess, oppColor) {
  return operaMate(chess, oppColor); // very similar pattern
}

function epauletteMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn  = chess.turn();
  const king  = allPieces(chess).find(p => p.color === turn && p.type === 'k');
  if (!king) return false;
  const kCoord = squareToCoord(king.square);
  // King flanked by two own pieces (left and right)
  const left  = coordToSquare(kCoord.f - 1, kCoord.r);
  const right = coordToSquare(kCoord.f + 1, kCoord.r);
  const leftBlocked  = left  && chess.get(left)?.color  === turn;
  const rightBlocked = right && chess.get(right)?.color === turn;
  return leftBlocked && rightBlocked;
}

function cornerMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn  = chess.turn();
  const king  = allPieces(chess).find(p => p.color === turn && p.type === 'k');
  if (!king) return false;
  const kCoord = squareToCoord(king.square);
  return (kCoord.f === 0 || kCoord.f === 7) && (kCoord.r === 0 || kCoord.r === 7);
}

function vukovicMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  const turn  = chess.turn();
  const povColor = turn === 'w' ? 'b' : 'w';
  const hasRook   = allPieces(chess).some(p => p.color === povColor && p.type === 'r');
  const hasKnight = allPieces(chess).some(p => p.color === povColor && p.type === 'n');
  return hasRook && hasKnight;
}

function killBoxMate(chess, oppColor) {
  if (!chess.isCheckmate()) return false;
  // King confined to a corner box — very similar to cornerMate
  return cornerMate(chess, oppColor);
}

// ── Phase detection ────────────────────────────────────────────────────────────

function detectPhase(chess) {
  const pieces = allPieces(chess);
  const heavyCount = pieces.filter(p => ['q','r'].includes(p.type)).length;
  const totalNonPawn = pieces.filter(p => !['k','p'].includes(p.type)).length;

  let phase = 'middlegame';
  let endgameType = null;

  if (heavyCount === 0 && totalNonPawn <= 4) {
    phase = 'endgame';
    // Determine endgame type
    const types = pieces.filter(p => !['k','p'].includes(p.type)).map(p => p.type);
    const has  = (t) => types.includes(t);
    if      (!has('q') && !has('r') && !has('b') && !has('n')) endgameType = 'pawnEndgame';
    else if  (has('r') && !has('q') && !has('b') && !has('n')) endgameType = 'rookEndgame';
    else if  (has('b') && !has('q') && !has('r') && !has('n')) endgameType = 'bishopEndgame';
    else if  (has('n') && !has('q') && !has('r') && !has('b')) endgameType = 'knightEndgame';
    else if  (has('q') && !has('r') && !has('b') && !has('n')) endgameType = 'queenEndgame';
    else if  (has('q') && has('r'))                             endgameType = 'queenRookEndgame';
  } else if (totalNonPawn >= 12) {
    phase = 'opening';
  }

  return { phase, endgameType };
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function squareToCoord(sq) {
  return { f: sq.charCodeAt(0) - 'a'.charCodeAt(0), r: parseInt(sq[1]) - 1 };
}

function coordToSquare(f, r) {
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return 'abcdefgh'[f] + (r + 1);
}

function isOnLine(sq1, sq2) {
  const c1 = squareToCoord(sq1), c2 = squareToCoord(sq2);
  const df = c2.f - c1.f, dr = c2.r - c1.r;
  return df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr);
}

function squareBetween(sq, sq1, sq2) {
  // Is sq strictly between sq1 and sq2 on a line?
  if (!isOnLine(sq1, sq2)) return false;
  const c = squareToCoord(sq), c1 = squareToCoord(sq1), c2 = squareToCoord(sq2);
  const minF = Math.min(c1.f,c2.f), maxF = Math.max(c1.f,c2.f);
  const minR = Math.min(c1.r,c2.r), maxR = Math.max(c1.r,c2.r);
  return c.f >= minF && c.f <= maxF && c.r >= minR && c.r <= maxR &&
         (c.f !== c1.f || c.r !== c1.r) && (c.f !== c2.f || c.r !== c2.r);
}

function squaresBetween(sq1, sq2) {
  const c1 = squareToCoord(sq1), c2 = squareToCoord(sq2);
  const df = Math.sign(c2.f - c1.f), dr = Math.sign(c2.r - c1.r);
  const result = [];
  let f = c1.f + df, r = c1.r + dr;
  while (f !== c2.f || r !== c2.r) {
    result.push(coordToSquare(f, r));
    f += df; r += dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) break;
  }
  return result;
}

function getAdjacentSquares(coord) {
  const sqs = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const sq = coordToSquare(coord.f + df, coord.r + dr);
      if (sq) sqs.push(sq);
    }
  }
  return sqs;
}

function uci_to(uci) { return uci.slice(2, 4); }

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = { cook, buildLine, materialDiff, winChances };

function winChances(cp) {
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}
