"use client";
import Link from "next/link";
import { PullWorkspace, type PullRow } from "./PullWorkspace";
import { HuntPrintingPicker } from "./HuntPrintingPicker";
import { pullCardRow } from "@/lib/pull-card-row";
import type { HuntAdjustments } from "@/lib/pull-scope";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { HuntFinish, HuntMode, HuntPick, HuntPlan } from "@/lib/card-hunt";
import type { buildCardHunt, CardHuntInput } from "@/lib/card-hunt-service";
import type {
  HuntActionInput,
  HuntActionResult,
} from "@/lib/card-hunt-action-policy";
import {
  advanceHunt,
  huntPickKey,
  markedHuntSelection,
} from "@/lib/card-hunt-progress";
import { parsePendingHuntAction } from "@/lib/card-hunt-pending";
import {
  CardHuntActionDialog,
  huntPendingKey,
  type FrozenHuntAction,
  type HuntActionContext,
} from "./CardHuntActionDialog";
import {
  filterButtonClass,
  filterInputClass,
  filterSelectClass,
  filterPrimaryButtonClass,
} from "./filterStyles";
type Result = Awaited<ReturnType<typeof buildCardHunt>>;
const finishLabel = (value: string) =>
  ({ FOIL: "Foil", NONFOIL: "Nonfoil", ETCHED: "Etched" })[value] ?? value;
export type CardHuntContext = {
  id: string;
  scope: "card" | "printing";
  setCode: string;
  collectorNumber?: string;
  finish?: Exclude<HuntFinish, "ANY">;
};

