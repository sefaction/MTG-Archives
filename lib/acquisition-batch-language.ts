import {z} from "zod";
import {acquisitionFooterObservations} from "./acquisition-footer";
import type {RecognitionText, createAcquisitionRecognitionIndex} from "./acquisition-recognition";

export const acquisitionBatchLanguages = ["en", "fr", "de", "it", "es", "pt", "ja", "ko", "ru", "zhs", "zht"] as const;
export const acquisitionBatchLanguageSchema = z.enum(acquisitionBatchLanguages);
export const acquisitionLanguageLabels: Record<typeof acquisitionBatchLanguages[number], string> = {
  en:"English",fr:"French",de:"German",it:"Italian",es:"Spanish",pt:"Portuguese",
  ja:"Japanese",ko:"Korean",ru:"Russian",zhs:"Simplified Chinese",zht:"Traditional Chinese",
};

// This identifies a clear saved set-code line, not a language observation. A
// numeric token such as C13 can also be a rarity/collector row; without printed
// punctuation it remains ambiguous and cannot gain certainty from a default.
export function acquisitionUntranslatedSetMarkers(lines:string[], knownSets:Set<string>) {
  if(lines.length>100||lines.some(line=>line.length>2000))throw Error("OCR footer evidence exceeds bounds");
  return [...new Set(lines.flatMap(line=>{
    const match=/^\s*([A-Z0-9]{2,8})\s*([·•*])?\s*$/i.exec(line);
    if(!match||(!match[2]&&/\d/.test(match[1]))||!knownSets.has(match[1].toUpperCase()))return [];
    return [match[1].toLowerCase()];
  }))];
}

export function acquisitionObservedLanguages(orientations:{text:RecognitionText}[]) {
  return [...new Set(orientations.flatMap(({text})=>{
    const footer=acquisitionFooterObservations(text.footer,text.footerSupplemental,text.footerSourceIdentifiers);
    // OCR may put the language in its own box/line. Preserve that observation
    // as a veto; never join it to another line/channel to invent an identifier.
    const isolated=[text.footer,text.footerSupplemental??[],text.footerSourceIdentifiers??[]].flatMap(lines=>
      lines.flatMap(line=>line.split(/\r?\n/)).flatMap(line=>{
        const code=acquisitionBatchLanguageSchema.safeParse(line.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,"").toLowerCase());
        return code.success?[code.data]:[];
      }));
    // A readable code may share an OCR line with artist/copyright text. Keep
    // complete words as uncertainty vetoes, without stitching a set identifier.
    // Retain the isolated parser above, including its punctuation handling.
    const words=[text.footer,text.footerSupplemental??[],text.footerSourceIdentifiers??[]].flatMap(lines=>
      lines.flatMap(line=>line.match(/[\p{L}\p{M}\p{N}_]+/gu)??[]).flatMap(word=>{
        const code=acquisitionBatchLanguageSchema.safeParse(word.toLowerCase());
        return code.success?[code.data]:[];
      }));
    return [...footer.identifiers.map(value=>value.language),...isolated,...words];
  }))];
}

const footerWords=z.array(z.string().max(2000)).max(100);
const readableSource=z.object({native:z.object({orientations:z.array(z.object({text:z.object({
  footer:footerWords,footerSupplemental:footerWords.optional(),footerSourceIdentifiers:footerWords.optional(),
}).refine(text=>text.footer.length+(text.footerSupplemental?.length??0)+(text.footerSourceIdentifiers?.length??0)<=100)})).length(2)})});
export function acquisitionObservedLanguageEvidence(output:unknown) {
  const source=readableSource.safeParse(output);
  if(!source.success)return null;
  return acquisitionObservedLanguages(source.data.native.orientations.map(row=>({text:{...row.text,title:[]}})));
}
export function acquisitionBatchLanguageAgrees(output:unknown,language:string) {
  const observed=acquisitionObservedLanguageEvidence(output);
  return observed!==null && observed.every(value=>value===language);
}

export function acquisitionBatchLanguageCandidates(index:ReturnType<typeof createAcquisitionRecognitionIndex>,
  orientations:{text:RecognitionText}[]) {
  if(acquisitionObservedLanguages(orientations).length)return [];
  const available=new Set<string>();
  for(const {text} of orientations){
    const sets=acquisitionUntranslatedSetMarkers(text.footer,index.sets);
    const footer=acquisitionFooterObservations(text.footer,text.footerSupplemental,text.footerSourceIdentifiers);
    if(sets.length!==1||footer.collectors.length!==1||footer.recoveredLayout)continue;
    for(const card of index.byPrintedSetNumber.get(`${sets[0]}:${footer.collectors[0]}`)??[])
      if(card.lang)available.add(card.lang.toLowerCase());
  }
  return acquisitionBatchLanguages.filter(language=>available.has(language));
}
