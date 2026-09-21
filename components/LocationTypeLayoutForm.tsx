"use client";
import { useActionState, useState } from "react";
import type { StorageLayout } from "@/lib/storage-layout";
import { StorageLayoutFields } from "./StorageLayoutFields";
import { cn, filterInputClass, filterPrimaryButtonClass } from "./filterStyles";

export function LocationTypeLayoutForm({
  id,
  initialLayout,
  action,
}: {
  id?: string;
  initialLayout: StorageLayout;
  action: (
    state: { error: string; saved?: boolean },
    fd: FormData,
  ) => Promise<{ error: string; saved?: boolean }>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [layout, setLayout] = useState(initialLayout);
  return (
    <form action={formAction} className="space-y-3">
      {id ? (
        <input type="hidden" name="locationTypeId" value={id} />
      ) : (
        <label className="block text-sm">
          Type name
          <input
            name="name"
            required
            maxLength={100}
            className={cn(filterInputClass, "mt-1 w-full")}
          />
        </label>
      )}
      <StorageLayoutFields value={layout} onChange={setLayout} />
      <p className="text-sm text-[var(--app-muted)]">
        Defaults are copied to new locations. Existing locations keep their own
        settings.
      </p>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-sm">
          Type defaults saved.
        </p>
      )}
      <button disabled={pending} className={filterPrimaryButtonClass}>
        {pending ? "Saving…" : id ? "Save type defaults" : "Create type"}
      </button>
    </form>
  );
}
