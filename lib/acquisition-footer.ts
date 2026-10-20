// This interprets saved OCR text; it neither changes pixels nor proves printing.
import { collectorOcrAlternatives } from "./acquisition-collector-alternatives";
export const ACQUISITION_FOOTER_PARSER_VERSION = "footer-observations-v6";

// Zero padding is typography. Identity suffixes/prefixes must remain intact.
export function acquisitionCollectorKey(value: string) {
  return value.trim().toLowerCase().replace(/^0+(?=\d)/, "");
}

const languages = "EN|FR|DE|IT|ES|PT|JA|KO|RU|ZHS|ZHT";
const collector = "\\d{1,5}[a-z★†]?";

const marker=/^\s*([A-Z0-9]{2,8})(?:\s*[·•*]\s*(ZHS|ZHT|EN|FR|DE|IT|ES|PT|JA|KO|RU)(?=\b|[A-Z])|\s+(ZHS|ZHT|EN|FR|DE|IT|ES|PT|JA|KO|RU)\b)/i;
export function acquisitionSetLanguageMarker(line:string){
  const match=marker.exec(line);
  return match?{set:match[1].toLowerCase(),language:(match[2]??match[3]).toLowerCase()}:null;
}

// Whitespace-separated digit runs belong to an unresolved numeric reading.
// Reject only the adjacent candidate span, never guess a joined collector or
// let an otherwise clear identifier erase this observation's uncertainty.
function adjacentNumericFragment(line: string, start: number, end: number, completeFraction = false) {
  const before = line.slice(0, start), after = line.slice(end);
  // Adjacent complete fractions are separate observations, not digit fragments.
  const previousFraction = completeFraction && /\/[^\S\r\n]*\d{2,5}[^\S\r\n]+$/.test(before);
  const nextFraction = completeFraction && /^[^\S\r\n]+\d{1,5}[a-z★†]?[^\S\r\n]*\/[^\S\r\n]*\d{2,5}\b/i.test(after);
  return (/\d[^\S\r\n]+$/.test(before) && !previousFraction) ||
    (/^[^\S\r\n]+\d/.test(after) && !nextFraction);
}

