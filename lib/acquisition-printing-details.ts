import { z } from "zod";

export const PRINTING_DETAIL_VERSION = "registered-printing-details-v1";
export const printingDetailBounds = {
  TYPE_LINE: [80, 745, 950, 885], SET_SYMBOL_AREA: [790, 745, 960, 900],
  FOOTER: [110, 1230, 910, 1375], LEFT_FRAME: [8, 260, 85, 1210], RIGHT_FRAME: [915, 260, 992, 1210],
} as const;
export const printingDetailRegion = z.enum(["TYPE_LINE", "SET_SYMBOL_AREA", "FOOTER", "LEFT_FRAME", "RIGHT_FRAME"]);
const bounds = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(),
  z.number().int().max(1000), z.number().int().max(1397)]);
const status = z.enum(["MEASURED", "UNREADABLE"]);
const reason = z.string().regex(/^[A-Z_]{1,80}$/);
export const printingDetailSchema = z.object({
  version: z.literal(PRINTING_DETAIL_VERSION),
  regions: z.array(z.object({region: printingDetailRegion, bounds, status, reason,
    correlation: z.number().finite().min(-1).max(1).optional(),
    colorResidual: z.number().finite().min(0).max(255).optional(),
    colorResidual95: z.number().finite().min(0).max(255).optional(),
    sourceSharpness: z.number().finite().nonnegative().optional(),
    referenceSharpness: z.number().finite().nonnegative().optional(),
    localOffset: z.tuple([z.number().int().min(-4).max(4),z.number().int().min(-4).max(4)]).optional(),
  })).length(5),
}).superRefine((value,ctx)=>{
  const seen = new Set<string>();
  for(const row of value.regions){
    if(seen.has(row.region) || row.bounds.some((n,i)=>n !== printingDetailBounds[row.region][i]))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:"Detail region differs or repeats"});
    seen.add(row.region);
    if(row.status === "MEASURED" && (row.reason !== "VISIBLE_REFERENCE_COMPARISON" ||
      (row.correlation === undefined && row.colorResidual === undefined)))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:"Measured detail requires observed comparison"});
  }
});
export type PrintingDetails = z.infer<typeof printingDetailSchema>;
export const printingReferenceImageSchema = z.object({uri:z.string().url().max(500),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
export function validPrintingReferenceImage(uri:string, id:string, face:string) {
  if(face !== "0" && face !== "1")return false;
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:" && parsed.hostname === "cards.scryfall.io" &&
      !parsed.port && !parsed.username && !parsed.password && !parsed.hash &&
      /^\/(normal|large|png)\/(front|back)\/[a-f0-9]\/[a-f0-9]\/[a-f0-9-]{36}\.(jpg|png)$/.test(parsed.pathname) &&
      parsed.pathname.includes(`/${face === "1" ? "back" : "front"}/`) &&
      (parsed.pathname.endsWith(`/${id}.jpg`) || parsed.pathname.endsWith(`/${id}.png`)) &&
      /^\??[0-9]{0,14}$/.test(parsed.search);
  } catch { return false; }
}
export const printingDetailSummarySchema = z.object({
  version: z.literal(PRINTING_DETAIL_VERSION),
  regions: z.array(z.object({region:printingDetailRegion,status,reason})).length(5),
});
export function printingDetailSummary(details: PrintingDetails) {
  return {version:details.version,regions:details.regions.map(({region,status,reason})=>({region,status,reason}))};
}

export const printingDetailLabels = {
  TYPE_LINE:"Type-line band", SET_SYMBOL_AREA:"Set-symbol area", FOOTER:"Footer",
  LEFT_FRAME:"Left frame", RIGHT_FRAME:"Right frame",
} as const;
