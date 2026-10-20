// Retrieval hypotheses from one complete OCR row, never literal identifiers or
// confirmation evidence. Keep every bounded reading; the catalog cannot choose
// which glyph the source actually contained.
export function collectorOcrAlternatives(line: string): string[] {
  if (/[\r\n]/.test(line)) return [];
  const fraction = line.trim().split('/');
  if (fraction.length > 2 || (fraction[1] !== undefined &&
      !/^\d(?:[ \t]*\d){1,4}$/.test(fraction[1].trim()))) return [];
  const fragmentedTotal = fraction[1] !== undefined && /\d[ \t]+\d/.test(fraction[1]);
  // Consume a real rarity deterministically: regex backtracking must not turn
  // healthy L 1 into a glyph hypothesis 11 when the short body needs no repair.
  const head = fraction[0].trim().replace(/^[CUMRLT](?:[ \t]+|(?=\d))/i, "");
  const match = /^([0-9OILZS][0-9OILZS \t]{0,18})([a-z★†]?)$/i.exec(head);
  if (!match) return [];
  const body = match[1].trim();
  const chunks = body.split(/[ \t]+/);
  const joined = chunks.join("");
  // Two whole numbers may be separate observations (17 18), not one collector.
  if (chunks.filter(chunk => chunk.length > 1).length > 1 ||
      joined.length > 5 || !/\d/.test(joined) ||
      (!/[ \t]/.test(body) && /^\d+[a-z]$/i.test(joined))) return [];
  const ambiguous = [...joined].filter(char => /[OILZS]/i.test(char));
  if (ambiguous.length > 1 || (chunks.length === 1 && !ambiguous.length && !fragmentedTotal)) return [];
  const glyphs: Record<string, string[]> = { O: ["0"], I: ["1"], L: ["1"], Z: ["2"], S: ["3", "5"] };
  let readings = [""];
  for (const char of joined) {
    readings = readings.flatMap(prefix => (glyphs[char.toUpperCase()] ?? [char]).map(value => prefix + value));
  }
  readings = readings.map(value => value + match[2]);
  // A separated terminal letter can also be a real collector suffix. Retain it.
  if (chunks.length > 1 && /^\d{1,4}[a-z]$/i.test(joined)) readings.push(joined);
  return [...new Set(readings.filter(value => /^\d{1,5}[a-z★†]?$/i.test(value) &&
    !/^(19|20)\d{2}$/.test(value)).map(value => value.toLowerCase().replace(/^0+(?=\d)/, "")))];
}
