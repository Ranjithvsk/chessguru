// Tiny React error boundary. Wrap any page (or subtree) that could throw
// during render so a bug renders a legible message instead of the whole
// SPA going white. Added 2026-08-18 after AcademyPerformance was reported
// as "loads then white screens" — there was no error boundary above it
// so any thrown exception unmounted the entire React tree.
//
// Usage:
//   <ErrorBoundary label="Student performance">
//     <AcademyPerformancePage />
//   </ErrorBoundary>
import { Component, type ReactNode } from "react";
import { reportClientError } from "../lib/report-error";

type Props = { label?: string; children: ReactNode };
type State = { err: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };
  static getDerivedStateFromError(err: Error): State { return { err }; }
  componentDidCatch(err: Error, info: unknown): void {
    // Surface to devtools even though we render a fallback.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ""}]`, err, info);
    reportClientError(
      `${this.props.label ? `${this.props.label}: ` : ""}${err?.message || String(err)}`,
      `${err?.stack || ""}\n--- component stack ---${(info as any)?.componentStack || ""}`,
    );
  }
  render(): ReactNode {
    if (!this.state.err) return this.props.children;
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-3 py-8">
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-4">
          <div className="text-sm font-semibold text-rose-100">{this.props.label ? `${this.props.label} — ` : ""}Something went wrong on this page.</div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-rose-200">{String(this.state.err?.stack || this.state.err?.message || this.state.err)}</pre>
          <div className="mt-3 flex gap-2">
            <button onClick={() => this.setState({ err: null })}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">Try again</button>
            <a href="/academy" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:text-white">← Academy</a>
          </div>
        </div>
      </div>
    );
  }
}