export function acquisitionFooterIdentifiers(lines: string[]) {
  if (lines.length > 100 || lines.some(line=>line.length > 2000))
    throw new Error("OCR footer evidence exceeds bounds");
  const identifiers = new Map<string, {set: string; language: string}>();
  const collectors = new Set<string>();
  const explicitMarkers=lines.flatMap(line=>{const value=acquisitionSetLanguageMarker(line);return value?[value]:[];});
  const markerTokens=new Set(explicitMarkers.map(value=>value.set.toUpperCase()));
  const markerKeys=new Set(explicitMarkers.map(value=>value.set+':'+value.language));
  let recoveredLayout = false;
  const addIdentifier = (set: string, language: string) => {
    const value = {set: set.toLowerCase(), language: language.toLowerCase()};
    identifiers.set(`${value.set}:${value.language}`, value);
  };
  for (const line of lines) {
    // Preserve ordinary separated and joined set/language markers.
    for (const match of line.toUpperCase().matchAll(new RegExp(
      `\\b([A-Z0-9]{2,8})[^A-Z0-9\\n]{0,6}(${languages})\\b`, "g")))
      {
        const joined=match[0].slice(match[1].length).startsWith(match[2]);
        // A glued code/language can occur at the printed prefix, never inside
        // artist names such as StevEN. Preserve explicitly separated markers.
        if(joined&&match.index!==/^\s*/.exec(line)![0].length)continue;
        addIdentifier(match[1], match[2]);
        if(joined&&!markerKeys.has(match[1].toLowerCase()+':'+match[2].toLowerCase()))recoveredLayout=true;
      }
    // OCR can join a printed language with the artist. Recover only at the
    // start of an explicitly punctuated set marker, not arbitrary artist words.
    const joinedArtist = new RegExp(
      `^\\s*([A-Z0-9]{2,8})\\s*[·•*]\\s*(${languages})(?=[A-Z])`, "i").exec(line);
    if (joinedArtist) {
      addIdentifier(joinedArtist[1], joinedArtist[2]);
      recoveredLayout = true;
    }
    for (const match of line.matchAll(new RegExp(`\\b(${collector})\\s*\\/\\s*(\\d{1,5})\\b`, "gi"))) {
      const start = match.index!;
      if (adjacentNumericFragment(line, start, start + match[0].length, true)) {
        recoveredLayout = true;
        continue;
      }
      // Single-digit denominators alone are not supported printed totals.
      if (match[2].length < 2) continue;
      collectors.add(acquisitionCollectorKey(match[1]));
      if (/[★†]/.test(match[1])) recoveredLayout = true;
    }
    for (const match of line.matchAll(new RegExp(`(?:^|\\n)\\s*([CUMRLT])\\s*(${collector})(?![\\p{L}\\p{N}★†])`, "gimu"))) {
      if(markerTokens.has(match[0].trim().toUpperCase())){recoveredLayout=true;continue;}
      const start = match.index! + match[0].lastIndexOf(match[2]);
      const end = start + match[2].length;
      // Include a printed fraction denominator when checking its outer boundary.
      const denominator = /^[^\S\r\n]*\/[^\S\r\n]*\d+/.exec(line.slice(end));
      if (adjacentNumericFragment(line, start, end + (denominator?.[0].length ?? 0), Boolean(denominator && /\d{2,5}$/.test(denominator[0])))) {
        recoveredLayout = true;
        continue;
      }
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

export type FooterSpatialReading = {
  lines?: {text:string;polygon:number[][]}[];
  footerLines?: {text:string;polygon:number[][]}[];
  identifierLines?: {text:string;polygon:number[][]}[];
};

function footerBox(line:{text:string;polygon:number[][]}) {
  const points=line.polygon;
  if(points.length!==4||points.some(p=>p.length!==2||!p.every(Number.isFinite)||
    p[0]<0||p[0]>999||p[1]<1270||p[1]>1396))return null;
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const box={left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
  return box.left<box.right&&box.top<box.bottom?box:null;
}

// Only an explicit lower-left collector in this same oriented card frame can
// disqualify isolated supplemental upper-right noise. No score threshold, card
// identity, calibrated profile or box from another reading frame is used.
function supplementalOutsideCollector(supplemental:string[], spatial?:FooterSpatialReading) {
  if(!spatial)return new Set<string>();
  const all=[...(spatial.lines??[]),...(spatial.footerLines??[]),...(spatial.identifierLines??[])];
  if(all.length>300)return new Set<string>();
  const anchors=all.flatMap(line=>{
    const box=footerBox(line);
    if(!box||box.right>630)return [];
    const parsed=acquisitionFooterIdentifiers([line.text]);
    // Exact numeric set tokens must not independently become rarity anchors.
    if(parsed.collectors.length!==1||/^\s*[A-Z]\d+\s*$/i.test(line.text))return [];
    return [{number:parsed.collectors[0],box}];
  });
  if(new Set(anchors.map(a=>a.number)).size!==1)return new Set<string>();
  const excluded=new Set<string>();
  for(const text of supplemental){
    if(!new RegExp('^\\s*('+collector+')\\s*$','i').test(text))continue;
    const matches=(spatial.footerLines??[]).filter(line=>line.text.trim()===text.trim());
    if(matches.length&&matches.every(line=>{
      const box=footerBox(line);
      return box&&box.left>630&&anchors.every(anchor=>box.bottom<anchor.box.top);
    }))excluded.add(text);
  }
  return excluded;
}

// Keep the initial and supplemental readings together within one orientation.
// Additional metadata can help review/lookup but cannot create a strong match.
export function acquisitionFooterObservations(primary: string[], supplemental: string[] = [], sourceIdentifiers: string[] = [], spatial?:FooterSpatialReading) {
  const initial = acquisitionFooterIdentifiers(primary);
  // A set marker and a candidate row must occur in the same reading channel.
  // Do not join lines, channels or rotations to manufacture an identifier.
  const alternatives = new Map<string, {set: string; language: string; number: string}>();
  for (const lines of [primary, supplemental, sourceIdentifiers]) {
    const markers = acquisitionFooterIdentifiers(lines).identifiers;
    if (markers.length !== 1) continue;
    for (const number of lines.flatMap(collectorOcrAlternatives)) {
      const value = {...markers[0], number};
      alternatives.set(`${value.set}:${value.language}:${number}`, value);
    }
  }
  const withAlternatives = <T extends typeof initial>(value: T): T & {collectorAlternatives?: {set: string; language: string; number: string}[]} =>
    alternatives.size ? {...value, collectorAlternatives: alternatives.size <= 4 ? [...alternatives.values()] : [], recoveredLayout: true} : value;
  if (!supplemental.length && !sourceIdentifiers.length) return withAlternatives(initial);
  const excluded=supplementalOutsideCollector(supplemental,spatial);
  const combined = acquisitionFooterIdentifiers([...primary, ...supplemental.filter(line=>!excluded.has(line)), ...sourceIdentifiers]);
  const addedIdentifier = combined.identifiers.some(value => !initial.identifiers.some(
    old => old.set === value.set && old.language === value.language));
  const addedCollector = combined.collectors.some(value => !initial.collectors.includes(value));
  return withAlternatives({...combined, recoveredLayout: combined.recoveredLayout || excluded.size>0 || addedIdentifier || addedCollector});
}
