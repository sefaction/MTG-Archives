"use client";
import { useEffect, useState } from "react";
import {
  recognitionResponseSchema,
  type RecognitionResponse,
} from "@/lib/acquisition-recognition-dto";

export function AcquisitionPhotoRecognition({
  batchId,
  photoId,
}: {
  batchId: string;
  photoId: string;
}) {
  const [state, setState] = useState<RecognitionResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      let finished = false;
      try {
        const response = await fetch(
          `/api/acquisition/${batchId}/photos/${photoId}/recognition`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("Recognition unavailable");
        const next = recognitionResponseSchema.parse(await response.json());
        if (active) {
          setState(next);
          setError(false);
        }
        finished = ["COMPLETE", "FAILED", "SUPERSEDED"].includes(next.status);
      } catch {
        if (active) setError(true);
      }
      if (active && !finished) timer = setTimeout(poll, 4000);
    }
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [batchId, photoId]);
  if (error)
    return (
      <p className="text-xs" role="status">
        Recognition status unavailable; reconnecting.
      </p>
    );
  if (state?.status === "FAILED")
    return (
      <p className="text-xs">
        Card identification failed. Keep this photo for manual review or retake
        it.
      </p>
    );
  if (state?.status === "SUPERSEDED")
    return <p className="text-xs">Waiting for the latest photo.</p>;
  if (!state?.result)
    return (
      <p className="text-xs" role="status">
        {state?.status === "RUNNING"
          ? "Reading card text…"
          : "Waiting for card identification…"}
      </p>
    );
  const result = state.result;
  if (!result.proposals.length)
    return (
      <p className="text-xs">
        No printing found. A clearer photo or manual search is needed.
      </p>
    );
  return (
    <details className="text-xs" data-testid="recognition-suggestions">
      <summary className="cursor-pointer break-words">
        Possible: {result.proposals[0].card.name}
      </summary>
      <p className="mt-2">
        {result.status === "CONFLICT"
          ? "Conflicting card text—check the printing carefully."
          : "Check the set and collector number before accepting."}
      </p>
      <ol className="mt-2 space-y-2 list-decimal pl-4">
        {result.proposals.map(({ card }) => (
          <li key={card.id} className="break-words">
            {card.name} — {card.setCode.toUpperCase()} {card.collectorNumber} (
            {card.lang ?? "unknown language"})
          </li>
        ))}
      </ol>
      {result.truncated && (
        <p className="mt-2">
          Showing {result.proposals.length} of {result.totalProposals} possible
          printings.
        </p>
      )}
      <p className="mt-2">
        Suggestions only. Review and Inventory commit are the next step.
      </p>
    </details>
  );
}
