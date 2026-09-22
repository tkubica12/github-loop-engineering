import { digest, workId } from "./loop-state.mjs";

/** Synthetic fixture arithmetic, not measured production improvement. */
export function validateTelemetry(telemetry, { identity, expectedWindow, sourceIdentity, alreadyAddressed = false }) {
  workId(identity);
  const blocked = (reason) => ({ decision: "blocked", actionable: false, reason });
  if (!telemetry || telemetry.synthetic !== true) return blocked("Missing explicitly synthetic telemetry");
  try {
    if (workId(telemetry.identity ?? sourceIdentity) !== workId(identity)) return blocked("Telemetry identity mismatch");
  } catch { return blocked("Missing or invalid telemetry identity; legacy fixture needs an explicit trusted source binding"); }
  const window = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(telemetry.window ?? "");
  if (!window || telemetry.window !== expectedWindow ||
      !window.slice(1).every((date) => Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date) ||
      Date.parse(window[1]) > Date.parse(window[2])) return blocked("Missing, invalid, or unexpected synthetic window");
  const { reservationRequests: total, zeroStockResponses: count, zeroStockRate: rate, reviewThreshold: threshold } = telemetry;
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(count) || count < 0 || count > total ||
      !Number.isFinite(rate) || Math.abs(rate - count / total) > 1e-12 ||
      !Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
      !/^MED-\d{3}$/.test(telemetry.topZeroStockSku ?? "")) return blocked("Invalid synthetic counts, arithmetic, threshold, or SKU");
  const evidenceDigest = digest({ identity, window: telemetry.window, total, count, rate, threshold, sku: telemetry.topZeroStockSku });
  if (alreadyAddressed) return { decision: "no-op", actionable: false, reason: "already-addressed", evidenceDigest };
  return { decision: rate > threshold ? "delegate" : "no-op", actionable: rate > threshold,
    reason: rate > threshold ? "above-threshold" : "below-or-at-threshold", evidenceDigest, synthetic: true };
}