export function CardHunt({
  decks = [],
  initialDeckId,
  card,
}: {
  decks?: Array<{ id: string; name: string }>;
  initialDeckId?: string;
  card?: CardHuntContext;
}) {
  const planKey = card
    ? JSON.stringify([card.id, card.scope, card.finish ?? ""])
    : initialDeckId
      ? `deck:${initialDeckId}`
      : "decks";
  const [adjustments, setAdjustments] = useState<HuntAdjustments>({});
  const [printing, setPrinting] = useState<{
    requestId: string;
    name: string;
  } | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const changedPlan = useRef(false);
  const [selectedDecks, setSelectedDecks] = useState<string[]>(
      initialDeckId ? [initialDeckId] : [],
    ),
    [deckSearch, setDeckSearch] = useState("");
  const [lists, setLists] = useState<
    Array<{ id: string; label: string; text: string }>
  >([]);
  const [finish, setFinish] = useState<HuntFinish>("ANY"),
    [mode, setMode] = useState<HuntMode>("preferences");
  const [includeMaybeboard, setIncludeMaybeboard] = useState(false),
    [ignoreBasicLands, setIgnoreBasicLands] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null),
    [lastInput, setLastInput] = useState<CardHuntInput | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({}),
    [given, setGiven] = useState(0),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const [context, setContext] = useState<HuntActionContext | null>(null),
    [contextError, setContextError] = useState("");
  const [frozen, setFrozen] = useState<FrozenHuntAction | null>(null),
    [action, setAction] = useState<"COMMIT" | "GIVE" | null>(null);
  const [corruptPending, setCorruptPending] = useState(false),
    [otherPending, setOtherPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/card-hunt/context", { signal: controller.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok)
          throw Error(
            value.error ?? "Actions are unavailable. Reload after signing in.",
          );
        if (controller.signal.aborted) return;
        setContext(value);
        try {
          const saved = JSON.parse(
            sessionStorage.getItem(
              "mtg-hunt-workspace:" + value.actorUserId + ":" + planKey,
            ) || "null",
          );
          if (
            saved?.input &&
            saved.result?.actorUserId === value.actorUserId &&
            Array.isArray(saved.result.boxes) &&
            saved.result.boxes.every((box: { picks: unknown }) =>
              Array.isArray(box.picks),
            ) &&
            Array.isArray(saved.result.lines) &&
            !changedPlan.current
          ) {
            setResult(saved.result);
            setLastInput(saved.input);
            if (saved.selection && typeof saved.selection === "object")
              setSelection({
                ...saved.selection,
                ...markedHuntSelection(saved.result),
              });
            setAdjustments(saved.input.adjustments ?? {});
            setSetupOpen(false);
            setSelectedDecks(
              saved.input.sources
                ?.filter((source: { kind: string }) => source.kind === "DECK")
                .map((source: { deckId: string }) => source.deckId) ?? [],
            );
            setLists(
              saved.input.sources?.filter(
                (source: { kind: string }) => source.kind === "LIST",
              ) ?? [],
            );
            setMode(saved.input.mode);
            setFinish(saved.input.finish);
            setIncludeMaybeboard(saved.input.includeMaybeboard ?? false);
            setIgnoreBasicLands(saved.input.ignoreBasicLands ?? false);
          }
        } catch {}
        let saved: string | null = null;
        try {
          saved = sessionStorage.getItem(huntPendingKey(value.actorUserId));
        } catch {}
        if (saved)
          try {
            setFrozen(parsePendingHuntAction(saved));
          } catch {
            setCorruptPending(true);
          }
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setContextError(
            caught instanceof Error
              ? caught.message
              : "Actions are unavailable.",
          );
      });
    return () => controller.abort();
  }, [planKey]);
  useEffect(() => {
    if (!context) return;
    const check = () => {
      try {
        setOtherPending(
          Boolean(
            sessionStorage.getItem("mtg-card-handoff:" + context.actorUserId),
          ),
        );
      } catch {}
    };
    check();
    window.addEventListener("mtg-card-handoff-pending", check);
    return () => window.removeEventListener("mtg-card-handoff-pending", check);
  }, [context]);
  useEffect(() => {
    if (context && result && lastInput)
      try {
        sessionStorage.setItem(
          "mtg-hunt-workspace:" + context.actorUserId + ":" + planKey,
          JSON.stringify({ input: lastInput, result, selection }),
        );
      } catch {
        const timer = window.setTimeout(
          () =>
            setMessage(
              "This browser could not save hunt progress. Keep this tab open until you finish.",
            ),
          0,
        );
        return () => window.clearTimeout(timer);
      }
  }, [context, result, lastInput, planKey, selection]);
  const blocked = Boolean(frozen) || corruptPending || otherPending;
  function clearPlan() {
    if (context)
      try {
        sessionStorage.removeItem(
          "mtg-hunt-workspace:" + context.actorUserId + ":" + planKey,
        );
      } catch {}
    setResult(null);
    setAdjustments({});
    setPrinting(null);
    setSelection({});
    setError("");
    setMessage("");
    setGiven(0);
    setNeedsRefresh(false);
  }
  async function generate(event?: FormEvent) {
    event?.preventDefault();
    if (blocked || busy) return;
    const input: CardHuntInput = {
      mode,
      finish,
      includeMaybeboard,
      ignoreBasicLands,
      ...(card
        ? { card: { id: card.id, scope: card.scope, finish: card.finish } }
        : {
            sources: [
              ...decks
                .filter((deck) => selectedDecks.includes(deck.id))
                .map((deck) => ({
                  kind: "DECK" as const,
                  id: `deck:${deck.id}`,
                  deckId: deck.id,
                })),
              ...lists.map((list) => ({ ...list, kind: "LIST" as const })),
            ],
          }),
    };
    changedPlan.current = true;
    setBusy(true);
    clearPlan();
    setLastInput(input);
    try {
      const response = await fetch("/api/card-hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const value = await response.json();
      if (!response.ok)
        throw Error(value.error ?? "The hunt could not be prepared.");
      setResult(value);
      setSetupOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The hunt could not be prepared.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function replan(next: HuntAdjustments) {
    if (!lastInput || blocked || busy) return;
    setBusy(true);
    setError("");
    changedPlan.current = true;
    const input = {
      ...lastInput,
      adjustments: next,
      printingRequestId: undefined,
    };
    try {
      const response = await fetch("/api/card-hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const value = await response.json();
      if (!response.ok)
        throw Error(value.error || "Could not re-evaluate the hunt.");
      setResult(value);
      setLastInput(input);
      setAdjustments(next);
      setSelection(markedHuntSelection(value));
      setNeedsRefresh(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not re-evaluate the hunt.",
      );
    } finally {
      setBusy(false);
    }
  }
  const allPicks = result?.boxes.flatMap((box) => box.picks) ?? [];
  const chosen = allPicks
    .filter((pick) => selection[huntPickKey(pick)] > 0)
    .map((pick) => ({ ...pick, quantity: selection[huntPickKey(pick)] }));
  const quantity = chosen.reduce(
    (sum, pick) => sum + (Number.isFinite(pick.quantity) ? pick.quantity : 0),
    0,
  );
  const invalid = chosen.some(
    (pick) =>
      !Number.isSafeInteger(pick.quantity) ||
      pick.quantity < 1 ||
      pick.quantity >
        (allPicks.find((source) => huntPickKey(source) === huntPickKey(pick))
          ?.quantity ?? 0),
  );
  const actionDisabled =
    !chosen.length ||
    invalid ||
    chosen.length > 500 ||
    blocked ||
    needsRefresh ||
    !context;
  function known(value: HuntActionResult, input: HuntActionInput) {
    setAction(null);
    setFrozen(null);
    setSelection({});
    if (value.status === "REJECTED") {
      setError(
        value.message +
          " No cards were moved by this confirmation. Refresh the hunt to continue.",
      );
      setNeedsRefresh(true);
      return;
    }
    const stamps = new Map(
      value.stockUpdates.map((row) => [row.id, row.stamp]),
    );
    const held = (adjustments.held ?? [])
      .map((pin) => ({
        ...pin,
        quantity:
          pin.quantity -
          input.selected
            .filter(
              (row) =>
                row.requestId === pin.requestId &&
                row.inventoryItemId === pin.id,
            )
            .reduce((n, row) => n + row.quantity, 0),
        stamp: stamps.get(pin.id) ?? pin.stamp,
      }))
      .filter((pin) => pin.quantity > 0);
    const completed = new Map(
      (adjustments.completed ?? []).map((row) => [row.requestId, row.quantity]),
    );
    if (value.action === "GIVE")
      for (const row of input.selected)
        completed.set(
          row.requestId,
          (completed.get(row.requestId) ?? 0) + row.quantity,
        );
    const next = {
      ...adjustments,
      held,
      completed: [...completed].map(([requestId, quantity]) => ({
        requestId,
        quantity,
      })),
    };
    setAdjustments(next);
    setLastInput((previous) =>
      previous ? { ...previous, adjustments: next } : null,
    );
    setMessage(value.message);
    const remaining = result
      ? advanceHunt(result, input.selected, value)
      : null;
    setResult(remaining);
    setSelection(remaining ? markedHuntSelection(remaining) : {});
    if (value.action === "GIVE")
      setGiven((previous) => previous + value.quantity);
  }
  return (
    <div className="space-y-5">
      {frozen && (
        <div role="status" className="app-panel space-y-2 border-amber-600 p-4">
          <p>
            A previous hunt confirmation needs verification before another
            action.
          </p>
          <button
            type="button"
            className={filterPrimaryButtonClass}
            onClick={() => setAction(frozen.input.action)}
          >
            Check pending confirmation
          </button>
        </div>
      )}
      {corruptPending && (
        <p role="alert" className="app-panel p-4">
          The saved pending confirmation could not be read. Keep the original
          tab and check your deck or handoff history before starting another
          action.
        </p>
      )}
      {otherPending && (
        <p role="status" className="app-panel p-4">
          An earlier individual card handoff needs verification.{" "}
          <Link className="underline" href="/inventory">
            Open Inventory and check the pending handoff.
          </Link>
        </p>
      )}
      <details
        open={setupOpen}
        onToggle={(event) => setSetupOpen(event.currentTarget.open)}
      >
        <summary className={filterButtonClass}>
          {result
            ? "Edit hunt sources and preferences"
            : "Hunt sources and preferences"}
        </summary>
        <form
          onSubmit={(event) => void generate(event)}
          className="app-panel p-4 sm:p-5"
        >
          <fieldset
            disabled={busy || blocked}
            onChange={clearPlan}
            className="min-w-0 space-y-4 disabled:opacity-70"
          >
            {card ? (
              <p className="text-sm font-medium">
                {card.scope === "card"
                  ? "All printings and finishes"
                  : `Printing ${card.setCode.toUpperCase()} #${card.collectorNumber ?? "—"} · ${card.finish ? finishLabel(card.finish) : "All finishes"}`}
              </p>
            ) : (
              <>
                <section aria-label="Decks to hunt" className="space-y-2">
                  <h2 className="font-semibold">Saved decks</h2>
                  <p className="text-sm text-[var(--app-muted)]">
                    Choose one or more decks. Each deck gets its own copies.
                  </p>
                  {decks.length > 8 && (
                    <label className="block text-sm">
                      Find a deck
                      <input
                        aria-label="Find a deck"
                        value={deckSearch}
                        onChange={(event) => setDeckSearch(event.target.value)}
                        className={filterInputClass + " mt-1 w-full"}
                      />
                    </label>
                  )}
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-[var(--app-border)] p-2">
                    {decks
                      .filter((deck) =>
                        deck.name
                          .toLowerCase()
                          .includes(deckSearch.trim().toLowerCase()),
                      )
                      .map((deck) => (
                        <label
                          key={deck.id}
                          className="flex min-h-10 items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedDecks.includes(deck.id)}
                            onChange={(event) =>
                              setSelectedDecks((previous) =>
                                event.target.checked
                                  ? [...previous, deck.id]
                                  : previous.filter((id) => id !== deck.id),
                              )
                            }
                          />
                          {deck.name}
                        </label>
                      ))}
                    {!decks.length && (
                      <p className="text-sm">
                        No personal decks yet. Paste a list below.
                      </p>
                    )}
                  </div>
                </section>
                <section aria-label="Pasted lists" className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">Pasted lists</h2>
                    <button
                      type="button"
                      className={filterButtonClass}
                      onClick={() => {
                        setLists((previous) => [
                          ...previous,
                          {
                            id: crypto.randomUUID(),
                            label: `List ${previous.length + 1}`,
                            text: "",
                          },
                        ]);
                        clearPlan();
                      }}
                    >
                      Add pasted list
                    </button>
                  </div>
                  {lists.map((list, index) => (
                    <div
                      key={list.id}
                      className="space-y-2 rounded border border-[var(--app-border)] p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="min-w-0 flex-1 text-sm">
                          List name
                          <input
                            aria-label={`List ${index + 1} name`}
                            required
                            maxLength={100}
                            value={list.label}
                            onChange={(event) =>
                              setLists((previous) =>
                                previous.map((item) =>
                                  item.id === list.id
                                    ? { ...item, label: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className={filterInputClass + " mt-1 w-full"}
                          />
                        </label>
                        <button
                          type="button"
                          className={filterButtonClass}
                          onClick={() => {
                            setLists((previous) =>
                              previous.filter((item) => item.id !== list.id),
                            );
                            clearPlan();
                          }}
                        >
                          Remove list {index + 1}
                        </button>
                      </div>
                      <label className="block text-sm">
                        Cards to find
                        <textarea
                          aria-label={`Cards to find in list ${index + 1}`}
                          required
                          maxLength={100000}
                          value={list.text}
                          onChange={(event) =>
                            setLists((previous) =>
                              previous.map((item) =>
                                item.id === list.id
                                  ? { ...item, text: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          className={filterInputClass + " mt-1 min-h-32 w-full"}
                          placeholder={
                            "1 Sol Ring\n3 Forest (M21) 274\n1 Arcane Signet *F*"
                          }
                        />
                      </label>
                    </div>
                  ))}
                  <p className="text-xs text-[var(--app-muted)]">
                    Combine up to 20 decks/lists and 1,000 card lines.
                    Quantities add across all sources. Each pasted list keeps
                    its name.
                  </p>
                </section>
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {!card && (
                <label className="block text-sm">
                  Finish preference
                  <select
                    aria-label="Finish preference"
                    value={finish}
                    onChange={(event) =>
                      setFinish(event.target.value as HuntFinish)
                    }
                    className={filterSelectClass + " mt-1 w-full"}
                  >
                    <option value="ANY">Any finish</option>
                    <option value="FOIL">Prefer foil</option>
                    <option value="NONFOIL">Prefer nonfoil</option>
                    <option value="ETCHED">Prefer etched</option>
                  </select>
                </label>
              )}
              <label className="block text-sm">
                Pull priority
                <select
                  aria-label="Pull priority"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as HuntMode)}
                  className={filterSelectClass + " mt-1 w-full"}
                >
                  <option value="preferences">My preferences first</option>
                  <option value="boxes">Optimize boxes</option>
                </select>
              </label>
            </div>
            {!card && (
              <>
                <p className="text-sm text-[var(--app-muted)]">
                  {mode === "preferences"
                    ? "Prioritize your finish preference and requested printing, then group by box. Other available copies can fill gaps."
                    : "Favor boxes that cover more of the combined hunt. Printing and finish preferences break ties; substitutions are marked."}
                </p>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeMaybeboard}
                      onChange={(event) =>
                        setIncludeMaybeboard(event.target.checked)
                      }
                    />
                    Include maybeboard
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ignoreBasicLands}
                      onChange={(event) =>
                        setIgnoreBasicLands(event.target.checked)
                      }
                    />
                    Ignore basic lands in decks
                  </label>
                </div>
              </>
            )}
            <button type="submit" className={filterPrimaryButtonClass}>
              {busy
                ? "Finding your cards…"
                : card
                  ? "Find copies"
                  : "Build hunt"}
            </button>
          </fieldset>
          <p className="mt-3 text-xs text-[var(--app-muted)]">
            Planning uses your available storage copies and does not reserve or
            move cards. Cards committed to decks and active trade reservations
            are excluded.
          </p>
        </form>
      </details>
      {contextError && (
        <p role="status" className="app-panel p-4">
          {contextError}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="app-panel space-y-2 border-red-700 p-4 text-red-300"
        >
          <p>{error}</p>
          {needsRefresh && (
            <button
              type="button"
              className={filterButtonClass}
              onClick={() => void generate()}
            >
              Refresh hunt
            </button>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="app-panel p-4">
          {message}{" "}
          <Link href="/inventory/handoffs" className="underline">
            Handoff history
          </Link>
        </p>
      )}
      {busy && <p role="status">Checking storage and available copies…</p>}
      {result && (
        <section aria-label="Hunt results" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{result.title}</h2>
              <p role="status" className="text-sm">
                {result.boxes.length} locations · {result.planned} to pull ·{" "}
                {result.shortage} short
                {result.alreadyInDeck
                  ? ` ? ${result.alreadyInDeck} committed`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              className={filterButtonClass}
              disabled={busy || blocked}
              onClick={() => void replan(adjustments)}
            >
              Re-evaluate remaining
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={busy || blocked}
              checked={adjustments.includeBulk !== false}
              onChange={(event) =>
                void replan({
                  ...adjustments,
                  includeBulk: event.target.checked,
                })
              }
            />
            Use Bulk Boxes only after normal storage
          </label>
          {!!result.ignoredBasicLandCopies && (
            <p className="text-sm">
              {result.ignoredBasicLandCopies} basic land copies skipped.
            </p>
          )}
          {result.shortage > 0 && (
            <details open>
              <summary className="text-sm font-medium">
                Still needed ({result.shortage})
              </summary>
              <ul className="my-2 text-sm">
                {result.lines
                  .filter((line) => line.shortage > 0)
                  .map((line) => (
                    <li key={line.request.id}>
                      {line.shortage} × {line.request.name} ·{" "}
                      {line.request.sourceLabel}
                      <button
                        type="button"
                        className="ml-3 underline"
                        disabled={busy || blocked}
                        onClick={() =>
                          setPrinting({
                            requestId: line.request.id,
                            name: line.request.name,
                          })
                        }
                      >
                        Choose printing
                      </button>
                    </li>
                  ))}
              </ul>
            </details>
          )}
          {!!result.warnings.length && (
            <details>
              <summary>List notes ({result.warnings.length})</summary>
              {result.warnings.map((warning, index) => (
                <p key={index} className="text-sm">
                  {warning}
                </p>
              ))}
            </details>
          )}
          <PullWorkspace
            rows={result.boxes.flatMap((box) =>
              box.picks.map((pick) => ({
                id: huntPickKey(pick),
                itemId: pick.inventoryItemId,
                name: pick.name,
                quantity: pick.quantity,
                printing: `${pick.setCode.toUpperCase()} #${pick.collectorNumber}`,
                finish: pick.finish,
                language: pick.language,
                condition: pick.condition,
                locationId: box.id,
                location: box.name,
                section: pick.section,
                destination: pick.sourceLabel,
                pulled: pick.pulledQuantity ?? 0,
                card: pullCardRow({
                  id: huntPickKey(pick),
                  cardId: pick.cardId,
                  name: pick.name,
                  quantity: pick.quantity,
                  setCode: pick.setCode,
                  collectorNumber: pick.collectorNumber,
                  finish: pick.finish,
                  card: pick.card,
                  location: box.name,
                  destination: pick.sourceLabel,
                }),
              })),
            )}
            selection={selection}
            onSelection={setSelection}
            disabled={busy || blocked}
            scope={adjustments}
            locations={result.locations}
            onScope={(scope) => void replan({ ...adjustments, ...scope })}
            onSkip={(row) => {
              const pick = allPicks.find(
                (pick) => huntPickKey(pick) === row.id,
              )!;
              void replan({
                ...adjustments,
                excludedItems: [
                  ...new Set([
                    ...(adjustments.excludedItems ?? []),
                    pick.inventoryItemId,
                  ]),
                ],
              });
            }}
            onPrinting={(row) => {
              const pick = allPicks.find(
                (pick) => huntPickKey(pick) === row.id,
              )!;
              setPrinting({ requestId: pick.requestId, name: pick.name });
            }}
            onPulled={(row, quantity) => {
              const pick = allPicks.find(
                (pick) => huntPickKey(pick) === row.id,
              )!;
              const held = (adjustments.held ?? []).filter(
                (pin) =>
                  pin.requestId !== pick.requestId ||
                  pin.id !== pick.inventoryItemId,
              );
              if (quantity)
                held.push({
                  requestId: pick.requestId,
                  id: pick.inventoryItemId,
                  quantity,
                  stamp: pick.stamp!,
                });
              void replan({ ...adjustments, held });
            }}
          >
            <div
              className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-3"
              aria-label="Selected hunt cards"
            >
              <strong aria-live="polite">
                {quantity} copies ready ({chosen.length} pulls)
              </strong>

              <button
                type="button"
                className={filterPrimaryButtonClass}
                disabled={
                  busy || actionDisabled || chosen.some((pick) => !pick.deckId)
                }
                onClick={() => setAction("COMMIT")}
              >
                Commit selected to decks
              </button>
              <button
                type="button"
                className={filterPrimaryButtonClass}
                disabled={busy || actionDisabled}
                onClick={() => setAction("GIVE")}
              >
                Give / trade selected
              </button>
              {chosen.some((pick) => !pick.deckId) && (
                <p className="text-xs">
                  Pasted-list pulls can be given away; deck commitment uses
                  saved-deck pulls.
                </p>
              )}
            </div>
          </PullWorkspace>
        </section>
      )}
      {printing && lastInput && (
        <HuntPrintingPicker
          input={lastInput}
          requestId={printing.requestId}
          name={printing.name}
          onClose={() => setPrinting(null)}
          onChoose={(option) => {
            const requestId = printing.requestId;
            setPrinting(null);
            void replan({
              ...adjustments,
              printings: [
                ...(adjustments.printings ?? []).filter(
                  (row) => row.requestId !== requestId,
                ),
                ...(option
                  ? [
                      {
                        requestId,
                        cardId: option.cardId,
                        finish: option.finish as "NONFOIL" | "FOIL" | "ETCHED",
                      },
                    ]
                  : []),
              ],
            });
          }}
        />
      )}
      {action && context && (frozen || lastInput) && (
        <CardHuntActionDialog
          action={frozen?.input.action ?? action}
          hunt={frozen?.input.hunt ?? lastInput!}
          picks={chosen}
          context={context}
          frozen={frozen}
          onFreeze={setFrozen}
          onKnown={known}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}
