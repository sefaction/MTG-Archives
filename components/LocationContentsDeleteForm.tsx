"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LoadingSpinner } from "@/components/feedback/LoadingSpinner";
import {
  cn,
  filterDangerButtonClass,
  filterInputClass,
} from "@/components/filterStyles";

export type LocationContentsDeleteResult = {
  success: boolean;
  message: string;
  deletedEntries?: number;
  deletedCards?: number;
  locationName?: string;
};

type LocationContentsDeleteFormProps = {
  locationId: string;
  locationName: string;
  entryCount: number;
  cardCount: number;
  deleteAction: (formData: FormData) => Promise<LocationContentsDeleteResult>;
};

export function LocationContentsDeleteForm({
  locationId,
  locationName,
  entryCount,
  cardCount,
  deleteAction,
}: LocationContentsDeleteFormProps) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<LocationContentsDeleteResult | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const isEmpty = cardCount <= 0 || entryCount <= 0;

  function submitDelete() {
    setResult(null);
    const formData = new FormData();
    formData.set("locationId", locationId);
    formData.set("confirmDeleteContents", confirmText);
    startTransition(() => {
      void (async () => {
        const actionResult = await deleteAction(formData);
        setResult(actionResult);
        if (actionResult.success) {
          setConfirmText("");
          router.refresh();
        }
      })();
    });
  }

  if (isEmpty) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-950/50 p-2 text-xs text-zinc-400">
        This location is empty. Delete contents is disabled.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded border border-red-900/60 bg-red-950/10 p-2">
      <p className="text-xs text-red-200">
        Delete all {cardCount} cards across {entryCount} inventory entries in{" "}
        {locationName}. This keeps the location and card metadata.
      </p>
      <input
        value={confirmText}
        onChange={(event) => setConfirmText(event.target.value)}
        placeholder={`Type DELETE or ${locationName}`}
        className={cn(filterInputClass, "w-full border-red-800")}
        disabled={isPending}
      />
      <button
        type="button"
        onClick={submitDelete}
        disabled={isPending}
        className={cn(filterDangerButtonClass, "inline-flex items-center gap-2")}
      >
        {isPending ? <LoadingSpinner className="h-3 w-3" /> : null}
        {isPending ? "Deleting contents…" : "Delete contents"}
      </button>
      {result ? (
        <p
          role={result.success ? "status" : "alert"}
          className={`text-xs ${result.success ? "text-emerald-300" : "text-amber-300"}`}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
