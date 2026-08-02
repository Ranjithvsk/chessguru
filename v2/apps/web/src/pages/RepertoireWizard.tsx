// Memory Master 500 — Repertoire Wizard (S2).
// 10-question flow → personalised 3×N-opening list saved to localStorage.
// Route: /study/repertoire.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  generateRepertoire,
  loadRepertoire,
  saveRepertoire,
  clearRepertoire,
  type WizardAnswers,
  type Repertoire,
} from "../lib/repertoire";
import { openingBySlug, familyById } from "../lib/openings";

type Step = "intro" | "questions" | "review";

const DEFAULT_ANSWERS: WizardAnswers = {
  rating: "1200-1600",
  timePerWeek: "30m-2h",
  whiteFirst: "e4",
  vsE4: "any",
  vsD4: "any",
  style: "universal",
  aggression: 3,
  theoryLoad: "whatever-works",
  roleModel: "carlsen",
  surpriseWeapons: false,
};

export default function RepertoireWizard() {
  const nav = useNavigate();
  const existing = loadRepertoire();
  const [step, setStep] = useState<Step>(existing ? "review" : "intro");
  const [answers, setAnswers] = useState<WizardAnswers>(existing?.answers ?? DEFAULT_ANSWERS);
  const [preview, setPreview] = useState<Repertoire | null>(existing);

  const update = <K extends keyof WizardAnswers>(k: K, v: WizardAnswers[K]) =>
    setAnswers((a) => ({ ...a, [k]: v }));

  const buildPreview = () => setPreview(generateRepertoire(answers));

  const commit = () => {
    const r = generateRepertoire(answers);
    saveRepertoire(r);
    setPreview(r);
    setStep("review");
  };

  // ── Intro ──────────────────────────────────────────────────────────────
  if (step === "intro") {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Link to="/study/openings" className="mb-3 inline-block text-xs text-gray-500 hover:text-gray-800">← All openings</Link>
        <h1 className="text-2xl font-bold">Build my repertoire</h1>
        <p className="mt-2 text-gray-700">
          10 quick questions → a personalised list of openings drawn from the 500. Kept in your
          browser only; skip or redo any time. Once you have a repertoire, we'll prioritise its
          openings in your daily study queue (when the card engine ships).
        </p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => setStep("questions")}
            className="rounded-xl bg-gray-900 px-5 py-3 text-sm font-bold text-white hover:bg-gray-800">
            Start · 10 questions
          </button>
          <Link to="/study/openings"
            className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Skip — browse all 500
          </Link>
        </div>
      </div>
    );
  }

  // ── Review (existing or freshly generated) ────────────────────────────
  if (step === "review" && preview) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Link to="/study/openings" className="mb-3 inline-block text-xs text-gray-500 hover:text-gray-800">← All openings</Link>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold">Your repertoire</h1>
          <div className="text-xs text-gray-500">
            saved · {new Date(preview.updatedAt).toLocaleString()}
          </div>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          {preview.whiteSlugs.length + preview.blackVsE4.length + preview.blackVsD4.length} openings across White, vs-1.e4, and vs-1.d4.
          Openings you don't like → tap to remove; add more from the browse page.
        </p>

        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <RepertoireColumn label="White" slugs={preview.whiteSlugs} />
          <RepertoireColumn label="Black vs 1.e4" slugs={preview.blackVsE4} />
          <RepertoireColumn label="Black vs 1.d4" slugs={preview.blackVsD4} />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={() => { setAnswers(preview.answers); setStep("questions"); }}
            className="rounded-xl bg-gray-900 px-5 py-3 text-sm font-bold text-white hover:bg-gray-800">
            Redo the questions
          </button>
          <button onClick={() => { clearRepertoire(); setPreview(null); setStep("intro"); }}
            className="rounded-xl border border-red-300 px-5 py-3 text-sm font-semibold text-red-600 hover:bg-red-50">
            Clear repertoire
          </button>
          <button onClick={() => nav("/study/openings")}
            className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Browse all openings
          </button>
        </div>
      </div>
    );
  }

  // ── Questions ─────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link to="/study/openings" className="mb-3 inline-block text-xs text-gray-500 hover:text-gray-800">← Cancel</Link>
      <h1 className="text-2xl font-bold">10 quick questions</h1>
      <p className="mt-1 text-sm text-gray-500">Answer honestly — we'll pick openings that fit YOU, not the popularity ranking.</p>

      <div className="mt-6 space-y-5">
        <Question label="1. Your rating">
          {(["u1200", "1200-1600", "1600-2000", "2000+"] as const).map((v) => (
            <Chip key={v} active={answers.rating === v} onClick={() => update("rating", v)}>
              {v === "u1200" ? "< 1200" : v}
            </Chip>
          ))}
        </Question>

        <Question label="2. Time you'll spend on chess per week">
          {(["under-30m", "30m-2h", "2-5h", "5h+"] as const).map((v) => (
            <Chip key={v} active={answers.timePerWeek === v} onClick={() => update("timePerWeek", v)}>
              {v === "under-30m" ? "< 30 min" : v === "5h+" ? "5+ hours" : v.replace("-", "–")}
            </Chip>
          ))}
        </Question>

        <Question label="3. As White, what's your first move?">
          {([["e4", "1.e4"], ["d4", "1.d4"], ["c4-nf3", "1.c4 / 1.Nf3"], ["both", "both / doesn't matter"]] as const).map(([v, label]) => (
            <Chip key={v} active={answers.whiteFirst === v} onClick={() => update("whiteFirst", v as WizardAnswers["whiteFirst"])}>{label}</Chip>
          ))}
        </Question>

        <Question label="4. Against 1.e4 as Black, which defence appeals?">
          {([
            ["sicilian", "Sicilian (sharp)"],
            ["e5-classical", "1…e5 (classical)"],
            ["french", "French (solid)"],
            ["caro-kann", "Caro-Kann (patient)"],
            ["modern-pirc", "Modern/Pirc (flexible)"],
            ["any", "any"],
          ] as const).map(([v, label]) => (
            <Chip key={v} active={answers.vsE4 === v} onClick={() => update("vsE4", v as WizardAnswers["vsE4"])}>{label}</Chip>
          ))}
        </Question>

        <Question label="5. Against 1.d4 as Black, which defence appeals?">
          {([
            ["kings-indian", "King's Indian (fight)"],
            ["nimzo-indian", "Nimzo-Indian (positional)"],
            ["qgd-orthodox", "QGD (classical)"],
            ["slav", "Slav / Semi-Slav"],
            ["grunfeld", "Grünfeld (hypermodern)"],
            ["any", "any"],
          ] as const).map(([v, label]) => (
            <Chip key={v} active={answers.vsD4 === v} onClick={() => update("vsD4", v as WizardAnswers["vsD4"])}>{label}</Chip>
          ))}
        </Question>

        <Question label="6. Your natural style">
          {([["attacker", "Attacker"], ["positional", "Positional"], ["universal", "Universal"]] as const).map(([v, label]) => (
            <Chip key={v} active={answers.style === v} onClick={() => update("style", v as WizardAnswers["style"])}>{label}</Chip>
          ))}
        </Question>

        <Question label="7. Aggression tolerance (1 = solid · 5 = wild gambits)">
          {[1, 2, 3, 4, 5].map((n) => (
            <Chip key={n} active={answers.aggression === n} onClick={() => update("aggression", n as WizardAnswers["aggression"])}>
              {n}
            </Chip>
          ))}
        </Question>

        <Question label="8. Theory memorisation">
          {([["love-it", "I love it"], ["whatever-works", "Whatever works"], ["avoid-it", "Avoid it"]] as const).map(([v, label]) => (
            <Chip key={v} active={answers.theoryLoad === v} onClick={() => update("theoryLoad", v as WizardAnswers["theoryLoad"])}>{label}</Chip>
          ))}
        </Question>

        <Question label="9. Style role model (biases the picks)">
          {([
            ["kasparov", "Kasparov (dynamic)"],
            ["karpov", "Karpov (positional)"],
            ["carlsen", "Carlsen (universal)"],
            ["tal", "Tal (tactical)"],
            ["fischer", "Fischer (classical)"],
            ["none", "no preference"],
          ] as const).map(([v, label]) => (
            <Chip key={v} active={answers.roleModel === v} onClick={() => update("roleModel", v as WizardAnswers["roleModel"])}>{label}</Chip>
          ))}
        </Question>

        <Question label="10. Include off-beat surprise weapons?">
          {[[true, "Yes — surprise them"], [false, "No — mainlines only"]].map(([v, label]) => (
            <Chip key={String(v)} active={answers.surpriseWeapons === v} onClick={() => update("surpriseWeapons", v as boolean)}>{label}</Chip>
          ))}
        </Question>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button onClick={commit}
          className="rounded-xl bg-gray-900 px-6 py-3 text-sm font-bold text-white hover:bg-gray-800">
          Build my repertoire
        </button>
        <button onClick={() => { buildPreview(); }}
          className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          Preview only
        </button>
        {preview && (
          <button onClick={() => setStep("review")}
            className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            View last preview
          </button>
        )}
      </div>
    </div>
  );
}

// ── little sub-components ─────────────────────────────────────────────
function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold text-gray-800">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
      {children}
    </button>
  );
}

function RepertoireColumn({ label, slugs }: { label: string; slugs: string[] }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}</span>
        <span className="text-xs text-gray-400">{slugs.length}</span>
      </div>
      {slugs.length === 0 ? (
        <p className="text-xs text-gray-500">No openings matched. Try broadening the wizard answers.</p>
      ) : (
        <ul className="space-y-1">
          {slugs.map((s) => {
            const o = openingBySlug.get(s);
            if (!o) return null;
            const family = familyById.get(o.familyId);
            return (
              <li key={s}>
                <Link to={`/study/openings/${s}`} className="flex items-baseline gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                  <span className="font-mono text-[10px] font-bold" style={{ color: family?.colorHex ?? "#6b7280" }}>{o.eco}</span>
                  <span className="truncate">{o.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
