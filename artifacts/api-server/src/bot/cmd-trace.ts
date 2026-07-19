// Lightweight per-command stage timing, added 2026-07-19 to answer a
// specific, repeated production question: "Slow command: .dep took 153881ms"
// tells you THAT it was slow, not WHERE the time went (DB call? WhatsApp
// send? something else entirely). This module lets any code mark named
// checkpoints; when the command finishes, message.ts logs the full
// breakdown alongside the existing "Slow command" warning.
//
// Usage: call mark("label") at any point inside a command handler (or a
// DB helper, etc.) while inside the AsyncLocalStorage context established
// by withTrace(). Each mark records elapsed time since the previous mark
// (or since trace start, for the first mark). mark() is a no-op outside a
// trace context, so it's always safe to call — DB helper functions can
// call it unconditionally without needing to know whether they're being
// invoked from an instrumented code path.
import { AsyncLocalStorage } from "node:async_hooks";

export type TraceStage = { label: string; sinceStartMs: number; deltaMs: number };

type TraceState = {
  startedAt: number;
  lastMarkAt: number;
  stages: TraceStage[];
};

const traceContext = new AsyncLocalStorage<TraceState>();

/** Wraps `fn` in a fresh trace context and returns both its result and the
 * collected stages. IMPORTANT: AsyncLocalStorage's context is only active
 * for code running (synchronously or via continuations) *inside* the
 * run() callback — code in the caller's scope after `await withTrace(...)`
 * is NOT inside that context anymore, so getTraceStages() would return
 * null if called out there. That's why this returns the stages directly
 * instead of requiring a separate getTraceStages() call after the await.
 * (Verified with an isolated test before wiring this into message.ts —
 * an earlier version of this function required a separate post-await
 * getTraceStages() call and silently returned null every time.) */
export async function withTrace<T>(fn: () => Promise<T>): Promise<{ result: T; stages: TraceStage[] }> {
  const existing = traceContext.getStore();
  if (existing) {
    // Already inside a trace (nested call) — don't create a new one,
    // just run and return the shared stages reference.
    const result = await fn();
    return { result, stages: existing.stages };
  }
  const now = Date.now();
  const state: TraceState = { startedAt: now, lastMarkAt: now, stages: [] };
  const result = await traceContext.run(state, fn);
  return { result, stages: state.stages };
}

/** Record a checkpoint. Safe to call from anywhere (DB helpers, command
 * handlers, etc.) — no-ops if not inside a withTrace() context, so callers
 * never need to check first. */
export function mark(label: string): void {
  const state = traceContext.getStore();
  if (!state) return;
  const now = Date.now();
  state.stages.push({
    label,
    sinceStartMs: now - state.startedAt,
    deltaMs: now - state.lastMarkAt,
  });
  state.lastMarkAt = now;
}

/** Formats stages as a compact string for a single log line, e.g.
 * "ensureUser:120ms getBankCapExtra:8340ms send:45ms" — sorted by
 * deltaMs descending isn't done here (kept in call order, which is
 * usually more readable for following a command's actual journey). */
export function formatTraceStages(stages: TraceStage[]): string {
  return stages.map((s) => `${s.label}:${s.deltaMs}ms`).join(" ");
}
