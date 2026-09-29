"use client";
import { useCallback, useEffect, useState } from "react";
import { filterButtonClass, filterPanelClass } from "./filterStyles";
import type { listScannerAgents } from "@/lib/scanner-store";
type Agent = Awaited<ReturnType<typeof listScannerAgents>>[number];
export function ScannerConnections() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/scanners", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error("Scanner connections unavailable. Refresh and retry.");
      setAgents(value.agents);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [expanded, refresh]);
  async function action(value: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/scanners", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      const result = await response.json();
      if (!response.ok) throw new Error("Scanner connection could not be saved. Refresh and retry.");
      if (result.code) setCode(result.code);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className={`${filterPanelClass} min-w-0`} aria-label="Scanner connections">
    <button type="button" className={filterButtonClass} aria-expanded={expanded}
      onClick={() => { setExpanded(!expanded); if (expanded) setCode(""); else void refresh(); }}>Connect a scanner</button>
    {expanded && <div className="space-y-3 mt-3 min-w-0">
      <p>Connect the scanner to a Windows computer with its manufacturer driver and the MTG Archives scanner helper.</p>
      <button type="button" className={filterButtonClass} disabled={busy} onClick={() => void action({ action: "pair" })}>
        Create connection code</button>
      {code && <div className="space-y-2">
        <p>Paste this code into the scanner helper. It expires in 10 minutes.</p>
        <code className="block break-all select-all text-sm">{code}</code>
        <button type="button" className={filterButtonClass} onClick={() => void navigator.clipboard.writeText(code)
          .catch(() => setError("Select and copy the code above."))}>Copy connection code</button>
      </div>}
      {agents.length === 0 && <p>No scanner helpers connected yet.</p>}
      <ul className="space-y-3">{agents.map(agent => <li key={agent.id} className="min-w-0">
        <div className="flex flex-wrap gap-2 items-center"><strong>{agent.name}</strong>
          <span>{agent.online ? "Online" : "Offline"}</span>
          <button type="button" className={filterButtonClass} disabled={busy}
            onClick={() => void action({ action: "revoke", agentId: agent.id })}>Disconnect {agent.name}</button>
        </div>
        <ul>{agent.devices.map(device => <li key={device.id} className="break-words">{device.name} · {device.source}
          {device.qualification === "GenericUnqualified" && " · Not yet qualified"}</li>)}</ul>
        {agent.online && agent.devices.length === 0 && <p>No scanner detected. Check its connection and driver.</p>}
      </li>)}</ul>
      {error && <p role="alert">{error}</p>}
    </div>}
  </section>;
}
