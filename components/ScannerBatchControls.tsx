"use client";
import { useEffect, useState, useRef } from "react";
import type { listScannerAgents } from "@/lib/scanner-store";
import type { getScannerBatch } from "@/lib/scanner-runs";
import { filterButtonClass as button, filterInputClass as input, filterPanelClass as panel } from "./filterStyles";
import { scannerPreflightMessage } from "@/lib/scanner-preflight-message";
import { ScannerDiscoveryNotice } from "./ScannerDiscoveryNotice";
import { isCountedScannerDevice, countedScannerSettings } from "@/lib/scanner-counted-profile";
type Agent = Awaited<ReturnType<typeof listScannerAgents>>[number];
type Run = Awaited<ReturnType<typeof getScannerBatch>>;
export type ScannerChoice = { agentId: string; deviceId: string; loadedCount: null;
  operatorLoadedSimplexFronts: true; settings: { dpi: 300 | 600; widthInches: number; heightInches: number;
    horizontalPlacement: "Start" | "Center" | "End"; duplex: false; color: "RGB"; autoCrop: false; deskew: false; removeBlank: false } };
async function call<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Scanner request failed; originals remain saved.");
  return value;
}
export function ScannerSourceFields({ initialEnabled, initialChoice, onChange, remaining, disabled }: { initialEnabled: boolean; initialChoice?: ScannerChoice; onChange: (value: ScannerChoice | null, enabled: boolean, detecting?: boolean) => void; remaining: number | null; disabled: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]), [selected, setSelected] = useState(initialChoice ? `${initialChoice.agentId}/${initialChoice.deviceId}` : "");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [dpi, setDpi] = useState<300 | 600>(initialChoice?.settings.dpi ?? 600), [error, setError] = useState("");
  const [placement, setPlacement] = useState<ScannerChoice["settings"]["horizontalPlacement"]>(initialChoice?.settings.horizontalPlacement ?? "Center");
  const frame = initialChoice?.settings;
  const counted = isCountedScannerDevice(agents.flatMap(a=>a.devices).find(d=>selected.endsWith('/'+d.id)) ?? { id: "", backend: "" });
  const refresh = async () => { try { setAgents((await call<{ agents: Agent[] }>("/api/scanners")).agents); setError(""); } catch (e) { setError((e as Error).message); } };
  useEffect(() => {
    if (!enabled) return;
    const immediate = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => { clearTimeout(immediate); clearInterval(timer); };
  }, [enabled]);
  const sources = agents.filter(a=>a.online && a.agentVersion === "0.3.0-native").flatMap(a=>a.devices
    .filter(d=>d.qualification!=="Unsupported").map(d=>({ key: `${a.id}/${d.id}`, agentId: a.id, device: d,
      detecting: a.discoveryIssues?.some(issue=>issue.code==="DISCOVERY_IN_PROGRESS") ?? false })));
  const detecting = agents.some(agent=>agent.online &&
    (!selected || selected.startsWith(`${agent.id}/`)) &&
    agent.discoveryIssues?.some(issue=>issue.code==="DISCOVERY_IN_PROGRESS")) &&
    (!!selected || sources.every(source=>source.detecting));
  useEffect(() => {
    if (selected || !sources.length) return;
    let remembered: string | null = null;
    try { remembered = localStorage.getItem("mtg-scanner-source"); } catch { /* Optional preference. */ }
    const preferred = sources.find(s=>s.key===remembered) ?? (sources.length===1 ? sources[0] : null);
    if (preferred) {
      const timer = setTimeout(() => setSelected(preferred.key), 0);
      return () => clearTimeout(timer);
    }
  }, [agents, selected, sources]);
  useEffect(() => {
    const source = sources.find(s=>s.key === selected);
    onChange(enabled && source && !source.detecting ? { agentId: source.agentId, deviceId: source.device.id, loadedCount: null,
        operatorLoadedSimplexFronts: true, settings: counted ? countedScannerSettings : { dpi, widthInches: frame?.widthInches ?? 2.6, heightInches: frame?.heightInches ?? 3.6, horizontalPlacement: placement,
          duplex: false, color: "RGB", autoCrop: false, deskew: false, removeBlank: false } } : null, enabled, enabled && detecting);
  // sources are refreshed by explicit user action; dependencies are the underlying inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, selected, enabled, dpi, placement, remaining, onChange, frame, detecting, counted]);
  return <fieldset id="scanner-source" className="space-y-3 min-w-0 my-3" disabled={disabled}>
    <legend className="font-semibold">3. Card input</legend>
    <label className="flex gap-2 items-start"><input type="checkbox" checked={enabled}
      onChange={e=>{ setEnabled(e.target.checked); if(e.target.checked) void refresh(); else onChange(null,false); }} />Scan from a connected scanner</label>
    {enabled && <>
      <p className="text-sm">{counted ? "This fi-7160 source requests the selected count before feeding. Clean runs use saved front images for the assumed card count; watch for feeding problems." : "Choose the scanner once. The Start scanner batch button scans everything in the feeder."}</p>
      <div className="flex flex-wrap gap-2 items-center"><label className="min-w-0 flex-1">Scanner source
        <select className={input+" block w-full max-w-full mt-1"} value={selected} onChange={e=>{setSelected(e.target.value);try {localStorage.setItem("mtg-scanner-source",e.target.value);} catch { /* Optional preference. */ }}}>
          <option value="">Choose a source</option>{selected && !sources.some(s=>s.key === selected) && <option value={selected} disabled>Previous scanner source (offline)</option>}{sources.map(s=><option key={s.key} value={s.key}>{s.device.name} · {s.device.source}</option>)}
        </select></label><button className={button} type="button" onClick={()=>void refresh()}>Refresh scanners</button></div>
      {sources.length===0 && !agents.some(agent=>agent.online && agent.discoveryIssues?.some(issue=>issue.code==="DISCOVERY_IN_PROGRESS")) && <p className="text-sm">{agents.some(agent=>agent.online)
        ? "No scanner source is available yet. Check its USB connection, power and manufacturer driver."
        : "Connect a scanner above; available sources will appear here automatically."}</p>}
      <ScannerDiscoveryNotice issues={agents.filter(agent=>agent.online &&
        (!selected || agent.id===sources.find(source=>source.key===selected)?.agentId))
        .flatMap(agent=>agent.discoveryIssues ?? [])} />
      <details hidden={counted}><summary className="cursor-pointer text-sm">Scan settings · {dpi} DPI · {placement === "Center" ? "Center" : placement === "Start" ? "Start edge" : "End edge"}</summary>
        <label className="block mt-2">Resolution<select className={input+" block mt-1"} value={dpi} onChange={e=>setDpi(Number(e.target.value) as 300|600)}>
          <option value={600}>600 DPI (default)</option><option value={300}>300 DPI</option></select></label>
        <label className="block mt-2">Card position<select className={input+" block w-full max-w-full mt-1"} value={placement}
          onChange={e=>setPlacement(e.target.value as ScannerChoice["settings"]["horizontalPlacement"])}>
          <option value="Center">Center</option><option value="Start">Start edge</option><option value="End">End edge</option></select></label>
        <p className="text-sm mt-2">Match the position of the cards in the feeder. Use Center when the guides hold cards in the middle.</p>
        <p className="text-sm mt-2">Simplex color, fixed {frame?.widthInches ?? 2.6} × {frame?.heightInches ?? 3.6} inch frame; crop, deskew and blank removal off.</p>
      </details>
      <p className="text-sm">{counted ? "600 DPI card fronts with the Cards profile and Pre-Pick Off. Clean runs count saved fronts automatically. If the hopper empties early, refill and resume the same batch. Clear the transport before Start. Stop waits for the current scan." : "Load card fronts and clear the transport. Start scans everything in the feeder; it does not stop at a chosen count. Keep the loaded cards within the destination's remaining capacity. Stop requests drain the feeder."}</p>
      {error && <p role="alert">{error}</p>}
    </>}
  </fieldset>;
}
export function ScannerRunControls({ runId, savedImages, refresh }: { runId: string; savedImages: number; refresh: ()=>Promise<void> }) {
  const [run, setRun] = useState<Run | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [emitted, setEmitted] = useState(0), [observed, setObserved] = useState(false);
  const [remainingCards, setRemainingCards] = useState(0), [refillReady, setRefillReady] = useState(false);
  const refillKey = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => { try { const result = await call<Run>("/api/scanners/runs?run="+runId); if(active) setRun(result); }
      catch(e) { if(active) setError((e as Error).message); } };
    void load(); const timer = setInterval(()=>void load(),2000);
    return ()=>{active=false;clearInterval(timer);};
  }, [runId]);
  useEffect(() => {
    const timer = setTimeout(()=>{ setObserved(false); setRefillReady(false); setEmitted(0); setRemainingCards(0); refillKey.current = null; },0);
    return ()=>clearTimeout(timer);
  }, [run?.runId]);
  async function act(body: object) {
    setBusy(true);setError("");
    try { await call("/api/scanners/runs",body); setRun(await call<Run>("/api/scanners/runs?run="+runId)); await refresh(); }
    catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  const paused = run?.counted && run.phase === "PAUSED";
  const cancelled = (run?.reconciliation as { mode?: string } | null)?.mode === "CANCELLED_WITHOUT_START";
  return <section className={panel+" min-w-0 space-y-3"} aria-label="Scanner batch">
    <h3 className="font-semibold">Scanner batch</h3>
    {run?.series && <div className="space-y-2">
      <p role="status">Section series · batch {run.series.ordinal + 1}. {run.series.stopped ? "Series stopped. Saved cards remain available for review and explicit Inventory addition." : "Choose each next section yourself; scanning waits for your Start."}</p>
      {!run.series.stopped && <button className={button} disabled={busy} onClick={()=>void act({action:"stop-series",runId:run.runId})}>Stop section series</button>}
      {!run.series.current && <a className={button} href={`/imports/scan?input=scanner&continue=${run.series.latestRunId}`}>Current section series</a>}
    </div>}
    <p role="status">{run?.status === "QUEUED" ? scannerPreflightMessage(run.preflightProblem) ?? "Waiting for the Windows helper to start." : run?.status === "STARTED" ? "Scanning and uploading." :
      run?.status === "DRAINED" ? run.series?.stopped ? "Scanner series ended. Saved cards remain available for review." : paused ? "Hopper emptied early. "+run.remainingTarget+(run.remainingTarget === 1 ? " card remains" : " cards remain")+" in this batch." : run.counted ? (run.remainingTarget > 0 ? "Batch ended with saved cards. " : "Selected count reached. ")+(run.batchLimit !== null ? "Use New scanner batch for another fixed-count scan." : "Choose the next section before feeding more.") : "Scanner run ended." : run?.status === "CANCELLED_BEFORE_START" && cancelled ? "Waiting scan cancelled. The helper was not authorized to feed cards." : run ? "Scanner run needs reconciliation; originals remain saved." : "Loading scanner status."}
      {" "}{savedImages} {savedImages === 1 ? "image" : "images"} saved.</p>
    <p className="text-sm">Clean runs count one saved card front per card automatically. Saved images and reviews stay in this batch; interrupted runs need recovery.</p>
    {run && ["QUEUED","STARTED"].includes(run.status) && <button className={button} disabled={busy || run.stopRequested}
      onClick={()=>void act({action:"stop",runId:run.runId})}>{run.stopRequested ? "Stop requested; current run will finish" : run.status === "QUEUED" ? "Cancel waiting scan" : run.counted ? "End after current count" : "Request stop (drain feeder)"}</button>}
    {run && ["DRAINED","ERROR","CANCELLED_BEFORE_START"].includes(run.status) && !run.reconciliation && <fieldset className="space-y-3">
      <legend className="font-semibold">Verify the physical batch</legend>
      {run.status === "CANCELLED_BEFORE_START" && <p>Cancelled before the helper claimed the scan. Remove the loaded cards, then confirm zero emitted and an empty feeder/transport.</p>}
      <label>Cards physically emitted<input className={input+" block w-28 mt-1"} type="number" min={0} max={5000}
        value={emitted} onChange={e=>{setEmitted(Number(e.target.value));setObserved(false);}} /></label>
      {run.counted && <label>Cards still wholly in the hopper<input className={input+" block w-28 mt-1"} type="number" min={0} max={500}
        value={remainingCards} onChange={e=>{setRemainingCards(Number(e.target.value));setObserved(false);}} /></label>}
      <label className="flex gap-2 items-start"><input type="checkbox" checked={observed} onChange={e=>setObserved(e.target.checked)} />
        {run.counted ? "Transport is clear and remaining cards are wholly in the hopper, with no damage, jam or double feed. Each saved image is one emitted card front." : "Feeder and transport are empty, with no jam or double feed. Each saved image is the front of one emitted card."}</label>
      <button className={button} disabled={busy || !observed} onClick={()=>void act({action:"reconcile",runId:run.runId,cardsEmitted:emitted,
        feederEmpty: !run.counted || remainingCards === 0,transportEmpty:true,eachImageIsOneCardFront:true,noJamOrDouble:true,
        ...(run.counted ? { remainingCards, remainingWhollyInHopper: true } : {})})}>Confirm physical count</button>
    </fieldset>}
    {run?.reconciliation && (cancelled ? <p>No physical count is needed. Your loaded cards were not scanned by this segment.</p> :
      <p>{(run.reconciliation as { mode?: string }).mode === "SCANNER_IMAGE_COUNT" ? "Image count recorded automatically." : "Physical count confirmed."} Review the matches below, then add selected cards to Inventory.</p>)}
    {paused && run?.reconciliation && <fieldset className="space-y-3">
      <legend className="font-semibold">Refill this batch</legend>
      <p>{run.remainingTarget} {run.remainingTarget === 1 ? "card remains" : "cards remain"} in this batch. Saved images and reviews stay in this batch.</p>
      {!run.series?.stopped && <label className="flex gap-2 items-start"><input type="checkbox" checked={refillReady} onChange={e=>setRefillReady(e.target.checked)} />
        I refilled card fronts, checked the guides and clear transport, and no other scan job owns the scanner.</label>
      }
      <div className="flex flex-wrap gap-2">{!run.series?.stopped && <button className={button} disabled={busy || !refillReady} onClick={()=>{
        refillKey.current ??= crypto.randomUUID(); void act({action:"refill",runId:run.runId,requestKey:refillKey.current,
          loadedCount:null,operatorLoadedSimplexFronts:true});
      }}>Resume unfinished batch</button>}<button className={button} disabled={busy} onClick={()=>void act({action:"end",runId:run.runId})}>End batch with saved cards</button></div>
    </fieldset>}
    {run?.counted && run.status === "ERROR" && run.reconciliation && run.phase === "STOPPING" && <div className="space-y-2">
      <p role="alert">Count mismatch or driver error. Keep cards and originals; inspect the transport and driver before any further feeding.</p>
      <button className={button} disabled={busy} onClick={()=>void act({action:"end",runId:run.runId})}>End reconciled batch</button>
    </div>}
    {run?.reconciliation && !run.series?.stopped && (!run.series || run.series.current) && (!run.counted || ["COMPLETE", "CANCELLED"].includes(run.phase)) && <div className="flex flex-wrap gap-2">
      <a className={button} href={"/imports/scan?input=scanner&continue="+encodeURIComponent(runId)+"#new-scan-batch"}>{run.counted && run.batchLimit === null ? "Choose next section" : "New scanner batch"}</a>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
