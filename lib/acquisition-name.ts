// Latin accent folding retains the established OCR lookup behavior. Other
// scripts keep their letters and attached marks: removing them can turn two
// different printed names into the same surviving number or Latin fragment.
export function acquisitionNameKey(value: string) {
  const normalized = value.normalize("NFKD").toLowerCase();
  if (!/[^\x00-\x7f]/.test(normalized))
    return normalized.replace(/[^a-z0-9]/g, "");
  return normalized
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .replace(/(^|[^\p{L}\p{N}\p{M}])\p{M}+/gu, "$1")
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}
