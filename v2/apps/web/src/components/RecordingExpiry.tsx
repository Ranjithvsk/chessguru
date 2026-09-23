// How long is left before a class recording is deleted.
//
// Recordings are kept for 48 hours (owner, 2026-09-23): long enough that a
// coach who does not get to it the same day still can, but not an archive.
// That only works if the coach can SEE the clock — a download link beside a
// file that quietly disappears is worse than no link at all.
//
// THE number, exported, because it was written out in four places and prose
// like "kept for 24 hours" does not move when the cron does. Everything that
// mentions the window reads it from here; the scripts that actually enforce it
// take KEEP_HOURS, and the two must be changed together.

export const WINDOW_HOURS = 48;
export const WINDOW_LABEL = `${WINDOW_HOURS} hours`;

export default function RecordingExpiry({ createdAt }: { createdAt?: string | null }) {
  if (!createdAt) return null;
  const made = new Date(createdAt).getTime();
  if (!Number.isFinite(made)) return null;
  const leftMs = made + WINDOW_HOURS * 3600_000 - Date.now();

  if (leftMs <= 0) {
    return <span className="font-semibold text-rose-400">expired — being removed</span>;
  }
  const hours = Math.floor(leftMs / 3600_000);
  const mins = Math.floor((leftMs % 3600_000) / 60_000);
  const text = hours >= 1 ? `${hours}h ${mins}m left` : `${mins}m left`;
  // Under three hours is when "I'll grab it later" stops being safe.
  const urgent = leftMs < 3 * 3600_000;
  return (
    <span className={urgent ? "font-semibold text-amber-400" : undefined} title="Recordings are kept for 24 hours">
      ⏳ {text}
    </span>
  );
}
