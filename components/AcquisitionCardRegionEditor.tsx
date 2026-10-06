"use client";
import { useRef, useState } from "react";
import { acquisitionManualRegionSchema, type AcquisitionManualRegion } from "@/lib/acquisition-manual-region";
import type { AcquisitionCardReview } from "@/lib/acquisition-review";
import { filterButtonClass as button, filterPrimaryButtonClass as primary } from "./filterStyles";

const initial: AcquisitionManualRegion = {version: 1, quad: [[.02, .02], [.98, .02], [.98, .98], [.02, .98]]};
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function AcquisitionCardRegionEditor({src, record, latestRevision, busy, apply, cancel}: {
  src: string; record: AcquisitionCardReview; latestRevision: number; busy: boolean;
  apply: (region: AcquisitionManualRegion | null, revision: number, requestKey: string) => Promise<void>;
  cancel: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [region, setRegion] = useState<AcquisitionManualRegion>(record.manualRegion ?? initial);
  const [revision] = useState(record.revision);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  const [failedBody, setFailedBody] = useState<string | null>(null);
  const retry = useRef<{body: string; requestKey: string} | null>(null);
  function corner(index: number, x: number, y: number) {
    setRegion(previous => ({version: 1, quad: previous.quad.map((point, i) =>
      i === index ? [clamp(x), clamp(y)] : point) as AcquisitionManualRegion["quad"]}));
    setError("");
  }
  async function save(next: AcquisitionManualRegion | null) {
    const checked = next === null ? null : acquisitionManualRegionSchema.safeParse(next);
    if (checked && !checked.success) {setError("Place four separate corners around the whole card, without crossing edges."); return;}
    const body = JSON.stringify(next);
    if (retry.current?.body !== body) retry.current = {body, requestKey: crypto.randomUUID()};
    try {await apply(next, revision, retry.current.requestKey);}
    catch (failure) {setFailedBody(body); setError((failure as Error).message);}
  }
  // A lost acknowledgement may already have advanced the server revision.
  // Retrying its exact command is safe; a new selection still needs a fresh
  // review. The server decides whether the retained request was applied.
  const canRetry = (next: AcquisitionManualRegion | null) => Boolean(error && failedBody === JSON.stringify(next));
  return <section aria-label="Card boundary editor" className="my-4 rounded border p-3 min-w-0">
    <h4 className="font-semibold">Choose the card boundary</h4>
    <p className="text-sm my-2">Move the four corners around the complete card, including its border and footer. Use the arrow keys for small adjustments; hold Shift for larger steps. Missing edges require another photo.</p>
    <div ref={frame} className="relative max-w-lg mx-auto my-7">
      <img src={src} alt="Original photo for choosing the card boundary" className="block w-full h-auto"
        onLoad={() => {setLoaded(true); setError("");}}
        onError={() => {setLoaded(false); setError("The original photo could not load. Reopen the boundary editor to retry.");}} />
      {loaded && <>
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none">
          <polygon points={region.quad.map(([x,y]) => `${x*1000},${y*1000}`).join(" ")} fill="rgba(0,255,255,.1)" stroke="#00ffff" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg>
        {region.quad.map(([x,y], index) => <button key={index} type="button" disabled={busy}
          aria-label={`Card corner ${index + 1}`} title={`Corner ${index + 1}: ${Math.round(x*100)}% across, ${Math.round(y*100)}% down`}
          className="absolute rounded-full border-2 border-white bg-sky-700 text-white w-11 h-11 text-sm font-bold focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-sky-400"
          style={{left: `${x*100}%`, top: `${y*100}%`, transform: "translate(-50%,-50%)", touchAction: "none"}}
          onPointerDown={event => {event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);}}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId) || !frame.current || busy) return;
            const bounds = frame.current.getBoundingClientRect();
            corner(index, (event.clientX-bounds.left)/bounds.width, (event.clientY-bounds.top)/bounds.height);
          }}
          onPointerUp={event => {if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);}}
          onKeyDown={event => {
            const step = event.shiftKey ? .02 : .002;
            const move = {ArrowLeft: [-step,0], ArrowRight: [step,0], ArrowUp: [0,-step], ArrowDown: [0,step]}[event.key];
            if (move) {event.preventDefault(); event.stopPropagation(); corner(index,x+move[0],y+move[1]);}
          }}>{index+1}</button>)}
      </>}
    </div>
    {revision !== latestRevision && <p role="alert" className="text-sm">This card changed while you were editing. Your corners are kept; cancel and reopen to use the latest review.</p>}
    {error && <p role="alert" className="text-sm my-2">{error}</p>}
    <p className="text-sm my-2">The original photo and saved printing choice are kept. A boundary selection still needs printing review.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={primary} disabled={busy || !loaded || (revision !== latestRevision && !canRetry(region))} onClick={() => void save(region)}>Apply boundary and recheck</button>
      <button type="button" className={button} disabled={busy || (revision !== latestRevision && !canRetry(null))} onClick={() => void save(null)}>Use automatic boundary</button>
      <button type="button" className={button} disabled={busy} onClick={cancel}>Cancel boundary changes</button>
    </div>
  </section>;
}
