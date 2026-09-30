"use client";
import { useCallback, useEffect, useState } from "react";
import { filterButtonClass, filterPanelClass, filterPrimaryButtonClass } from "./filterStyles";
import type { listScannerAgents } from "@/lib/scanner-store";
import { ScannerDiscoveryNotice } from "./ScannerDiscoveryNotice";
type Agent = Awaited<ReturnType<typeof listScannerAgents>>[number];
export function ScannerConnections({ newBatchHref }: { newBatchHref: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [addAnother, setAddAnother] = useState(false);
  const [installerAvailable, setInstallerAvailable] = useState(false);
  const [installerVersion, setInstallerVersion] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function openHelper() {
    setWaiting(true);
    window.location.href = `mtg-archive-scanner://resume?site=${encodeURIComponent(window.location.origin + "/")}`;
  }
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/scanners", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error("Scanner connections unavailable. Refresh and retry.");
      setAgents(value.agents);
      setError("");
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!expanded) return;
    void fetch("/api/scanners/installer?info", { cache: "no-store" })
      .then(response => response.ok ? response.json() : { available: false })
      .then(value => { setInstallerAvailable(value.available === true); setInstallerVersion(value.version ?? null); })
      .catch(() => setInstallerAvailable(false));
  }, [expanded]);
  const showWaiting = waiting && !agents.some(agent => agent.online);
  const hasOnline = agents.some(agent => agent.online);
  const showSetup = !hasOnline || addAnother;
  async function action(value: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/scanners", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      const result = await response.json();
      if (!response.ok) throw new Error("Scanner connection could not be saved. Refresh and retry.");
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function connect() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/scanners", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pair" }) });
      const result = await response.json();
      if (!response.ok || typeof result.code !== "string") throw new Error("Could not start scanner connection. Try again.");
      const uri = `mtg-archive-scanner://connect?site=${encodeURIComponent(window.location.origin + "/")}&code=${encodeURIComponent(result.code)}`;
      setWaiting(true);
      window.location.href = uri;
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className={`${filterPanelClass} min-w-0`} aria-label="Scanner connections">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={filterButtonClass} aria-expanded={expanded}
        onClick={() => { setExpanded(!expanded); if (expanded) setAddAnother(false); else void refresh(); }}>
        {hasOnline ? "Scanner connected" : "Connect a scanner"}</button>
      {hasOnline && <a className={filterPrimaryButtonClass} href={newBatchHref}>Set up a new scanner batch</a>}
    </div>
    {hasOnline && <p className="mt-2 text-sm">Choose a destination and scanner source below, then start the batch.</p>}
    {expanded && <div className="space-y-3 mt-3 min-w-0">
      {installerAvailable && <div className="flex flex-wrap gap-2 items-center">
        <a className={filterButtonClass} href="/api/scanners/installer" download>
          {hasOnline ? "Update Windows scanner helper" : "Download Windows scanner helper"}
        </a>
        {installerVersion && <span className="text-sm">Version {installerVersion}</span>}
        <p className="text-sm w-full">Open the download to install or update. Finish the current scan before updating; saved scans and connections are kept.</p>
      </div>}
      {hasOnline && <button type="button" className={filterButtonClass}
        onClick={() => setAddAnother(!addAnother)}>{addAnother ? "Hide setup" : "Add another computer"}</button>}
      {showSetup && <>
      <p>Use the Windows computer connected to your scanner. Install its manufacturer driver first.</p>
      {agents.length > 0 && <div className="space-y-2">
        <button type="button" className={filterPrimaryButtonClass} onClick={openHelper}>Open scanner helper</button>
        <p className="text-sm">Already connected this computer before? Open its saved connection instead of pairing again. Check that the scanner is plugged in and powered on.</p>
      </div>}
      <ol className="list-decimal list-inside space-y-2">
        <li>{installerAvailable ? "Install the downloaded Windows scanner helper." : "The Windows scanner helper download is being prepared."}
          <span className="block">Install it once, then allow Windows to open it from this site.</span></li>
        <li><button type="button" className={filterButtonClass} disabled={busy} onClick={() => void connect()}>
          Connect this computer</button>
          <span className="block">Your browser may ask permission to open the MTG Archives scanner helper.</span></li>
        <li>When your scanner is online, <a className="underline" href="#scanner-source">choose its source in Card input below</a>.</li>
      </ol>
      {showWaiting && <p role="status">Waiting for the scanner helper to connect. This usually takes a few seconds.</p>}
      {showWaiting && <details><summary>Nothing opened?</summary>
        <p>Install the helper above, then click Connect this computer again. Keep this page open.</p>
      </details>}
      </>}
      {agents.length === 0 && <p>No scanner helpers connected yet.</p>}
      <ul className="space-y-3">{agents.map(agent => <li key={agent.id} className="min-w-0">
        <div className="flex flex-wrap gap-2 items-center"><strong>{agent.name}</strong>
          <span>{agent.online ? "Online" : "Offline"}</span>
          <button type="button" className={filterButtonClass} disabled={busy}
            onClick={() => void action({ action: "revoke", agentId: agent.id })}>Disconnect {agent.name}</button>
        </div>
        <ul>{agent.devices.map(device => <li key={device.id} className="break-words">{device.name} · {device.source}
          {device.qualification === "GenericUnqualified" && " · Not yet qualified"}</li>)}</ul>
        {!agent.online && <p className="text-sm">This computer’s helper is not responding. Open the helper on that computer and check its internet connection. Saved scans are kept.</p>}
        {agent.online && <ScannerDiscoveryNotice issues={agent.discoveryIssues} />}
        {agent.online && agent.devices.length === 0 && !agent.discoveryIssues?.length && <p>No scanner detected. Check USB/power and install its manufacturer driver, then wait up to 30 seconds for discovery.</p>}
      </li>)}</ul>
      {error && <p role="alert">{error}</p>}
    </div>}
  </section>;
}
