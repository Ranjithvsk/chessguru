// Fair Play Phase 3 — a small fitted model over the score components.
//
// Logistic regression on the seven components (each scaled by its cap), with
// an L2 prior centred on the HAND weights: with no labelled decisions the
// model IS the hand score (score = 60 + 12·logit p, so p = 0.5 at Review),
// and every coach decision pulls it away from there. Pure — no deps.
import type { ScoreResult } from "./score";

export type Components = ScoreResult["components"];
export const FEATURES: (keyof Components)[] = ["flags", "fastHard", "accuracy", "crowd", "climb", "themeFlat", "playGap"];
export const CAPS: Record<keyof Components, number> = { flags: 40, fastHard: 30, accuracy: 15, crowd: 15, climb: 10, themeFlat: 10, playGap: 10 };
const SCALE = 12;           // hand score → logit: (S − 60) / 12
const REVIEW = 60;

export interface LabelledExample { userId: string; label: "assisted" | "honest"; components: Components; source: string; at: Date }
export interface Model {
  weights: number[]; bias: number; trainedAt: Date;
  n: { assisted: number; honest: number };
  cv: { accuracy: number | null; correct: number; total: number; falseAlarms: number; missed: number };
  active: boolean; reason: string;
}

export const featurize = (c: Partial<Components> | null | undefined): number[] => FEATURES.map((k) => Math.max(0, Math.min(1, ((c?.[k] ?? 0) as number) / CAPS[k])));
export const handWeights = (): number[] => FEATURES.map((k) => CAPS[k] / SCALE);
export const HAND_BIAS = -REVIEW / SCALE;
export const handModel = (): Model => ({ weights: handWeights(), bias: HAND_BIAS, trainedAt: new Date(0), n: { assisted: 0, honest: 0 }, cv: { accuracy: null, correct: 0, total: 0, falseAlarms: 0, missed: 0 }, active: false, reason: "no labelled decisions yet — hand weights" });

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export function probability(m: Pick<Model, "weights" | "bias">, c: Partial<Components> | null | undefined): number {
  const x = featurize(c);
  return sigmoid(m.weights.reduce((s, w, i) => s + w * (x[i] ?? 0), m.bias));
}
/** Model score on the hand scale: identical to the hand score under the hand model. */
export function modelScore(m: Pick<Model, "weights" | "bias">, c: Partial<Components> | null | undefined): number {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, probability(m, c)));
  return Math.round(Math.max(0, Math.min(100, REVIEW + SCALE * Math.log(p / (1 - p)))));
}

/** MAP fit: mean cross-entropy + (λ/2)·‖w − w_hand‖² (+ bias term). Gradient
 *  descent — seven weights, hundreds of examples at most. */
export function fit(examples: LabelledExample[], lambda = 0.3, iters = 3000, lr = 0.15): { weights: number[]; bias: number } {
  const w0 = handWeights(); const b0 = HAND_BIAS;
  const w = w0.slice(); let b = b0;
  if (!examples.length) return { weights: w, bias: b };
  const X = examples.map((e) => featurize(e.components));
  const y = examples.map((e) => (e.label === "assisted" ? 1 : 0));
  const n = examples.length;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(w.length).fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(w.reduce((s, wj, j) => s + wj * X[i]![j]!, b));
      const d = (p - y[i]!) / n;
      for (let j = 0; j < w.length; j++) gw[j] += d * X[i]![j]!;
      gb += d;
    }
    for (let j = 0; j < w.length; j++) { gw[j] += lambda * (w[j]! - w0[j]!); w[j] = w[j]! - lr * gw[j]; }
    gb += lambda * (b - b0); b -= lr * gb;
  }
  return { weights: w, bias: b };
}

/** Leave-one-out: how often the model would have agreed with the coach. */
export function crossValidate(examples: LabelledExample[]): Model["cv"] {
  if (examples.length < 3) return { accuracy: null, correct: 0, total: examples.length, falseAlarms: 0, missed: 0 };
  let correct = 0, falseAlarms = 0, missed = 0;
  for (let i = 0; i < examples.length; i++) {
    const train = examples.filter((_, j) => j !== i);
    const m = fit(train);
    const s = modelScore(m, examples[i]!.components);
    const predAssisted = s >= REVIEW;
    const isAssisted = examples[i]!.label === "assisted";
    if (predAssisted === isAssisted) correct++;
    else if (predAssisted) falseAlarms++; else missed++;
  }
  return { accuracy: Math.round((correct / examples.length) * 100) / 100, correct, total: examples.length, falseAlarms, missed };
}

export const MIN_ASSISTED = 10, MIN_HONEST = 20, MIN_ACCURACY = 0.9;
/** Train from labelled decisions. The fitted model only replaces the hand
 *  weights ("active") with enough decisions of both kinds AND a clean
 *  leave-one-out replay. Until then it runs in shadow. */
export function train(examples: LabelledExample[]): Model {
  const n = { assisted: examples.filter((e) => e.label === "assisted").length, honest: examples.filter((e) => e.label === "honest").length };
  const { weights, bias } = fit(examples);
  const cv = crossValidate(examples);
  let active = false, reason: string;
  if (n.assisted < MIN_ASSISTED || n.honest < MIN_HONEST) reason = `shadow — needs ${MIN_ASSISTED} assisted and ${MIN_HONEST} honest decisions (have ${n.assisted} / ${n.honest})`;
  else if (cv.accuracy === null || cv.accuracy < MIN_ACCURACY) reason = `shadow — leave-one-out accuracy ${cv.accuracy ?? "n/a"} is below ${MIN_ACCURACY}`;
  else { active = true; reason = `active — ${n.assisted} assisted / ${n.honest} honest decisions, leave-one-out accuracy ${cv.accuracy}`; }
  return { weights, bias, trainedAt: new Date(), n, cv, active, reason };
}
