// This interprets saved OCR text; it neither changes pixels nor proves printing.
export const ACQUISITION_FOOTER_PARSER_VERSION = "footer-identifiers-v1";

// Zero padding is typography. Identity suffixes/prefixes must remain intact.
export function acquisitionCollectorKey(value: string) {
  return value.trim().toLowerCase().replace(/^0+(?=\d)/, "");
}

const languages = "EN|FR|DE|IT|ES|PT|JA|KO|RU|ZHS|ZHT";
const collector = "\\d{1,5}[a-z★†]?";

export function acquisitionFooterIdentifiers(lines: string[]) {
  if (lines.length > 100 || lines.some(line=>line.length > 2000))
    throw new Error("OCR footer evidence exceeds bounds");
  const identifiers = new Map<string, {set: string; language: string}>();
  const collectors = new Set<string>();
  let recoveredLayout = false;
  const addIdentifier = (set: string, language: string) => {
    const value = {set: set.toLowerCase(), language: language.toLowerCase()};
    identifiers.set(`${value.set}:${value.language}`, value);
  };
  for (const line of lines) {
    // Preserve ordinary separated and joined set/language markers.
    for (const match of line.toUpperCase().matchAll(new RegExp(
      `\\b([A-Z0-9]{2,8})[^A-Z0-9\\n]{0,6}(${languages})\\b`, "g")))
      addIdentifier(match[1], match[2]);
    // OCR can join a printed language with the artist. Recover only at the
    // start of an explicitly punctuated set marker, not arbitrary artist words.
    const joinedArtist = new RegExp(
      `^\\s*([A-Z0-9]{2,8})\\s*[·•*]\\s*(${languages})(?=[A-Z])`, "i").exec(line);
    if (joinedArtist) {
      addIdentifier(joinedArtist[1], joinedArtist[2]);
      recoveredLayout = true;
    }
    for (const match of line.matchAll(new RegExp(`\\b(${collector})\\s*\\/\\s*\\d{2,5}\\b`, "gi"))) {
      collectors.add(acquisitionCollectorKey(match[1]));
      if (/[★†]/.test(match[1])) recoveredLayout = true;
    }
    for (const match of line.matchAll(new RegExp(`(?:^|\\n)\\s*([CUMRLT])\\s*(${collector})(?![\\p{L}\\p{N}★†])`, "gimu"))) {
      // C1993-2008 Wizards... is a copyright line, not rarity C + number1993.
      const copyrightYear = match[1].toUpperCase() === "C" && /^(19|20)\d{2}$/.test(match[2]) &&
        (/wizards|copyright|©/i.test(line) || /^\s*C\s*(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}/i.test(line));
      if (copyrightYear) recoveredLayout = true;
      else {
        collectors.add(acquisitionCollectorKey(match[2]));
        if (/[★†]/.test(match[2])) recoveredLayout = true;
      }
    }
  }
  // A number split from its rarity is useful only with same-observation printed
  // set/language context. Preserve multiple readings; never guess one of them.
  if (identifiers.size) for (let i=0; i<lines.length; i++) {
    const isolated = new RegExp(`^\\s*(${collector})\\s*$`, "i").exec(lines[i]);
    if (!isolated) continue;
    const nearbyRarity = [lines[i-1], lines[i+1]].some(line=>line && /^[CUMRLT]$/i.test(line.trim()));
    // An unmarked bare year is not enough to distinguish a collector from a
    // fragmented copyright. Explicit rarity and padded/suffixed forms survive.
    if (!nearbyRarity && /^(19|20)\d{2}$/.test(isolated[1])) continue;
    const number = acquisitionCollectorKey(isolated[1]);
    if (!collectors.has(number)) recoveredLayout = true;
    collectors.add(number);
  }
  return {identifiers: [...identifiers.values()], collectors: [...collectors], recoveredLayout};
}
