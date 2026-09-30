"use client";
import { useEffect, useState } from "react";
import type { listScannerAgents } from "@/lib/scanner-store";
import type { getScannerBatch } from "@/lib/scanner-runs";
import { filterButtonClass as button, filterInputClass as input, filterPanelClass as panel } from "./filterStyles";
import { scannerPreflightMessage } from "@/lib/scanner-preflight-message";
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
export function ScannerSourceFields({ initialEnabled, initialChoice, onChange, remaining, disabled }: { initialEnabled: boolean; initialChoice?: ScannerChoice; onChange: (value: ScannerChoice | null, enabled: boolean) => void; remaining: number | null; disabled: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]), [selected, setSelected] = useState(initialChoice ? `${initialChoice.agentId}/${initialChoice.deviceId}` : "");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [dpi, setDpi] = useState<300 | 600>(initialChoice?.settings.dpi ?? 600), [error, setError] = useState("");
  const frame = initialChoice?.settings;
  const refresh = async () => { try { setAgents((await call<{ agents: Agent[] }>("/api/scanners")).agents); setError(""); } catch (e) { setError((e as Error).message); } };
  useEffect(() => {
    if (!enabled) return;
    const immediate = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => { clearTimeout(immediate); clearInterval(timer); };
  }, [enabled]);
  const sources = agents.filter(a=>a.online && a.agentVersion === "0.3.0-native").flatMap(a=>a.devices
    .filter(d=>d.qualification!=="Unsupported").map(d=>({ key: `${a.id}/${d.id}`, agentId: a.id, device: d })));
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
    onChange(enabled && source && remaining!==0 ? { agentId: source.agentId, deviceId: source.device.id, loadedCount: null,
        operatorLoadedSimplexFronts: true, settings: { dpi, widthInches: frame?.widthInches ?? 2.6, heightInches: frame?.heightInches ?? 3.6, horizontalPlacement: frame?.horizontalPlacement ?? "Start",
          duplex: false, color: "RGB", autoCrop: false, deskew: false, removeBlank: false } } : null, enabled);
  // sources are refreshed by explicit user action; dependencies are the underlying inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, selected, enabled, dpi, remaining, onChange, frame]);
  return <fieldset id="scanner-source" className="space-y-3 min-w-0 my-3" disabled={disabled}>
    <legend className="font-semibold">3. Card input</legend>
    <label className="flex gap-2 items-start"><input type="checkbox" checked={enabled}
      onChange={e=>{ setEnabled(e.target.checked); if(e.target.checked) void refresh(); else onChange(null,false); }} />Scan from a connected scanner</label>
    {enabled && <>
      <p className="text-sm">Choose the scanner once. The Start scanner batch button scans everything in the feeder.</p>
      <div className="flex flex-wrap gap-2 items-center"><label className="min-w-0 flex-1">Scanner source
        <select className={input+" block w-full max-w-full mt-1"} value={selected} onChange={e=>{setSelected(e.target.value);try {localStorage.setItem("mtg-scanner-source",e.target.value);} catch { /* Optional preference. */ }}}>
          <option value="">Choose a source</option>{selected && !sources.some(s=>s.key === selected) && <option value={selected} disabled>Previous scanner source (offline)</option>}{sources.map(s=><option key={s.key} value={s.key}>{s.device.name} · {s.device.source}</option>)}
        </select></label><button className={button} type="button" onClick={()=>void refresh()}>Refresh scanners</button></div>
      {sources.length===0 && <p className="text-sm">Connect a scanner above; available sources will appear here automatically.</p>}
      <details><summary className="cursor-pointer text-sm">Scan settings · {dpi} DPI</summary>
        <label className="block mt-2">Resolution<select className={input+" block mt-1"} value={dpi} onChange={e=>setDpi(Number(e.target.value) as 300|600)}>
          <option value={600}>600 DPI (default)</option><option value={300}>300 DPI</option></select></label>
        <p className="text-sm mt-2">Simplex color, fixed {frame?.widthInches ?? 2.6} × {frame?.heightInches ?? 3.6} inch frame; crop, deskew and blank removal off.</p>
      </details>
      <p className="text-sm">Load card fronts and clear the transport. Start scans everything in the feeder; it does not stop at a chosen count. Keep the loaded cards within the destination&apos;s remaining capacity. Stop requests drain the feeder.</p>
      {error && <p role="alert">{error}</p>}
    </>}
  </fieldset>;
}
export function ScannerRunControls({ runId, savedImages, refresh }: { runId: string; savedImages: number; refresh: ()=>Promise<void> }) {
  const [run, setRun] = useState<Run | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [emitted, setEmitted] = useState(0), [observed, setObserved] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => { try { const result = await call<Run>(`/api/scanners/runs?run=${runId}`); if(active) { setRun(result); setError(""); } }
      catch(e) { if(active) setError((e as Error).message); } };
    void load(); const timer = setInterval(()=>void load(),2000);
    return ()=>{active=false;clearInterval(timer);};
  }, [runId]);
  async function act(body: object) {
    setBusy(true);setError("");
    try { await call("/api/scanners/runs",body); setRun(await call<Run>(`/api/scanners/runs?run=${runId}`)); await refresh(); }
    catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <section className={panel+" min-w-0 space-y-3"} aria-label="Scanner batch">
    <h3 className="font-semibold">Scanner batch</h3>
    <p role="status">{run?.status === "QUEUED" ? scannerPreflightMessage(run.preflightProblem) ?? "Waiting for the Windows helper to start." : run?.status === "STARTED" ? "Scanning and uploading…" :
      run?.status === "DRAINED" ? "Scanner run ended." : run?.status === "CANCELLED_BEFORE_START" && (run.reconciliation as { mode?: string } | null)?.mode === "CANCELLED_WITHOUT_START" ? "Waiting scan cancelled. The helper was not authorized to feed cards." : run ? "Scanner run needs reconciliation; originals remain saved." : "Loading scanner status…"}
      {" "}{savedImages} {savedImages === 1 ? "image" : "images"} saved.</p>
    <p className="text-sm">A clean feeder run uses one saved front image per card. Check the images for missed cards or double feeds; interrupted runs need manual reconciliation.</p>
    {run && ["QUEUED","STARTED"].includes(run.status) && <button className={button} disabled={busy || run.stopRequested}
      onClick={()=>void act({action:"stop",runId})}>{run.stopRequested ? "Stop requested · feeder will drain" : run.status === "QUEUED" ? "Cancel waiting scan" : "Request stop (drain feeder)"}</button>}
    {run && ["DRAINED","ERROR","CANCELLED_BEFORE_START"].includes(run.status) && !run.reconciliation && <fieldset className="space-y-3">
      <legend className="font-semibold">Verify the physical batch</legend>
      {run.status === "CANCELLED_BEFORE_START" && <p>Cancelled before the helper claimed the scan. Remove the loaded cards, then confirm zero emitted and an empty feeder/transport.</p>}
      <label>Cards physically emitted<input className={input+" block w-28 mt-1"} type="number" min={0} max={5000}
        value={emitted} onChange={e=>{setEmitted(Number(e.target.value));setObserved(false);}} /></label>
      <label className="flex gap-2 items-start"><input type="checkbox" checked={observed} onChange={e=>setObserved(e.target.checked)} />
        Feeder and transport are empty, with no jam or double feed. Each saved image is the front of one emitted card.</label>
      <button className={button} disabled={busy || !observed} onClick={()=>void act({action:"reconcile",runId,cardsEmitted:emitted,
        feederEmpty:true,transportEmpty:true,eachImageIsOneCardFront:true,noJamOrDouble:true})}>Confirm physical count</button>
    </fieldset>}
    {run?.reconciliation && ((run.reconciliation as { mode?: string }).mode === "CANCELLED_WITHOUT_START" ?
      <p>No physical count is needed. Your loaded cards were not scanned by this batch.</p> :
      <p>{(run.reconciliation as { mode?: string }).mode === "SCANNER_IMAGE_COUNT" ? "Image count recorded automatically." : "Physical count confirmed."} Review the matches below, then add selected cards to Inventory.</p>)}
    {run?.reconciliation && <div className="flex flex-wrap gap-2">
      <a className={button} href={`/imports/scan?input=scanner&continue=${encodeURIComponent(runId)}#new-scan-batch`}>New scanner batch</a>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
