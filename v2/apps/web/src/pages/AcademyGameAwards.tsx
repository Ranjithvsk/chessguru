// Game awards now live INSIDE the academy leaderboard (owner: "same UI"). Keep the old address working.
import { Navigate } from "react-router-dom";
export default function AcademyGameAwardsPage() { return <Navigate to="/academy/leaderboard#game-awards" replace />; }
