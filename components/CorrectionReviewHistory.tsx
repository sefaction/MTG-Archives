"use client";
import { useEffect, useState } from "react";
import { filterPanelClass as panel, filterButtonClass as button } from "./filterStyles";
import type { getCorrectionReviewHistory } from "@/lib/acquisition-correction-history";
import type { CorrectionHistoryEntry } from "@/lib/acquisition-correction-history-dto";

type History = Awaited<ReturnType<typeof getCorrectionReviewHistory>>;
type Decision = CorrectionHistoryEntry["after"];
function SavedDecision({ decision }: { decision: Decision }) {
  if (decision.state === "PENDING") return <span>No printing selected</span>;
  if (decision.state === "UNKNOWN") return <span>Selection not recorded</span>;
  return <span>{decision.printing ? `${decision.printing.name} · ${decision.printing.setCode} ${decision.printing.collectorNumber}` : "Printing details not recorded"}
    <span className="block text-sm">{[decision.finish, decision.condition, decision.language].filter(Boolean).join(" · ") || "Attributes not recorded"}</span>
  </span>;
}
export function CorrectionReviewHistory({ owner, exampleId }: { owner: string; exampleId: string }) {
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [data, setData] = useState<History>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(() => {
      if (active) { setData(undefined); setError(""); setLoading(true); }
    });
    const query = new URLSearchParams({ owner, ...(cursor ? { cursor } : {}) });
    fetch(`/api/acquisition/corrections/${exampleId}/history?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const value = await response.json();
        if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "The review history could not load.");
        if (active) { setData(value); setLoading(false); }
      }).catch(error => { if (active) { setError(error instanceof Error ? error.message : "The review history could not load."); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [owner, exampleId, cursor, reload]);
  return <section id={`correction-history-${exampleId}`} aria-label="Saved review history" className="mt-3 space-y-3 min-w-0">
    <h3 className="font-semibold">Saved review history</h3>
    <p className="text-sm">These recorded scan reviews still need independent verification. They do not reinstate a withdrawn label.</p>
    {loading && <p role="status">Loading saved reviews…</p>}
    {error && <div role="alert" className={panel}>{error}<button className={button + " ml-2"} onClick={() => setReload(value => value + 1)}>Retry history</button></div>}
    {data?.entries.length === 0 && <p>No recorded scan reviews are available for this example.</p>}
    <ol className="space-y-3">{data?.entries.map(entry => <li key={entry.id} className={panel}>
      <p className="font-semibold">{entry.kind}</p>
      <p className="text-sm">{new Date(entry.savedAt).toLocaleString()} · {entry.origin} · {entry.verification === "UNVERIFIED" ? "Unverified" : "Verification not recorded"}</p>
      <dl className="grid min-w-0 gap-2 mt-2 sm:grid-cols-3">
        <div className="min-w-0 break-words"><dt className="text-sm font-semibold">Suggestion at this review</dt><dd>{entry.suggestion.state === "RECORDED" && entry.suggestion.printing
          ? `${entry.suggestion.printing.name} · ${entry.suggestion.printing.setCode} ${entry.suggestion.printing.collectorNumber}`
          : entry.suggestion.state === "NONE" ? "No printing was suggested" : "Suggestion not recorded"}</dd></div>
        <div className="min-w-0 break-words"><dt className="text-sm font-semibold">Previously saved</dt><dd><SavedDecision decision={entry.before} /></dd></div>
        <div className="min-w-0 break-words"><dt className="text-sm font-semibold">Saved choice</dt><dd><SavedDecision decision={entry.after} /></dd></div>
      </dl>
      {entry.evidenceGaps.length > 0 && <div className="text-sm mt-2"><p className="font-semibold">Evidence gaps</p><ul className="list-disc pl-5">{entry.evidenceGaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
    </li>)}</ol>
    {data && <div className="flex flex-wrap gap-2"><button className={button} disabled={loading || previous.length === 0}
      onClick={() => { setCursor(previous.at(-1)); setPrevious(items => items.slice(0, -1)); }}>Newer reviews</button>
      <button className={button} disabled={loading || !data.nextCursor}
        onClick={() => { setPrevious(items => [...items, cursor]); setCursor(data.nextCursor ?? undefined); }}>Older reviews</button></div>}
  </section>;
}
