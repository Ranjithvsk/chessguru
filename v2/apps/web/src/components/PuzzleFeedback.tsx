import type { FB } from "../hooks/usePuzzleGame";

/**
 * Lichess-exact puzzle feedback block — a faithful port of
 * `lila` ui/puzzle/src/view/feedback.ts. Shared by Puzzles, Theme and Blindfold.
 *
 * Structure (matches Lichess class names so the CSS reads 1:1):
 *   .puzzle__feedback.{play|good|fail|win}
 *     .player           → .no-square > piece.king.{white|black} + .instruction (strong + em)
 *     .view_solution    → hint button + view-the-solution button   (hidden once solved)
 *     .complete         → rating delta + "Next" (win state only)
 */
export interface PuzzleFeedbackProps {
  fb: FB;
  /** the player's colour → which king to show in the no-square */
  pov: "white" | "black";
  hinted: boolean;
  solved: boolean;
  displayRating: number;
  ratingDiff: number | null;
  onHint: () => void;
  onViewSolution: () => void;
  onNext: () => void;
  /** label for the reveal button — "View the solution" (default) or "Reveal" (blindfold) */
  solutionLabel?: string;
  /** disable Next while the next puzzle is loading */
  isFetching?: boolean;
}

const KIND_CLASS: Record<FB["kind"], string> = {
  wait: "play",
  good: "good",
  bad: "fail",
  solved: "win",
};

export default function PuzzleFeedback({
  fb,
  pov,
  hinted,
  solved,
  displayRating,
  ratingDiff,
  onHint,
  onViewSolution,
  onNext,
  solutionLabel = "View the solution",
  isFetching = false,
}: PuzzleFeedbackProps) {
  const state = KIND_CLASS[fb.kind];

  if (solved) {
    return (
      <div className={`puzzle__feedback ${state}`}>
        <div className="complete">
          <strong className="complete__title">{fb.title}</strong>
          {fb.sub && <em className="complete__sub">{fb.sub}</em>}
          <div className="complete__rating">
            <span className="text-ink-400">Your rating</span>
            <span className="ml-2 font-semibold text-white">{displayRating}</span>
            {ratingDiff != null && (
              <span className={ratingDiff >= 0 ? "ml-2 text-accent-400" : "ml-2 text-rose-400"}>
                {ratingDiff >= 0 ? "+" : ""}{ratingDiff}
              </span>
            )}
          </div>
        </div>
        <button onClick={onNext} disabled={isFetching} className="puzzle__next">
          {isFetching ? "Loading…" : "Continue training"}
          <span aria-hidden="true"> →</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`puzzle__feedback ${state}`}>
      <div className="player">
        <div className="no-square">
          <span className={`cg-piece king ${pov}`} aria-hidden="true" />
        </div>
        <div className="instruction">
          <strong>{fb.title}</strong>
          <em>{fb.sub}</em>
        </div>
      </div>

      <div className="view_solution">
        <button
          onClick={onHint}
          className={`puzzle__hint ${hinted ? "active" : "button-empty"}`}
        >
          <span aria-hidden="true">💡</span> Get a hint
        </button>
        <button onClick={onViewSolution} className="puzzle__solution button-empty">
          {solutionLabel}
        </button>
      </div>
    </div>
  );
}
