"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PullWorkspace } from "./PullWorkspace";
import { BulkBoxCreate } from "./BulkBoxCreate";
import { pullCardRow } from "@/lib/pull-card-row";
import {
  bulkScopeInput,
  type BulkScope,
  type PullBrowse,
} from "@/lib/pull-scope";
import type {
  BulkActionInput,
  BulkContext,
  BulkItem,
  BulkResult,
} from "@/lib/bulk-cleanup-policy";
import {
  readPendingBulk,
  verifiedBulkResult,
} from "@/lib/bulk-cleanup-pending";

const button =
  "rounded border border-[var(--app-border)] px-3 py-2 text-sm disabled:opacity-50";
const inputClass =
  "rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-2";
async function api(url: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store", signal },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Could not load bulk cleanup.");
  return data;
}
export function BulkCleanup({
  actorId,
  enabled,
  batchId,
  revision,
  refresh,
  blockedPhotos,
  draftsReady = true,
  canUsePhotos,
  onInspect,
}: {
  actorId: string;
  enabled: boolean;
  batchId?: string;
  revision?: number;
  refresh?: () => void | Promise<void>;
  blockedPhotos?: Set<string>;
  draftsReady?: boolean;
  canUsePhotos?: (ids: string[]) => boolean;
  onInspect?: (position: number) => void;
}) {
  const [browse, setBrowse] = useState<PullBrowse>({
    search: "",
    sort: "location",
    desc: false,
    locationId: "",
    pageSize: 25,
  });
  const [scope, setScope] = useState<BulkScope>({});
  const [destinationId, setDestinationId] = useState(""),
    [destinationSection, setDestinationSection] = useState("");
  const [context, setContext] = useState<BulkContext | null>(null),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Record<string, number>>({}),
    [open, setOpen] = useState(!batchId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<BulkResult | null>(null),
    [pending, setPending] = useState<BulkActionInput | null>(null),
    [ready, setReady] = useState(false),
    [action, setAction] = useState<"REMOVE" | "MOVE" | "GIVE">("MOVE"),
    [boxName, setBox] = useState("Bulk / Outgoing"),
    [recipientType, setRecipientType] = useState("EXTERNAL"),
    [person, setPerson] = useState(""),
    [kind, setKind] = useState<"GIFT" | "TRADE">("GIFT"),
    [pulled, setPulled] = useState(false),
    [confirming, setConfirming] = useState(false),
    [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const key = `mtg:bulk-cleanup:${actorId}`,
    dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) return;
      try {
        const value: BulkContext = batchId
          ? await api(
              `/api/bulk-cleanup?page=${page}&batchId=${encodeURIComponent(batchId)}`,
              undefined,
              signal,
            )
          : await api(
              "/api/bulk-cleanup",
              { action: "PLAN", page, scope, browse },
              signal,
            );
        if (signal?.aborted) return;
        setContext(value);
        setSelected({});
        setError("");
      } catch (cause) {
        if (!signal?.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not load cleanup.",
          );
      }
    },
    [enabled, page, batchId, scope, browse],
  );
  useEffect(() => {
    const controller = new AbortController();
    if (ready && !confirming && !pending)
      void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load, revision, confirming, pending, ready]);
  useEffect(() => {
    // Keep the exact request across reloads. Disabling cleanup never hides a
    // prior confirmation whose result still needs recovery.
    const timer = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) setPending(readPendingBulk(raw));
        if (!batchId) {
          const stored = sessionStorage.getItem(key + ":workspace");
          if (stored) setScope(bulkScopeInput.parse(JSON.parse(stored)));
        }
      } catch {
        setRecoveryBlocked(true);
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);
  useEffect(() => {
    if (confirming && !dialog.current?.open) dialog.current?.showModal();
    if (!confirming && dialog.current?.open) dialog.current.close();
  }, [confirming]);
  useEffect(() => {
    if (ready && !batchId)
      try {
        sessionStorage.setItem(key + ":workspace", JSON.stringify(scope));
      } catch {}
  }, [scope, ready, batchId, key]);
  useEffect(() => {
    if (
      context?.destinations?.length &&
      !context.destinations.some((row) => row.id === destinationId)
    ) {
      setDestinationId(context.destinations[0].id);
      setDestinationSection("");
    }
  }, [context, destinationId]);
  const rows = context?.plan?.items ?? [],
    chosen = rows.filter((row) => selected[row.id] > 0),
    count = chosen.reduce((sum, row) => sum + selected[row.id], 0);
  const isBlocked = (row: BulkItem) =>
    !!batchId && (!draftsReady || blockedPhotos?.has(row.id));
  async function send(request: BulkActionInput) {
    setBusy(true);
    setError("");
    try {
      // Store before sending. A network failure cannot create a second request.
      sessionStorage.setItem(key, JSON.stringify(request));
      setPending(request);
      const value = verifiedBulkResult(
        await api("/api/bulk-cleanup", request),
        request,
      );
      if (!value)
        throw new Error(
          "The response did not match this confirmation. Check the same confirmation before continuing.",
        );
      sessionStorage.removeItem(key);
      setPending(null);
      setResult(value);
      setConfirming(false);
      setPulled(false);
      if (!batchId)
        setScope((current) => ({
          ...current,
          held: (current.held ?? []).filter(
            (pin) => !request.selected.some((row) => row.id === pin.id),
          ),
        }));
      await load();
      await refresh?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Result unknown. Check the same confirmation.",
      );
    } finally {
      setBusy(false);
    }
  }
  function confirm() {
    if (
      !context ||
      !chosen.length ||
      pending ||
      !pulled ||
      busy ||
      recoveryBlocked
    )
      return;
    if (
      batchId &&
      (chosen.some(isBlocked) ||
        (canUsePhotos && !canUsePhotos(chosen.map((row) => row.id))))
    ) {
      setError("Save or discard your card edits before ignoring these scans.");
      return;
    }
    const base = {
      requestId: crypto.randomUUID(),
      policyStamp: context.settings.stamp,
      ...(!batchId ? { scope } : {}),
      selected: chosen.map((row) => ({
        id: row.id,
        group: row.group,
        groupStamp: row.groupStamp,
        stamp: row.stamp,
        quantity: selected[row.id],
      })),
    };
    const request: BulkActionInput = batchId
      ? { ...base, action: "IGNORE_SCANS", batchId }
      : action === "MOVE"
        ? {
            ...base,
            action,
            ...(destinationId
              ? { destinationId, destinationSection }
              : { boxName }),
          }
        : action === "GIVE"
          ? {
              ...base,
              action,
              kind,
              recipient:
                recipientType === "ARCHIVE"
                  ? { type: "ARCHIVE", playerId: person }
                  : { type: "EXTERNAL", name: person },
            }
          : { ...base, action: "REMOVE" };
    void send(request);
  }
  if (!ready) return null;
  if (!enabled && !pending && !recoveryBlocked) return null;
  if (batchId && context && !context.enabled && !pending) return null;
  const plan = context?.plan;
  const destination = context?.destinations?.find(
    (row) => row.id === destinationId,
  );
  const section = destination?.sections.find(
    (row) => row.name === destinationSection,
  );
  const remaining = destination
    ? Math.max(
        0,
        Math.min(
          destination.capacity === null
            ? Infinity
            : destination.capacity - destination.used,
          section?.capacity == null
            ? Infinity
            : section.capacity - section.used,
        ),
      )
    : Infinity;
  const noSpace =
    !batchId && action === "MOVE" && (!destinationId || count > remaining);
  return (
    <section
      className="app-panel my-3 space-y-3 p-3"
      aria-label={batchId ? "Excess scans" : "Bulk cleanup"}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">
          {batchId ? "Excess scans" : "Bulk cleanup"}
        </h2>
        {plan && (
          <span className="text-sm">
            {plan.totalCopies}{" "}
            {batchId
              ? "confirmed scans to pull"
              : "excess copies available to pull"}
          </span>
        )}
        {batchId && plan && plan.totalCopies > 0 && (
          <button className={button} onClick={() => setOpen(!open)}>
            {open ? "Hide pull list" : "Review pull list"}
          </button>
        )}
        {!batchId && (
          <Link href="/settings#bulk-cleanup" className="text-sm underline">
            Cleanup settings
          </Link>
        )}
        <button
          className={button}
          disabled={busy || !!pending || recoveryBlocked}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>
      {pending && (
        <div
          className="space-y-2 rounded border border-amber-500 p-3"
          role="status"
        >
          <p>
            A previous cleanup confirmation needs its result checked. It may
            already have finished.
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={() => void send(pending)}
          >
            {busy ? "Checking…" : "Check same confirmation"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-600">
          {error}
        </p>
      )}
      {recoveryBlocked && (
        <p role="alert" className="text-sm">
          A saved confirmation could not be read. Reload this tab before
          starting another cleanup.
        </p>
      )}
      {!batchId && !!scope.held?.length && (
        <button
          type="button"
          className={button}
          disabled={busy || !!pending}
          onClick={() => setScope((current) => ({ ...current, held: [] }))}
        >
          Clear pulled marks and re-evaluate
        </button>
      )}
      {result && (
        <p role="status" className="text-sm">
          {result.message}
          {result.replay ? " (Recovered confirmation)" : ""}
        </p>
      )}
      {!context && enabled && !error && (
        <p className="text-sm">Checking your collection…</p>
      )}
      {!batchId && (
        <div className="flex flex-wrap items-center gap-3">
          <BulkBoxCreate
            onCreated={async (id) => {
              await load();
              setDestinationId(id);
              setDestinationSection("");
            }}
          />
          <Link href="/locations" className="text-sm underline">
            Manage / tag Bulk Boxes
          </Link>
        </div>
      )}
      {!batchId && action === "MOVE" && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-[var(--app-border)] p-3">
          <label className="text-sm font-medium">
            Move selected copies to{" "}
            <select
              aria-label="Bulk destination"
              value={destinationId}
              className={inputClass}
              disabled={busy || !!pending}
              onChange={(event) => {
                setDestinationId(event.target.value);
                setDestinationSection("");
              }}
            >
              <option value="">Choose a Bulk Box</option>
              {context?.destinations?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ? {row.used.toLocaleString()} /{" "}
                  {row.capacity?.toLocaleString() ?? "unlimited"}
                </option>
              ))}
            </select>
          </label>
          {!!destination?.sections.length && (
            <label className="text-sm">
              Section{" "}
              <select
                aria-label="Bulk destination section"
                value={destinationSection}
                className={inputClass}
                disabled={busy || !!pending}
                onChange={(event) => setDestinationSection(event.target.value)}
              >
                <option value="">No section</option>
                {destination.sections.map((row) => (
                  <option key={row.name} value={row.name}>
                    {row.name} ? {row.used} / {row.capacity ?? "unlimited"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {destination && (
            <span className="text-sm">
              {remaining === Infinity
                ? "Capacity not limited"
                : `${remaining.toLocaleString()} spaces available`}
              {count ? ` ? ${count} selected` : ""}
            </span>
          )}
          {noSpace && count > 0 && (
            <p role="alert" className="w-full text-sm">
              {!destinationId
                ? "Choose or create a Bulk Box."
                : "This destination does not have enough space for the selected copies."}
            </p>
          )}
        </div>
      )}
      {plan && open && (
        <>
          <p className="text-sm text-[var(--app-muted)]">
            Keep up to {context.settings.maxCopies} of each printing, finish and
            language.{" "}
            {context.settings.includeDecks
              ? "Deck copies count toward this limit."
              : "Deck copies do not count toward this limit."}{" "}
            Deck and reserved cards stay protected.
            {batchId &&
              " Only confirmed, physically counted scans appear here. Pull these cards from this batch before ignoring them."}
          </p>
          {plan.protectedCopies > 0 && (
            <p className="text-sm">
              {plan.protectedCopies} additional excess copies are protected and
              cannot be pulled here.
            </p>
          )}
          {!rows.length ? (
            <p className="text-sm">
              {batchId
                ? "No excess confirmed scans in this batch."
                : "No eligible excess copies to pull."}
            </p>
          ) : (
            <>
              {!batchId ? (
                <PullWorkspace
                  bulk
                  server={{
                    page: plan.page,
                    pages: plan.pages,
                    total: plan.totalItems,
                    pageSize: browse.pageSize,
                    onPage: setPage,
                    onBrowse: (value) => {
                      setBrowse((previous) =>
                        JSON.stringify(previous) === JSON.stringify(value)
                          ? previous
                          : value,
                      );
                      setPage(1);
                    },
                  }}
                  rows={rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    quantity: row.quantity,
                    printing: `${row.setCode.toUpperCase()} #${row.collectorNumber}`,
                    finish: row.finish,
                    language: row.language,
                    condition: row.condition,
                    locationId: row.locationId ?? "unassigned",
                    location: row.location,
                    section: row.section,
                    pulled: row.pulledQuantity ?? 0,
                    owned: row.owned,
                    keep: context.settings.maxCopies,
                    destination: destination?.name ?? "Bulk cleanup",
                    card: pullCardRow({
                      id: row.id,
                      cardId: row.cardId,
                      name: row.name,
                      quantity: row.quantity,
                      setCode: row.setCode,
                      collectorNumber: row.collectorNumber,
                      finish: row.finish,
                      imageUri: row.imageUri,
                      location: row.location,
                      destination: destination?.name,
                    }),
                  }))}
                  selection={selected}
                  onSelection={setSelected}
                  scope={scope}
                  locations={context.locations}
                  disabled={busy || !!pending || recoveryBlocked}
                  onScope={(next) => {
                    setPage(1);
                    setScope((current) => ({ ...current, ...next }));
                  }}
                  onSkip={(row) =>
                    setScope((current) => ({
                      ...current,
                      excludedItems: [
                        ...new Set([...(current.excludedItems ?? []), row.id]),
                      ],
                    }))
                  }
                  onPrinting={(row) =>
                    setScope((current) => ({
                      ...current,
                      excludedItems: [
                        ...new Set([...(current.excludedItems ?? []), row.id]),
                      ],
                    }))
                  }
                  onPulled={(row, quantity) => {
                    const item = rows.find((item) => item.id === row.id)!;
                    setScope((current) => ({
                      ...current,
                      held: [
                        ...(current.held ?? []).filter(
                          (pin) => pin.id !== row.id,
                        ),
                        ...(quantity
                          ? [{ id: row.id, quantity, stamp: item.stamp }]
                          : []),
                      ],
                    }));
                  }}
                >
                  <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
                    <strong>{count} copies selected</strong>
                    <select
                      aria-label="Cleanup action"
                      className={inputClass}
                      value={action}
                      disabled={busy || !!pending || recoveryBlocked}
                      onChange={(event) =>
                        setAction(event.target.value as typeof action)
                      }
                    >
                      <option value="MOVE">Move to Bulk Box</option>
                      <option value="GIVE">Give / trade</option>
                      <option value="REMOVE">Remove from collection</option>
                    </select>
                    <button
                      className={button}
                      disabled={
                        !count ||
                        noSpace ||
                        busy ||
                        !!pending ||
                        recoveryBlocked
                      }
                      onClick={() => {
                        setPulled(false);
                        setConfirming(true);
                      }}
                    >
                      Review selected pulls
                    </button>
                  </div>
                </PullWorkspace>
              ) : (
                <>
                  {" "}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className={button}
                      disabled={busy || !!pending || recoveryBlocked}
                      onClick={() =>
                        setSelected(
                          Object.fromEntries(
                            rows
                              .filter((row) => !isBlocked(row))
                              .map((row) => [row.id, row.quantity]),
                          ),
                        )
                      }
                    >
                      Select this page
                    </button>
                    <button
                      className={button}
                      disabled={busy || !!pending || recoveryBlocked}
                      onClick={() => setSelected({})}
                    >
                      Clear
                    </button>
                    <span className="text-sm">{count} selected</span>
                    {batchId ? (
                      <button
                        className={button}
                        disabled={
                          !count ||
                          noSpace ||
                          busy ||
                          !!pending ||
                          recoveryBlocked
                        }
                        onClick={() => {
                          setPulled(false);
                          setConfirming(true);
                        }}
                      >
                        Ignore selected as excess
                      </button>
                    ) : (
                      <>
                        <select
                          aria-label="Cleanup action"
                          className={inputClass}
                          value={action}
                          disabled={busy || !!pending || recoveryBlocked}
                          onChange={(event) =>
                            setAction(event.target.value as typeof action)
                          }
                        >
                          <option value="MOVE">
                            Move to bulk / outgoing box
                          </option>
                          <option value="GIVE">Give or trade</option>
                          <option value="REMOVE">Remove from collection</option>
                        </select>
                        <button
                          className={button}
                          disabled={
                            !count ||
                            noSpace ||
                            busy ||
                            !!pending ||
                            recoveryBlocked
                          }
                          onClick={() => {
                            setPulled(false);
                            setConfirming(true);
                          }}
                        >
                          Review selected pulls
                        </button>
                      </>
                    )}
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {rows.map((row) => (
                      <article
                        key={row.id}
                        className="flex min-w-0 gap-3 rounded border border-[var(--app-border)] p-2"
                      >
                        <input
                          aria-label={`Select ${row.position ? `scan ${row.position}: ` : ""}${row.name} ${row.setCode} ${row.collectorNumber}`}
                          type="checkbox"
                          disabled={
                            busy ||
                            !!pending ||
                            recoveryBlocked ||
                            isBlocked(row)
                          }
                          checked={!!selected[row.id]}
                          onChange={(event) =>
                            setSelected((old) => ({
                              ...old,
                              [row.id]: event.target.checked ? row.quantity : 0,
                            }))
                          }
                        />
                        {row.imageUri && (
                          <img
                            src={row.imageUri}
                            alt={
                              row.position ? `Scan ${row.position}` : row.name
                            }
                            loading="lazy"
                            className="h-28 w-20 shrink-0 rounded object-contain"
                            onError={(event) => {
                              const image = event.currentTarget;
                              if (batchId && image.src.endsWith("?preview=1"))
                                image.src = image.src.slice(
                                  0,
                                  -"?preview=1".length,
                                );
                            }}
                          />
                        )}
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="font-medium">
                            {row.position && (
                              <span className="mr-2">#{row.position}</span>
                            )}
                            {row.name}
                          </div>
                          <p className="break-words">
                            {row.setCode.toUpperCase()} · #{row.collectorNumber}{" "}
                            · {row.finish} · {row.language} · {row.condition}
                          </p>
                          <p className="mt-1 font-medium">
                            {row.location}
                            {row.section ? ` / ${row.section}` : ""}
                          </p>
                          <p className="text-[var(--app-muted)]">
                            {row.owned} in inventory · {row.deckCopies} in decks
                            {batchId
                              ? ` · ${row.pendingKept} pending scans to keep`
                              : ""}
                          </p>
                          {batchId ? (
                            <>
                              <span>Pull 1 card</span>
                              {onInspect && (
                                <button
                                  className="ml-3 underline"
                                  onClick={() => onInspect(row.position!)}
                                >
                                  View scan
                                </button>
                              )}
                              {isBlocked(row) && (
                                <p>Save or discard this card’s edits first.</p>
                              )}
                            </>
                          ) : (
                            <label className="mt-1 flex items-center gap-2">
                              Pull up to {row.quantity}
                              <input
                                aria-label={`Pull quantity for ${row.name}`}
                                className={`${inputClass} w-20`}
                                type="number"
                                min={0}
                                max={row.quantity}
                                disabled={busy || !!pending || recoveryBlocked}
                                value={selected[row.id] ?? 0}
                                onChange={(event) =>
                                  setSelected((old) => ({
                                    ...old,
                                    [row.id]: Math.max(
                                      0,
                                      Math.min(
                                        row.quantity,
                                        Math.floor(Number(event.target.value)),
                                      ),
                                    ),
                                  }))
                                }
                              />
                            </label>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {batchId && plan.pages > 1 && (
            <div className="flex items-center gap-3">
              <button
                className={button}
                disabled={page <= 1 || busy || !!pending || recoveryBlocked}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {plan.page} of {plan.pages} · {plan.totalItems} entries
              </span>
              <button
                className={button}
                disabled={
                  page >= plan.pages || busy || !!pending || recoveryBlocked
                }
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
              <span className="text-sm">Changing pages clears selection.</span>
            </div>
          )}
        </>
      )}
      {!batchId && !!context?.history?.length && (
        <details>
          <summary className="cursor-pointer text-sm">
            Recent cleanup history
          </summary>
          <ul className="mt-2 space-y-2 text-sm">
            {context.history.map((row) => (
              <li key={row.id}>
                <time>{new Date(row.createdAt).toLocaleString()}</time> —{" "}
                {row.result.message}
                <details>
                  <summary>Cards</summary>
                  {row.result.items.map((item, index) => (
                    <p key={index}>
                      {item.quantity} × {item.name} · {item.setCode} #
                      {item.collectorNumber} · {item.finish} · {item.language}
                    </p>
                  ))}
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
      <dialog
        ref={dialog}
        className="m-auto max-h-[85vh] w-[min(42rem,94vw)] overflow-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-5 text-[var(--app-text)] backdrop:bg-black/60"
        onCancel={(event) => {
          if (busy || pending) event.preventDefault();
          else setConfirming(false);
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <h3 className="text-lg font-semibold">
            {batchId ? "Pull excess scans" : "Confirm your physical pulls"}
          </h3>
          <p>
            {count} selected {count === 1 ? "copy" : "copies"}
            {batchId
              ? " will be ignored in this batch. Images and confirmed matches remain; Restore is available."
              : action === "REMOVE"
                ? " will leave your collection. This removal is recorded in cleanup history."
                : action === "MOVE"
                  ? " will move into a bulk box and stop counting toward your cleanup limit while stored there."
                  : " will leave your inventory with a saved handoff history."}
          </p>
          {!batchId && action === "MOVE" && (
            <p className="font-medium">
              Destination: {destination?.name ?? boxName}
              {destinationSection ? ` / ${destinationSection}` : ""}
            </p>
          )}
          {!batchId && action === "GIVE" && (
            <div className="space-y-2">
              <select
                aria-label="Gift or trade"
                className={inputClass}
                disabled={busy || !!pending || recoveryBlocked}
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
              >
                <option value="GIFT">Give</option>
                <option value="TRADE">Trade</option>
              </select>
              <select
                aria-label="Recipient type"
                className={inputClass}
                disabled={busy || !!pending || recoveryBlocked}
                value={recipientType}
                onChange={(event) => {
                  setRecipientType(event.target.value);
                  setPerson("");
                }}
              >
                <option value="EXTERNAL">Someone outside Archives</option>
                <option value="ARCHIVE">Archives user</option>
              </select>
              {recipientType === "EXTERNAL" ? (
                <label className="block">
                  Recipient name
                  <input
                    className={`${inputClass} w-full`}
                    required
                    maxLength={120}
                    disabled={busy || !!pending || recoveryBlocked}
                    value={person}
                    onChange={(event) => setPerson(event.target.value)}
                  />
                </label>
              ) : (
                <label className="block">
                  Archives recipient
                  <select
                    required
                    disabled={busy || !!pending || recoveryBlocked}
                    className={`${inputClass} w-full`}
                    value={person}
                    onChange={(event) => setPerson(event.target.value)}
                  >
                    <option value="">Choose a recipient</option>
                    {context?.recipients?.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {recipientType === "ARCHIVE" && (
                <p className="text-sm">
                  Copies transfer immediately into their Unassigned location.
                </p>
              )}
            </div>
          )}
          <ul className="max-h-52 space-y-1 overflow-auto text-sm">
            {chosen.map((row) => (
              <li key={row.id}>
                {row.position && `#${row.position} · `}
                {selected[row.id]} × {row.name} · {row.setCode.toUpperCase()} #
                {row.collectorNumber} · {row.finish} · {row.language}
                {!batchId &&
                  ` · ${row.location}${row.section ? ` / ${row.section}` : ""}`}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              required
              checked={pulled}
              disabled={busy || !!pending || recoveryBlocked}
              onChange={(event) => setPulled(event.target.checked)}
            />
            I have physically pulled these selected cards.
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={button}
              disabled={busy || !!pending || recoveryBlocked}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              className={button}
              disabled={
                !pulled || noSpace || busy || !!pending || recoveryBlocked
              }
            >
              {busy
                ? "Applying…"
                : batchId
                  ? "Pulled and ignore selected"
                  : action === "MOVE"
                    ? "Confirm move"
                    : action === "GIVE"
                      ? "Confirm handoff"
                      : "Confirm removal"}
            </button>
          </div>
          {pending && (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => void send(pending)}
            >
              Check same confirmation
            </button>
          )}
        </form>
      </dialog>
    </section>
  );
}
