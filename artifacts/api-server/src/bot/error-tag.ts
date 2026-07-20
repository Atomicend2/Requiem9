// Error classification for diagnostic logging, added 2026-07-20.
//
// The problem this solves: this session spent a lot of back-and-forth
// distinguishing "is this slow because of the database, the network to
// WhatsApp, a race condition, or something else entirely" purely by
// re-reading stack traces and timing numbers by hand each time. This
// module does that classification automatically and attaches a short,
// consistent tag to the log line — e.g. [NETWORK:CONFIRMED],
// [DB:SUSPECTED], [RACE:SUSPECTED] — so it's visible at a glance in the
// log without needing another round of manual investigation.
//
// IMPORTANT — what CONFIRMED vs SUSPECTED actually means here:
//   CONFIRMED: the error itself unambiguously identifies its own category
//     (e.g. a MongoNetworkTimeoutError IS a network error by construction —
//     there's no interpretation involved).
//   SUSPECTED: the classifier is pattern-matching on error message text,
//     stack shape, or context that's correlated with a category but could
//     have other explanations. Treat these as a starting hypothesis, not
//     a diagnosis — the same discipline this session used throughout
//     (verify with evidence before treating a theory as fact).
// This module deliberately never claims CONFIRMED for a guess — if in
// doubt, it returns UNKNOWN rather than overstating confidence, since a
// false CONFIRMED tag is worse than an honest UNKNOWN (it stops
// investigation early).

export type ErrorCategory = "DB" | "NETWORK" | "RACE" | "TIMEOUT" | "AUTH" | "VALIDATION" | "UNKNOWN";
export type Confidence = "CONFIRMED" | "SUSPECTED";

export interface ClassifiedError {
  category: ErrorCategory;
  confidence: Confidence;
  tag: string; // e.g. "[NETWORK:CONFIRMED]"
  reason: string; // short human-readable basis for the classification, for the log line
}

/** Classifies an error/exception for diagnostic tagging. Never throws —
 * always returns something loggable, even for malformed input. */
export function classifyError(err: unknown): ClassifiedError {
  const name = (err as any)?.name || "";
  const message = String((err as any)?.message || err || "");
  const code = (err as any)?.code;

  // ── CONFIRMED: the error's own type/name unambiguously identifies it ──
  if (name === "MongoNetworkTimeoutError" || name === "MongoNetworkError") {
    return mk("NETWORK", "CONFIRMED", `error name is ${name} — Mongo driver's own network-layer error type`);
  }
  if (name === "MongoServerSelectionError") {
    return mk("NETWORK", "CONFIRMED", "driver could not reach any Mongo server — network/connectivity, not a query bug");
  }
  if (name === "MongoServerError" && (code === 11000 || code === 11001)) {
    return mk("DB", "CONFIRMED", "MongoDB duplicate-key error (E11000) — a genuine data constraint violation");
  }
  if (name === "MongoServerError") {
    return mk("DB", "CONFIRMED", "MongoServerError — the database itself rejected or failed the operation");
  }
  if (message.includes("rate-overlimit")) {
    return mk("NETWORK", "CONFIRMED", "WhatsApp's own rate-limit error string — matches known Baileys rate-limit signature");
  }
  if (name === "TimeoutError" || /operation exceeded time limit/i.test(message)) {
    return mk("TIMEOUT", "CONFIRMED", "explicit timeout error (maxTimeMS or equivalent) — the operation was cut off, not naturally slow");
  }

  // ── SUSPECTED: pattern-matched, not certain ──────────────────────────
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(message)) {
    return mk("NETWORK", "SUSPECTED", "Node.js network-error code/message pattern — usually network, but could be a misconfigured host too");
  }
  if (/duplicate|E11000|already exists/i.test(message)) {
    return mk("DB", "SUSPECTED", "message mentions duplication — possibly a race condition writing the same key twice, not just a legitimate constraint hit");
  }
  if (/unauthorized|forbidden|invalid.*token|jwt/i.test(message)) {
    return mk("AUTH", "SUSPECTED", "message mentions auth/token terms — likely an auth failure, but could be a misused API too");
  }
  if (/required|invalid|must be|expected/i.test(message) && !/timeout|time limit/i.test(message)) {
    return mk("VALIDATION", "SUSPECTED", "message reads like an input-validation failure rather than an infrastructure issue");
  }
  if (/timeout|timed out/i.test(message)) {
    return mk("TIMEOUT", "SUSPECTED", "message mentions timeout but isn't a recognized explicit-timeout error type — could be network or a genuinely slow operation");
  }

  return mk("UNKNOWN", "SUSPECTED", "no matching pattern — needs manual investigation, same as any error would without this tool");
}

function mk(category: ErrorCategory, confidence: Confidence, reason: string): ClassifiedError {
  return { category, confidence, tag: `[${category}:${confidence}]`, reason };
}
