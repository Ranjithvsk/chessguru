import PuzzleFeedback from "../components/PuzzleFeedback";
import type { FB } from "../hooks/usePuzzleGame";

/**
 * Isolated test harness for the Lichess-exact feedback block (ADR-0005).
 * Renders every state with mock data so the UI can be verified before the
 * component is wired into Puzzles / Theme / Blindfold. Route: /test/feedback-ui
 */
const noop = () => {};

type Case = {
  label: string;
  fb: FB;
  pov: "white" | "black";
  hinted: boolean;
  solved: boolean;
  ratingDiff: number | null;
};

const CASES: Case[] = [
  { label: "play · white to move", fb: { kind: "wait", title: "Your turn", sub: "Find the best move for white" }, pov: "white", hinted: false, solved: false, ratingDiff: null },
  { label: "play · black to move", fb: { kind: "wait", title: "Your turn", sub: "Find the best move for black" }, pov: "black", hinted: false, solved: false, ratingDiff: null },
  { label: "play · hint used (button active)", fb: { kind: "wait", title: "Hint", sub: "Move the piece on e4" }, pov: "white", hinted: true, solved: false, ratingDiff: null },
  { label: "good · keep going", fb: { kind: "good", title: "Best move!", sub: "Keep going…" }, pov: "white", hinted: false, solved: false, ratingDiff: null },
  { label: "fail · try again", fb: { kind: "bad", title: "Not the best", sub: "Try again." }, pov: "black", hinted: false, solved: false, ratingDiff: null },
  { label: "win · clean solve (+rating)", fb: { kind: "solved", title: "Success!", sub: "Well played." }, pov: "white", hinted: false, solved: true, ratingDiff: 8 },
  { label: "win · solved with help (−rating)", fb: { kind: "solved", title: "Solved!", sub: "You used the solution." }, pov: "black", hinted: true, solved: true, ratingDiff: -5 },
];

export default function FeedbackUITestPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-white">Feedback UI — test harness</h1>
        <p className="text-sm text-ink-400">ADR-0005 isolation page. Not linked from the navbar.</p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {CASES.map((c) => (
          <div key={c.label} className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">{c.label}</div>
            <PuzzleFeedback
              fb={c.fb}
              pov={c.pov}
              hinted={c.hinted}
              solved={c.solved}
              displayRating={1532}
              ratingDiff={c.ratingDiff}
              onHint={noop}
              onViewSolution={noop}
              onNext={noop}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
