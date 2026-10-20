import { z } from "zod";
import { acquisitionCollectorKey, acquisitionSetLanguageMarker } from "./acquisition-footer";
import { collectorOcrAlternatives } from "./acquisition-collector-alternatives";

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

// Separate uncertain lookup hypotheses from observedScannerIdentifiers. The
// latter remains literal support; callers must never promote these to it.
export function observedScannerCollectorAlternatives(source?: ScannerSourceText) {
  if (!source || !scannerSourceTextSchema.safeParse(source).success) return [];
  const boxes = source.lines.map(line => ({...line,
    left: Math.min(...line.polygon.map(p => p[0])),
    top: Math.min(...line.polygon.map(p => p[1])),
    bottom: Math.max(...line.polygon.map(p => p[1])),
  }));
  const markers = boxes.flatMap(box => {
    const marker = acquisitionSetLanguageMarker(box.text);
    return marker ? [{...box, ...marker}] : [];
  });
  if (new Set(markers.map(m => `${m.set}:${m.language}`)).size !== 1) return [];
  const readings = boxes.flatMap(box => {
    const numbers = collectorOcrAlternatives(box.text);
    return box.left <= source.width * .35 && numbers.length ? [{...box, numbers}] : [];
  });
  // Multiple differing rows have no supported interpretation to select.
  if (new Set(readings.map(r => JSON.stringify(r.numbers))).size !== 1) return [];
  const pairs = readings.flatMap(c => markers.filter(m =>
    (m.top >= c.bottom - source.height * .005 ||
      (m.top > (c.top + c.bottom) / 2 && (m.top + m.bottom) / 2 > c.bottom)) &&
    m.top - c.bottom <= source.height * .045 &&
    Math.abs(m.left - c.left) <= source.width * .06
  ).flatMap(m => c.numbers.map(number => ({set: m.set, language: m.language, number}))));
  return [...new Map(pairs.map(value => [`${value.set}:${value.language}:${value.number}`, value])).values()];
}

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
  // Some OCR engines emit the rarity glyph separately from its number. Join
  // only one unique literal pair on the same positioned row; never concatenate
  // numeric fragments or borrow from another reading or direction.
  const rarityBoxes = boxes.filter(box => /^[CUMRLT]$/i.test(box.text.trim()));
  const numberBoxes = boxes.filter(box => /^\d{1,5}[a-z★†]?$/i.test(box.text.trim()) &&
    !/^(19|20)\d{2}$/.test(box.text.trim()));
  const joined = rarityBoxes.length === 1 && numberBoxes.length === 1
    ? (() => {
      const rarity = rarityBoxes[0], number = numberBoxes[0];
      const right = Math.max(...rarity.polygon.map(p => p[0]));
      const rarityCenter = (rarity.top + rarity.bottom) / 2;
      const numberCenter = (number.top + number.bottom) / 2;
      if (right > number.left || number.left - right > source.width * .035 ||
          rarityCenter < number.top || rarityCenter > number.bottom ||
          numberCenter < rarity.top || numberCenter > rarity.bottom) return [];
      return [{...number, text: rarity.text.trim() + ' ' + number.text.trim(),
        left: rarity.left, top: Math.min(rarity.top, number.top), bottom: Math.max(rarity.bottom, number.bottom)}];
    })() : [];
  const collectors = [...boxes, ...joined].flatMap(box => {
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
    // OCR glyph boxes can overlap while the central areas of two rows
    // remain distinct. Each row's center must lie outside the other box;
    // same-row, nested and heavily overlapping boxes gain no new support.
    (m.top >= c.bottom - source.height * .005 ||
      (m.top > (c.top + c.bottom) / 2 && (m.top + m.bottom) / 2 > c.bottom)) &&
    m.top - c.bottom <= source.height * .045 &&
    Math.abs(m.left - c.left) <= source.width * .06
  ).map(m => ({set: m.set, language: m.language, number: c.number})));
  return pairs[0] ?? null;
}
