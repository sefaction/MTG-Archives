import { z } from "zod";
import { acquisitionCollectorKey, acquisitionSetLanguageMarker } from "./acquisition-footer";

export const scannerSourceTextSchema = z.object({
  scope: z.literal("SCANNER_SOURCE_PIXELS"),
  width: z.number().int().positive().max(36000000),
  height: z.number().int().positive().max(36000000),
  boundaryVerified: z.literal(false),
  lines: z.array(z.object({text: z.string().max(200),
    polygon: z.array(z.tuple([z.number().finite(), z.number().finite()])).length(4),
  }).strict()).min(1).max(12),
}).strict().superRefine((source, ctx) => {
  const {width, height} = source;
  if (width * height > 36000000 || width / height < .62 || width / height > .80 ||
      source.lines.some(line => {
        const x = line.polygon.map(p => p[0]), y = line.polygon.map(p => p[1]);
        return Math.min(...x) < 0 || Math.max(...x) > width * .60 ||
          Math.min(...y) < height * .80 || Math.max(...y) > height ||
          Math.min(...x) >= Math.max(...x) || Math.min(...y) >= Math.max(...y) ||
          Math.max(...y) - Math.min(...y) > height * .025;
      })) ctx.addIssue({code: z.ZodIssueCode.custom, message: "Invalid scanner source positions"});
});
export type ScannerSourceText = z.infer<typeof scannerSourceTextSchema>;

// A narrow review channel for explicit modern collector/rarity rows immediately
// above their set/language row. These are source positions, never a card outline.
export function observedScannerIdentifiers(source?: ScannerSourceText) {
  if (!source) return null;
  const valid = scannerSourceTextSchema.safeParse(source);
  if (!valid.success) return null;
  const boxes = valid.data.lines.map(line => ({...line,
    left: Math.min(...line.polygon.map(p => p[0])),
    top: Math.min(...line.polygon.map(p => p[1])),
    bottom: Math.max(...line.polygon.map(p => p[1])),
  }));
  const collectors = boxes.flatMap(box => {
    const fraction = /^\s*(\d{1,5}[a-z★†]?)\s*\/\s*\d{2,5}(?:\s+[CUMRLT])?\s*$/i.exec(box.text);
    const rarity = /^\s*([CUMRLT])\s+(\d{1,5}[a-z★†]?)\s*$/i.exec(box.text);
    const number = fraction?.[1] ?? rarity?.[2];
    // Copyright years, bare numbers, numeric set names and P/T are insufficient.
    if (!number || /^(19|20)\d{2}$/.test(number) || box.left > source.width * .35) return [];
    return [{...box, number: acquisitionCollectorKey(number)}];
  });
  const markers = boxes.flatMap(box => {
    const marker = acquisitionSetLanguageMarker(box.text);
    return marker ? [{...box, ...marker}] : [];
  });
  if (!collectors.length || !markers.length) return null;
  // Contradictory observations stay unknown rather than selecting a convenient pair.
  if (new Set(collectors.map(c => c.number)).size !== 1 ||
      new Set(markers.map(m => `${m.set}:${m.language}`)).size !== 1) return null;
  const pairs = collectors.flatMap(c => markers.filter(m =>
    m.top >= c.bottom - source.height * .005 && m.top - c.bottom <= source.height * .045 &&
    Math.abs(m.left - c.left) <= source.width * .06
  ).map(m => ({set: m.set, language: m.language, number: c.number})));
  return pairs[0] ?? null;
}
