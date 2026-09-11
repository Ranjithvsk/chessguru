// Multi-tag input for study chapters. Chips + a free-text box that suggests
// tags the user already uses, so "Sicilian" doesn't become four spellings.
import { useMemo, useRef, useState } from "react";

export function TagEditor({
  tags, onChange, suggestions = [], max = 12, placeholder = "Add a topic…",
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  suggestions?: Array<{ tag: string; count: number }>;
  max?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lower = useMemo(() => new Set(tags.map((t) => t.toLowerCase())), [tags]);

  const add = (raw: string) => {
    const v = raw.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!v) return;
    if (lower.has(v.toLowerCase())) { setDraft(""); return; }   // already on
    if (tags.length >= max) return;
    onChange([...tags, v]);
    setDraft("");
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  // Suggestions the chapter doesn't already carry, matching what's typed.
  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return suggestions
      .filter((s) => !lower.has(s.tag.toLowerCase()))
      .filter((s) => !q || s.tag.toLowerCase().includes(q))
      .slice(0, 8);
  }, [suggestions, draft, lower]);

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900/60 px-2 py-1.5"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-500/20 px-2 py-0.5 text-xs font-semibold text-brand-200">
            {t}
            <button
              onClick={(e) => { e.stopPropagation(); remove(t); }}
              className="text-brand-300/70 hover:text-white"
              title={`Remove ${t}`}
              aria-label={`Remove tag ${t}`}
            >×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); }
            else if (e.key === "Backspace" && !draft && tags.length) remove(tags[tags.length - 1]!);
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={tags.length >= max ? `Limit ${max}` : placeholder}
          disabled={tags.length >= max}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-white outline-none placeholder:text-ink-500"
        />
      </div>

      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-xl">
          {matches.map((m) => (
            <button
              key={m.tag}
              onMouseDown={(e) => { e.preventDefault(); add(m.tag); }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-ink-200 hover:bg-ink-800"
            >
              <span>{m.tag}</span>
              <span className="text-[11px] text-ink-500">{m.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only chip row — used in chapter lists. */
export function TagChips({ tags, onClick }: { tags?: string[]; onClick?: (t: string) => void }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.map((t) => (
        <button
          key={t}
          onClick={onClick ? (e) => { e.preventDefault(); e.stopPropagation(); onClick(t); } : undefined}
          className={`rounded-full bg-ink-800 px-2 py-0.5 text-[11px] text-ink-300 ${onClick ? "hover:bg-brand-500/30 hover:text-brand-200" : "cursor-default"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
