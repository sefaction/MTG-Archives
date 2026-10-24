import type { StoredCapture } from "../../lib/acquisition-store";

// These three relation arrays have no SQL order contract. Preserve every field
// and all explicitly ordered arrays (physical order tuples, receipts, corrections).
// This is fixture comparison only; never change production hydration for a test.
export function canonicalCaptureSnapshot(value: StoredCapture): StoredCapture {
  const copy = structuredClone(value);
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  copy.session.artifacts.sort((a, b) => compare(a.id, b.id));
  copy.session.candidates.sort((a, b) => compare(a.key, b.key));
  for (const candidate of copy.session.candidates)
    candidate.observations.sort((a, b) => compare(a.id, b.id));
  return copy;
}
