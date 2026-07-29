export const dynamic = "force-dynamic";
import Papa from "papaparse";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  FoilStatus,
  InventoryLocationKind,
  InventorySourceType,
} from "@prisma/client";
import { Nav } from "@/components/Nav";
import { getAccessScope, requireLogin as requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  findOrImportCard,
  normalizeCollectorNumber,
  normalizeSetCode,
  searchLocalThenScryfallCards,
  upsertScryfallCard,
} from "@/lib/card-import";
import { formatScryfallError, getCardByScryfallIdResult } from "@/lib/scryfall";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { ImportProgressPanel } from "@/components/ImportProgressPanel";
import { SingleCardInventoryAdd } from "@/components/SingleCardInventoryAdd";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { InventoryExportForm } from "@/components/InventoryExportForm";
import { calculateImportProgress } from "@/lib/import-progress";
import {
  filterImportReviewItems,
  finalImportStatuses,
  getImportReviewBucket,
  getImportReviewSummary,
  importReviewFilters,
  importableStatuses,
  isImportItemReadyToCommit,
  normalizeImportReviewFilter,
} from "@/lib/import-review";
import {
  cancelImportResolutionJob,
  createOrReuseImportResolutionJob,
  getImportResolutionJobConfig,
  isActiveImportResolutionStatus,
  processImportResolutionJob,
  serializeImportResolutionJob,
} from "@/lib/import-resolution-job";
import {
  ensureDefaultLocation,
  getLocationsForOwner,
  normalizeLocationName,
} from "@/lib/inventory-locations";
import { normalizeInventoryCondition } from "@/lib/inventory-condition";
import {
  cn,
  filterButtonClass,
  filterFieldClass,
  filterInputClass,
  filterPanelClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "@/components/filterStyles";

const aliases: Record<string, string[]> = {
  quantity: ["quantity", "count", "qty", "copies"],
  name: ["name", "card name"],
  setCode: ["set", "set code", "edition"],
  collectorNumber: ["collector number", "collector #", "number", "cn"],
  foil: ["foil", "foil status", "finish"],
  condition: ["condition"],
  language: ["language", "lang"],
  notes: ["notes", "comment", "tag", "tags"],
  location: ["location", "location name", "storage", "storage location"],
  scryfallId: ["scryfall id", "scryfallid", "scryfall_id"],
};

function safeStoredFilename(prefix: string, originalName: string) {
  const base = path
    .basename(originalName || "inventory-import.csv")
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${prefix}-${base || "inventory-import.csv"}`;
}

async function persistCsvText(
  directory: string | undefined,
  filename: string,
  text: string,
) {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), text, "utf8");
}

type ParsedRow = {
  quantity: number;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  foilRaw?: string;
  foilStatus: FoilStatus;
  condition: string;
  language: string;
  notes?: string;
  locationName?: string;
  scryfallId?: string;
  warning?: string;
  error?: string;
};

type SearchParams = {
  batchId?: string;
  resolveItemId?: string;
  resolverQ?: string;
  status?: string;
  q?: string;
  singleCardAdded?: string;
  exportTools?: string;
  ownerId?: string;
  locationId?: string | string[];
};

function norm(value: string) {
  return value.trim().toLowerCase();
}
function getCell(row: Record<string, string>, key: keyof typeof aliases) {
  const wanted = aliases[key];
  const found = Object.entries(row).find(([header]) =>
    wanted.includes(norm(header)),
  );
  return found ? String(found[1] ?? "").trim() : "";
}
function parseFoil(value: string) {
  const v = norm(value);
  if (
    !v ||
    [
      "nonfoil",
      "non-foil",
      "regular",
      "normal",
      "false",
      "no",
      "n",
      "0",
    ].includes(v)
  )
    return { status: FoilStatus.NONFOIL, warning: "" };
  if (["foil", "foiled", "true", "yes", "y", "1"].includes(v))
    return { status: FoilStatus.FOIL, warning: "" };
  if (["etched", "etched foil", "foil etched"].includes(v))
    return { status: FoilStatus.ETCHED, warning: "" };
  return {
    status: FoilStatus.NONFOIL,
    warning: `Invalid foil value "${value}"; defaulted to NONFOIL.`,
  };
}
function parseCondition(value: string) {
  return normalizeInventoryCondition(value);
}
function parseLanguage(value: string) {
  const v = norm(value);
  if (!v) return "EN";
  const map: Record<string, string> = {
    en: "EN",
    english: "EN",
    ja: "JA",
    japanese: "JA",
    de: "DE",
    german: "DE",
    fr: "FR",
    french: "FR",
    es: "ES",
    spanish: "ES",
    it: "IT",
    italian: "IT",
    pt: "PT",
    portuguese: "PT",
    ru: "RU",
    russian: "RU",
    ko: "KO",
    korean: "KO",
    zhs: "ZHS",
    "simplified chinese": "ZHS",
    zht: "ZHT",
    "traditional chinese": "ZHT",
  };
  return map[v] ?? value.trim().toUpperCase();
}
function parseRow(row: Record<string, string>, rowNumber: number): ParsedRow {
  const quantityRaw = getCell(row, "quantity");
  const quantity = Number(quantityRaw || "0");
  const name = getCell(row, "name")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const foilRaw = getCell(row, "foil");
  const foil = parseFoil(foilRaw);
  const condition = parseCondition(getCell(row, "condition"));
  const language = parseLanguage(getCell(row, "language"));
  const errors = [];
  if (!Number.isInteger(quantity) || quantity <= 0)
    errors.push("Quantity must be a positive integer.");
  if (!name) errors.push("Name is required.");
  return {
    quantity,
    name,
    setCode: normalizeSetCode(getCell(row, "setCode")),
    collectorNumber: normalizeCollectorNumber(getCell(row, "collectorNumber")),
    foilRaw,
    foilStatus: foil.status,
    condition,
    language,
    notes: getCell(row, "notes") || undefined,
    locationName: getCell(row, "location") || undefined,
    scryfallId: getCell(row, "scryfallId") || undefined,
    warning: foil.warning || undefined,
    error: errors.length ? `Row ${rowNumber}: ${errors.join(" ")}` : undefined,
  };
}
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
function cardImage(
  card?: { imageUri?: string | null; imageUris?: unknown } | null,
) {
  const images = card?.imageUris as
    { small?: string; normal?: string } | null | undefined;
  return images?.small ?? images?.normal ?? card?.imageUri ?? "";
}
function statusBadgeClass(status: string) {
  if (status === "matched" || status === "imported")
    return "bg-emerald-900/60 text-emerald-200 border-emerald-700";
  if (status === "new") return "bg-sky-900/60 text-sky-200 border-sky-700";
  if (
    status === "resolved" ||
    status === "manually_resolved" ||
    status === "changed"
  )
    return "bg-purple-900/60 text-purple-200 border-purple-700";
  if (status === "ambiguous")
    return "bg-amber-900/60 text-amber-200 border-amber-700";
  if (status === "skipped") return "bg-zinc-800 text-zinc-200 border-zinc-600";
  return "bg-red-950/70 text-red-200 border-red-800";
}
function buildResolverQuery(parsed: ParsedRow, override?: string) {
  const q = override?.trim();
  if (q) return q;
  if (parsed.setCode && parsed.collectorNumber)
    return `set:${parsed.setCode} cn:${parsed.collectorNumber}`;
  if (parsed.setCode && parsed.name)
    return `!"${parsed.name}" set:${parsed.setCode}`;
  return parsed.name || "";
}
function buildImportReviewUrl(
  batchId: string,
  options: {
    status?: string;
    q?: string;
    resolveItemId?: string | null;
    resolverQ?: string | null;
  } = {},
) {
  const query = new URLSearchParams({ batchId });
  if (options.status && options.status !== "all")
    query.set("status", options.status);
  if (options.q) query.set("q", options.q);
  if (options.resolveItemId) query.set("resolveItemId", options.resolveItemId);
  if (options.resolverQ) query.set("resolverQ", options.resolverQ);
  return `/imports?${query.toString()}`;
}

function getReturnReviewOptions(fd: FormData) {
  return {
    status: String(fd.get("returnStatus") || ""),
    q: String(fd.get("returnQ") || ""),
  };
}

async function recalculateBatchCounts(batchId: string) {
  const items = await prisma.importBatchItem.findMany({
    where: { importBatchId: batchId },
  });
  const matchedRows = items.filter((item) =>
    finalImportStatuses.includes(item.status),
  ).length;
  const skippedRows = items.filter((item) => item.status === "skipped").length;
  const warningRows = items.filter((item) =>
    Boolean(
      item.message?.toLowerCase().includes("warning") ||
      (item.parsedRowJson as ParsedRow).warning,
    ),
  ).length;
  const errorRows = items.filter(
    (item) =>
      item.status === "unmatched" ||
      item.status === "ambiguous" ||
      item.status === "error",
  ).length;
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { matchedRows, skippedRows, warningRows, errorRows },
  });
}

async function recordResolutionAttempt(
  item: {
    id: string;
    status: string;
    message: string | null;
    parsedRowJson: unknown;
  },
  mode: string,
  nextStatus: string,
  method: string,
  confidence: string,
  queryUsed: string | null,
  message: string,
  cardId?: string | null,
  scryfallId?: string | null,
  candidates?: unknown,
  error?: unknown,
) {
  await prisma.importResolutionAttempt.create({
    data: {
      importBatchItemId: item.id,
      mode,
      previousStatus: item.status,
      newStatus: nextStatus,
      resolutionMethod: method,
      confidence,
      queryUsed,
      message,
      matchedCardPrintingId: cardId ?? null,
      matchedScryfallId: scryfallId ?? null,
      candidatesJson: candidates ? jsonSafe(candidates) : undefined,
      errorJson: error ? jsonSafe(error) : undefined,
    },
  });
}
function resolutionMethodFromMessage(message?: string) {
  const m = message?.toLowerCase() || "";
  if (m.includes("scryfall id")) return "scryfall_id";
  if (m.includes("collector")) return "set_collector";
  if (m.includes("exact name and set")) return "exact_name_set";
  if (m.includes("fuzzy")) return "fuzzy_name";
  if (m.includes("exact name")) return "exact_name";
  return "unresolved";
}
function confidenceFromStatus(status: string, message?: string) {
  const m = message?.toLowerCase() || "";
  if (
    (status === "matched" || status === "new" || status === "resolved") &&
    (m.includes("scryfall id") || m.includes("collector"))
  )
    return "exact";
  if (status === "matched" || status === "new" || status === "resolved")
    return m.includes("fuzzy") ? "medium" : "high";
  if (status === "ambiguous") return "low";
  return "low";
}
async function retryOneImportItem(
  item: {
    id: string;
    status: string;
    message: string | null;
    cardPrintingId: string | null;
    parsedRowJson: unknown;
  },
  mode: "normal_retry" | "deep_resolve",
) {
  const parsedRow = item.parsedRowJson as ParsedRow;
  const queryUsed = buildResolverQuery(parsedRow);
  try {
    const match = await findOrImportCard(parsedRow);
    const nextStatus =
      match.status === "matched" || match.status === "new"
        ? "resolved"
        : match.status;
    const method =
      match.method?.toLowerCase() ?? resolutionMethodFromMessage(match.message);
    const confidence =
      match.confidence !== undefined
        ? String(match.confidence)
        : confidenceFromStatus(nextStatus, match.message);
    await recordResolutionAttempt(
      item,
      mode,
      nextStatus,
      method,
      confidence,
      queryUsed,
      match.message,
      match.card?.id,
      match.card?.scryfallId ?? null,
    );
    await prisma.importBatchItem.update({
      where: { id: item.id },
      data: {
        status: nextStatus,
        message: match.message,
        cardPrintingId: match.card?.id ?? item.cardPrintingId,
      },
    });
    return nextStatus;
  } catch (error) {
    await recordResolutionAttempt(
      item,
      mode,
      "error",
      "unresolved",
      "low",
      queryUsed,
      "Retry failed.",
      null,
      null,
      null,
      error,
    );
    await prisma.importBatchItem.update({
      where: { id: item.id },
      data: { status: "error", message: "Retry failed." },
    });
    return "error";
  }
}
async function assertAdminUser() {
  const actionUser = await requireAuth();
  const actionUserWithPlayer = await prisma.user.findUnique({
    where: { id: actionUser.id },
    include: { player: true },
  });
  const actionScope = await getAccessScope(actionUserWithPlayer ?? actionUser);
  if (actionScope?.mode !== "admin")
    throw new Error("Enter Admin Mode to use this action.");
  return actionUser;
}

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAuth();
  const userWithPlayer = await prisma.user.findUnique({
    where: { id: user.id },
    include: { player: true },
  });
  const accessScope = await getAccessScope(userWithPlayer ?? user);
  const isAdmin = accessScope?.mode === "admin";
  const params = await searchParams;
  const players = await prisma.player.findMany({
    where: { active: true },
    orderBy: { displayName: "asc" },
  });
  const defaultPlayer = userWithPlayer?.player ?? players[0];

  async function previewImport(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionScope = await getAccessScope(
      actionUserWithPlayer ?? actionUser,
    );
    const actionIsAdmin = actionScope?.mode === "admin";
    if (!actionIsAdmin && !actionUserWithPlayer?.playerId)
      throw new Error(
        "Your login is not linked to an inventory owner. Ask an admin to save your account before importing.",
      );
    const selectedPlayerId = actionIsAdmin
      ? String(fd.get("selectedPlayerId") || "")
      : String(actionUserWithPlayer!.playerId);
    const selectedOriginalOpenerId = selectedPlayerId;
    const file = fd.get("csvFile") as File | null;
    const duplicateBehavior = ["add", "separate", "preview"].includes(
      String(fd.get("duplicateBehavior")),
    )
      ? String(fd.get("duplicateBehavior"))
      : "add";
    if (!selectedPlayerId || !file)
      throw new Error("Owner and CSV file are required.");
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      transform: (v) => String(v ?? "").trim(),
    });
    if (parsed.errors.length)
      throw new Error(parsed.errors.map((e) => e.message).join("; "));

    const rows = parsed.data;
    const batch = await prisma.importBatch.create({
      data: {
        importType: `inventory_csv:${duplicateBehavior}`,
        filename: file.name || "inventory-import.csv",
        selectedPlayerId,
        selectedOriginalOpenerId,
        selectedRoundId: null,
        status: "PREVIEW",
        totalRows: rows.length,
        createdByUserId: actionUser.id,
      },
    });
    const storedFilename = safeStoredFilename(
      batch.id,
      file.name || "inventory-import.csv",
    );
    await Promise.all([
      persistCsvText(process.env.UPLOADS_DATA_PATH, storedFilename, text),
      persistCsvText(process.env.IMPORTS_DATA_PATH, storedFilename, text),
    ]);
    const itemsToCreate = [];
    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const parsedRow = parseRow(row, rowNumber);
      let status = "unmatched";
      let message = parsedRow.error || "";
      if (parsedRow.error) {
        status = "error";
      } else {
        message = [
          "Queued for automatic resolution.",
          parsedRow.warning ? `Warning: ${parsedRow.warning}` : "",
        ]
          .filter(Boolean)
          .join(" ");
      }
      itemsToCreate.push({
        importBatchId: batch.id,
        rowNumber,
        rawRowJson: jsonSafe(row),
        parsedRowJson: jsonSafe(parsedRow),
        status,
        message: message || null,
        parsedFoilStatus: parsedRow.foilStatus,
        parsedCondition: parsedRow.condition,
      });
    }
    if (itemsToCreate.length) {
      await prisma.importBatchItem.createMany({
        data: itemsToCreate,
      });
    }
    const { job, created } = await createOrReuseImportResolutionJob({
      prisma,
      importBatchId: batch.id,
      createdByUserId: actionUser.id,
    });
    if (created || job.status === "QUEUED") {
      void processImportResolutionJob({
        prisma,
        jobId: job.id,
        recordAttempt: recordResolutionAttempt,
        buildQuery: (row) => buildResolverQuery(row as ParsedRow),
        recalculateBatchCounts,
      });
    }
    await recalculateBatchCounts(batch.id);
    revalidatePath("/imports");
    redirect(`${buildImportReviewUrl(batch.id)}#import-review`);
  }

  async function updateImportRow(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionScope = await getAccessScope(
      actionUserWithPlayer ?? actionUser,
    );
    const actionIsAdmin = actionScope?.mode === "admin";
    const itemId = String(fd.get("itemId") || "");
    const item = await prisma.importBatchItem.findUnique({
      where: { id: itemId },
      include: { importBatch: true },
    });
    if (!item) throw new Error("Import row not found.");
    if (
      !actionIsAdmin &&
      item.importBatch.selectedPlayerId !== actionUserWithPlayer?.playerId
    )
      throw new Error("Not authorized for this import row.");
    const quantity = Number(fd.get("quantity"));
    if (!Number.isInteger(quantity) || quantity <= 0)
      throw new Error("Quantity must be a positive integer.");
    const foilStatusRaw = String(
      fd.get("foilStatus") || "NONFOIL",
    ).toUpperCase();
    if (!["NONFOIL", "FOIL", "ETCHED"].includes(foilStatusRaw))
      throw new Error("Invalid foil status.");
    const parsed = item.parsedRowJson as ParsedRow;
    const nextParsed: ParsedRow = {
      ...parsed,
      quantity,
      foilStatus: foilStatusRaw as FoilStatus,
      condition: parseCondition(String(fd.get("condition") || "NM")),
      language: parseLanguage(String(fd.get("language") || "EN")),
      notes: String(fd.get("notes") || "") || undefined,
      warning: String(fd.get("rowNote") || parsed.warning || "") || undefined,
    };
    const nextStatus =
      item.status === "error" && item.cardPrintingId ? "resolved" : item.status;
    await prisma.importBatchItem.update({
      where: { id: item.id },
      data: {
        parsedRowJson: jsonSafe(nextParsed),
        parsedFoilStatus: nextParsed.foilStatus,
        parsedCondition: nextParsed.condition,
        status: nextStatus,
        message: nextParsed.warning
          ? `Warning: ${nextParsed.warning}`
          : item.message,
      },
    });
    await recalculateBatchCounts(item.importBatchId);
    revalidatePath("/imports");
    const returnOptions = getReturnReviewOptions(fd);
    redirect(
      buildImportReviewUrl(item.importBatchId, {
        ...returnOptions,
        resolveItemId: item.id,
      }),
    );
  }

  async function resolveImportRow(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionScope = await getAccessScope(
      actionUserWithPlayer ?? actionUser,
    );
    const actionIsAdmin = actionScope?.mode === "admin";
    const itemId = String(fd.get("itemId") || "");
    const scryfallId = String(fd.get("scryfallId") || "");
    const item = await prisma.importBatchItem.findUnique({
      where: { id: itemId },
      include: { importBatch: true },
    });
    if (!item) throw new Error("Import row not found.");
    if (
      !actionIsAdmin &&
      item.importBatch.selectedPlayerId !== actionUserWithPlayer?.playerId
    )
      throw new Error("Not authorized for this import row.");
    let card = await prisma.card.findUnique({ where: { scryfallId } });
    if (!card) {
      const cardResult = await getCardByScryfallIdResult(scryfallId);
      if (!cardResult.ok) {
        throw new Error(formatScryfallError(cardResult.error));
      }
      card = await upsertScryfallCard(cardResult.data);
    }
    const previousWasMatched =
      Boolean(item.cardPrintingId) || importableStatuses.includes(item.status);
    const nextStatus = previousWasMatched ? "changed" : "resolved";
    await prisma.importBatchItem.update({
      where: { id: item.id },
      data: {
        cardPrintingId: card.id,
        status: nextStatus,
        message: `${previousWasMatched ? "Changed" : "Resolved"} manually to ${card.name} (${card.setCode.toUpperCase()}) #${card.collectorNumber}`,
      },
    });
    await recalculateBatchCounts(item.importBatchId);
    revalidatePath("/imports");
    redirect(
      buildImportReviewUrl(item.importBatchId, getReturnReviewOptions(fd)),
    );
  }

  async function setRowSkipped(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionScope = await getAccessScope(
      actionUserWithPlayer ?? actionUser,
    );
    const actionIsAdmin = actionScope?.mode === "admin";
    const itemId = String(fd.get("itemId") || "");
    const item = await prisma.importBatchItem.findUnique({
      where: { id: itemId },
      include: { importBatch: true },
    });
    if (!item) throw new Error("Import row not found.");
    if (
      !actionIsAdmin &&
      item.importBatch.selectedPlayerId !== actionUserWithPlayer?.playerId
    )
      throw new Error("Not authorized for this import row.");
    const unskip = fd.get("unskip") === "true";
    const nextStatus = unskip
      ? item.cardPrintingId
        ? "resolved"
        : "unmatched"
      : "skipped";
    await prisma.importBatchItem.update({
      where: { id: item.id },
      data: {
        status: nextStatus,
        message: unskip
          ? "Row restored for review."
          : "Row skipped by reviewer.",
      },
    });
    await recalculateBatchCounts(item.importBatchId);
    revalidatePath("/imports");
    redirect(
      buildImportReviewUrl(item.importBatchId, getReturnReviewOptions(fd)),
    );
  }

  async function startImportResolutionJob(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionScope = await getAccessScope(
      actionUserWithPlayer ?? actionUser,
    );
    const actionIsAdmin = actionScope?.mode === "admin";
    const batchId = String(fd.get("batchId") || "");
    const batch = await prisma.importBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new Error("Import batch not found.");
    if (
      !actionIsAdmin &&
      batch.selectedPlayerId !== actionUserWithPlayer?.playerId
    )
      throw new Error("Not authorized for this import batch.");

    const { job, created } = await createOrReuseImportResolutionJob({
      prisma,
      importBatchId: batch.id,
      createdByUserId: actionUser.id,
    });

    if (
      created ||
      job.status === "QUEUED" ||
      ["FAILED", "STALE"].includes(job.status)
    ) {
      void processImportResolutionJob({
        prisma,
        jobId: job.id,
        recordAttempt: recordResolutionAttempt,
        buildQuery: (row) => buildResolverQuery(row as ParsedRow),
        recalculateBatchCounts,
      });
    }

    revalidatePath("/imports");
    redirect(buildImportReviewUrl(batch.id, getReturnReviewOptions(fd)));
  }

  async function cancelResolutionJobAction(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionScope = await getAccessScope(
      actionUserWithPlayer ?? actionUser,
    );
    const actionIsAdmin = actionScope?.mode === "admin";
    const jobId = String(fd.get("jobId") || "");
    const job = await prisma.importResolutionJob.findUnique({
      where: { id: jobId },
      include: { importBatch: true },
    });
    if (!job) throw new Error("Resolution job not found.");
    if (
      !actionIsAdmin &&
      job.importBatch.selectedPlayerId !== actionUserWithPlayer?.playerId
    )
      throw new Error("Not authorized for this import batch.");
    await cancelImportResolutionJob(prisma, job.id);
    revalidatePath("/imports");
    redirect(
      buildImportReviewUrl(job.importBatchId, getReturnReviewOptions(fd)),
    );
  }

  async function retryUnresolvedRows(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionScope = await getAccessScope(
      actionUserWithPlayer ?? actionUser,
    );
    const actionIsAdmin = actionScope?.mode === "admin";
    const batchId = String(fd.get("batchId") || "");
    const itemId = String(fd.get("itemId") || "");
    const mode =
      fd.get("mode") === "deep_resolve" ? "deep_resolve" : "normal_retry";
    const scope = String(fd.get("scope") || "batch");
    const where: any = {
      status: { in: ["unmatched", "ambiguous", "error", "suggested_match"] },
    };
    let items;
    if (itemId) {
      const item = await prisma.importBatchItem.findUnique({
        where: { id: itemId },
        include: { importBatch: true },
      });
      if (!item) throw new Error("Import row not found.");
      if (
        !actionIsAdmin &&
        item.importBatch.selectedPlayerId !== actionUserWithPlayer?.playerId
      )
        throw new Error("Not authorized for this import row.");
      items = [item];
    } else if (scope === "all") {
      if (!actionIsAdmin)
        throw new Error(
          "Admin permissions required to retry all unresolved imports.",
        );
      items = await prisma.importBatchItem.findMany({
        where,
        take: mode === "deep_resolve" ? 50 : 100,
        orderBy: { rowNumber: "asc" },
      });
    } else {
      const batch = await prisma.importBatch.findUnique({
        where: { id: batchId },
      });
      if (!batch) throw new Error("Import batch not found.");
      if (
        !actionIsAdmin &&
        batch.selectedPlayerId !== actionUserWithPlayer?.playerId
      )
        throw new Error("Not authorized for this import batch.");
      where.importBatchId = batchId;
      items = await prisma.importBatchItem.findMany({
        where,
        take: mode === "deep_resolve" ? 50 : 100,
        orderBy: { rowNumber: "asc" },
      });
    }
    const touchedBatchIds = new Set<string>();
    for (const item of items) {
      await retryOneImportItem(item, mode);
      touchedBatchIds.add(item.importBatchId);
      if (mode === "deep_resolve")
        await new Promise((resolve) => setTimeout(resolve, 75));
    }
    for (const id of touchedBatchIds) await recalculateBatchCounts(id);
    revalidatePath("/imports");
    redirect(batchId ? `/imports?batchId=${batchId}` : "/imports");
  }

  async function purgePreviewFailedImports() {
    "use server";
    await assertAdminUser();
    const batches = await prisma.importBatch.findMany({
      where: {
        status: {
          in: [
            "PREVIEW",
            "FAILED",
            "CANCELLED",
            "preview",
            "failed",
            "cancelled",
          ],
        },
      },
      select: { id: true },
    });
    const ids = batches.map((batch) => batch.id);
    if (ids.length) {
      await prisma.importResolutionAttempt.deleteMany({
        where: { importBatchItem: { importBatchId: { in: ids } } },
      });
      await prisma.importBatchItem.deleteMany({
        where: { importBatchId: { in: ids } },
      });
      await prisma.importBatch.deleteMany({ where: { id: { in: ids } } });
    }
    revalidatePath("/imports");
    redirect("/imports");
  }

  async function deleteImportHistory(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionScope = await getAccessScope(
      actionUserWithPlayer ?? actionUser,
    );
    const actionIsAdmin = actionScope?.mode === "admin";
    const batchId = String(fd.get("batchId") || "");
    let batchIds: string[];
    if (batchId) {
      const batch = await prisma.importBatch.findUnique({
        where: { id: batchId },
        select: { id: true, selectedPlayerId: true },
      });
      if (!batch) throw new Error("Import batch not found.");
      if (
        !actionIsAdmin &&
        batch.selectedPlayerId !== actionUserWithPlayer?.playerId
      )
        throw new Error("Not authorized for this import batch.");
      batchIds = [batch.id];
    } else if (actionIsAdmin) {
      const batches = await prisma.importBatch.findMany({
        select: { id: true },
      });
      batchIds = batches.map((batch) => batch.id);
    } else {
      if (!actionUserWithPlayer?.playerId)
        throw new Error("No player profile found for this user.");
      const batches = await prisma.importBatch.findMany({
        where: { selectedPlayerId: actionUserWithPlayer.playerId },
        select: { id: true },
      });
      batchIds = batches.map((batch) => batch.id);
    }
    if (!batchIds.length) {
      revalidatePath("/imports");
      redirect("/imports");
    }
    await prisma.importResolutionAttempt.deleteMany({
      where: { importBatchItem: { importBatchId: { in: batchIds } } },
    });
    await prisma.importBatchItem.deleteMany({
      where: { importBatchId: { in: batchIds } },
    });
    await prisma.importBatch.deleteMany({
      where: { id: { in: batchIds } },
    });
    revalidatePath("/imports");
    redirect("/imports");
  }

  async function undoImportBatch(fd: FormData) {
    "use server";
    const actionUser = await assertAdminUser();
    const batchId = String(fd.get("batchId") || "");
    const confirmation = String(fd.get("confirmation") || "");
    if (confirmation !== "DELETE IMPORT")
      throw new Error("Type DELETE IMPORT to confirm undo.");
    const batch = await prisma.importBatch.findUnique({
      where: { id: batchId },
      include: {
        items: { include: { inventoryItem: { include: { auditLogs: true } } } },
      },
    });
    if (!batch) throw new Error("Import batch not found.");
    for (const item of batch.items) {
      if (item.status !== "imported") continue;
      if (
        !item.quantityImported ||
        item.beforeQuantity === null ||
        item.beforeQuantity === undefined ||
        item.afterQuantity === null ||
        item.afterQuantity === undefined
      ) {
        await prisma.importBatchItem.update({
          where: { id: item.id },
          data: {
            status: "cannot_undo",
            message:
              "This import batch cannot be automatically undone because it was created before undo tracking existed.",
          },
        });
        continue;
      }
      if (item.pullId)
        await prisma.pull.deleteMany({ where: { id: item.pullId } });
      if (item.inventoryItemId) {
        const inventory = await prisma.inventoryItem.findUnique({
          where: { id: item.inventoryItemId },
          include: { auditLogs: true },
        });
        if (!inventory) {
          await prisma.importBatchItem.update({
            where: { id: item.id },
            data: {
              status: "undone",
              message:
                "Legacy source record deleted; inventory item was already gone.",
            },
          });
          continue;
        }
        const beforeJson = inventory as any;
        if (item.createdNewInventoryItem && item.beforeQuantity === 0) {
          if (inventory.auditLogs.length > 0) {
            await prisma.importBatchItem.update({
              where: { id: item.id },
              data: {
                status: "cannot_undo",
                message: "Cannot delete safely: inventory item has audit logs.",
              },
            });
            continue;
          }
          await prisma.inventoryItem.delete({ where: { id: inventory.id } });
        } else {
          const nextQuantity = Math.max(
            item.beforeQuantity,
            inventory.quantity - item.quantityImported,
          );
          if (nextQuantity <= 0 && inventory.auditLogs.length > 0) {
            await prisma.importBatchItem.update({
              where: { id: item.id },
              data: {
                status: "cannot_undo",
                message:
                  "Cannot reduce/delete safely: inventory item has audit logs.",
              },
            });
            continue;
          }
          if (nextQuantity <= 0)
            await prisma.inventoryItem.delete({ where: { id: inventory.id } });
          else {
            const updated = await prisma.inventoryItem.update({
              where: { id: inventory.id },
              data: { quantity: nextQuantity },
            });
            await prisma.inventoryAuditLog.create({
              data: {
                inventoryItemId: updated.id,
                changedByUserId: actionUser.id,
                changeType: "import_undo",
                beforeJson,
                afterJson: updated as any,
                reason: `Undo import ${batch.filename}`,
              },
            });
          }
        }
      }
      await prisma.importBatchItem.update({
        where: { id: item.id },
        data: { status: "undone", message: "Import effects undone." },
      });
    }
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: "UNDONE" },
    });
    revalidatePath("/imports");
    revalidatePath("/inventory");
    redirect(buildImportReviewUrl(batch.id, getReturnReviewOptions(fd)));
  }

  async function confirmImport(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionScope = await getAccessScope(
      actionUserWithPlayer ?? actionUser,
    );
    const actionIsAdmin = actionScope?.mode === "admin";
    const batchId = String(fd.get("batchId"));
    const batch = await prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });
    if (!batch) throw new Error("Import batch not found.");
    if (
      !actionIsAdmin &&
      batch.selectedPlayerId !== actionUserWithPlayer?.playerId
    )
      throw new Error("Not authorized for this import batch.");
    const duplicateBehavior = batch.importType.split(":")[1] || "add";
    if (duplicateBehavior === "preview")
      throw new Error(
        "This batch was created as preview only. Upload again with an import duplicate behavior to commit it.",
      );
    const defaultLocationIdRaw = String(fd.get("destinationLocationId") || "");
    const defaultLocation = defaultLocationIdRaw
      ? await prisma.inventoryLocation.findFirst({
          where: {
            id: defaultLocationIdRaw,
            ownerPlayerId: batch.selectedPlayerId,
            active: true,
            kind: InventoryLocationKind.NORMAL,
            systemManaged: false,
          },
        })
      : await ensureDefaultLocation(prisma, batch.selectedPlayerId);
    if (!defaultLocation)
      throw new Error("Choose a destination location before committing.");

    const readyItems = batch.items.filter(isImportItemReadyToCommit);
    if (!readyItems.length)
      throw new Error("No resolved cards are ready to commit.");

    let committedRows = 0,
      errorRows = 0;
    for (const item of readyItems) {
      const lockedItem = await prisma.importBatchItem.findUnique({
        where: { id: item.id },
      });
      if (!lockedItem || !isImportItemReadyToCommit(lockedItem)) continue;
      const card = await prisma.card.findUnique({
        where: { id: lockedItem.cardPrintingId! },
      });
      if (!card) {
        await prisma.importBatchItem.update({
          where: { id: lockedItem.id },
          data: {
            status: "error",
            message: "Selected card printing no longer exists.",
          },
        });
        errorRows++;
        continue;
      }
      const parsedRow = lockedItem.parsedRowJson as ParsedRow;
      const quantity = Number(parsedRow.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        await prisma.importBatchItem.update({
          where: { id: lockedItem.id },
          data: {
            status: "error",
            message: "Quantity must be a positive integer.",
          },
        });
        errorRows++;
        continue;
      }
      const foilStatus = (lockedItem.parsedFoilStatus ||
        parsedRow.foilStatus ||
        "NONFOIL") as FoilStatus;
      const condition = normalizeInventoryCondition(
        lockedItem.parsedCondition || parsedRow.condition,
      );
      const rowLocation = parsedRow.locationName
        ? await prisma.inventoryLocation.findFirst({
            where: {
              ownerPlayerId: batch.selectedPlayerId,
              normalizedName: normalizeLocationName(parsedRow.locationName),
              active: true,
              kind: InventoryLocationKind.NORMAL,
              systemManaged: false,
            },
          })
        : null;
      const locationId = rowLocation?.id ?? defaultLocation.id;
      const matchingWhere = {
        currentOwnerId: batch.selectedPlayerId,
        originalOpenerId: batch.selectedPlayerId,
        cardId: lockedItem.cardPrintingId!,
        foil: foilStatus !== FoilStatus.NONFOIL,
        foilStatus,
        condition,
        language: parsedRow.language || "EN",
        locationId,
        quantity: { gt: 0 },
      };
      const createData = {
        currentOwnerId: batch.selectedPlayerId,
        originalOpenerId: batch.selectedPlayerId,
        cardId: lockedItem.cardPrintingId!,
        quantity,
        foil: foilStatus !== FoilStatus.NONFOIL,
        foilStatus,
        condition,
        acquiredFromPullId: null,
        notes: parsedRow.notes || null,
        sourceType: InventorySourceType.CSV_PULL_IMPORT,
        language: parsedRow.language || "EN",
        locationId,
      };
      const existingInventory =
        duplicateBehavior === "separate"
          ? null
          : await prisma.inventoryItem.findFirst({ where: matchingWhere });
      const beforeQuantity = existingInventory?.quantity ?? 0;
      const inventory = existingInventory
        ? await prisma.inventoryItem.update({
            where: { id: existingInventory.id },
            data: {
              quantity: { increment: quantity },
              notes: parsedRow.notes || undefined,
              sourceType: InventorySourceType.CSV_PULL_IMPORT,
            },
          })
        : await prisma.inventoryItem.create({ data: createData });
      await prisma.importBatchItem.update({
        where: { id: lockedItem.id },
        data: {
          status: "imported",
          inventoryItemId: inventory.id,
          pullId: null,
          quantityImported: quantity,
          duplicateBehaviorUsed: duplicateBehavior,
          createdNewInventoryItem: !existingInventory,
          updatedExistingInventoryItem: Boolean(existingInventory),
          beforeQuantity,
          afterQuantity: inventory.quantity,
          message: `Committed ${quantity} card${quantity === 1 ? "" : "s"} to inventory.`,
        },
      });
      committedRows++;
    }
    const remainingItems = await prisma.importBatchItem.findMany({
      where: { importBatchId: batch.id },
    });
    const remainingSummary = getImportReviewSummary(remainingItems);
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status:
          errorRows > 0
            ? "IMPORTED_WITH_ERRORS"
            : remainingSummary.readyToCommit > 0
              ? "PARTIALLY_IMPORTED"
              : remainingSummary.needsReview + remainingSummary.unresolved > 0
                ? "IMPORTED_WITH_REVIEW"
                : "IMPORTED",
        skippedRows: remainingSummary.skipped,
        matchedRows: remainingSummary.committed,
        warningRows: remainingSummary.warnings,
        errorRows:
          remainingSummary.failed +
          remainingSummary.needsReview +
          remainingSummary.unresolved,
      },
    });
    revalidatePath("/imports");
    revalidatePath("/inventory");
    redirect(buildImportReviewUrl(batch.id, getReturnReviewOptions(fd)));
  }

  const selectedBatch = params.batchId
    ? await prisma.importBatch.findUnique({
        where: { id: params.batchId },
        include: {
          selectedPlayer: true,
          resolutionJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          items: {
            include: {
              cardPrinting: true,
              resolutionAttempts: {
                orderBy: { attemptedAt: "desc" },
                take: 10,
              },
            },
            orderBy: { rowNumber: "asc" },
          },
        },
      })
    : null;
  if (
    selectedBatch &&
    !isAdmin &&
    selectedBatch.selectedPlayerId !== userWithPlayer?.playerId
  )
    redirect("/imports");
  const historyWhere = isAdmin
    ? {}
    : { selectedPlayerId: userWithPlayer?.playerId ?? "__none__" };
  const history = await prisma.importBatch.findMany({
    where: historyWhere,
    include: {
      selectedPlayer: true,
      items: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  const latestImportedBatch = history.find((batch) =>
    ["IMPORTED", "imported"].includes(batch.status),
  );

  const selectedItems = selectedBatch?.items ?? [];
  const activeReviewFilter = normalizeImportReviewFilter(params.status);
  const reviewSearch = String(params.q || "").trim();
  const filteredItems = filterImportReviewItems(
    selectedItems,
    activeReviewFilter,
    reviewSearch,
  );
  const manualDefaultLocation = userWithPlayer?.playerId
    ? await ensureDefaultLocation(prisma, userWithPlayer.playerId)
    : null;
  const manualLocations = userWithPlayer?.playerId
    ? (await getLocationsForOwner(prisma, userWithPlayer.playerId)).filter(
        (location) =>
          location.active &&
          location.kind === InventoryLocationKind.NORMAL &&
          !location.systemManaged,
      )
    : [];
  const exportOwnerIds = isAdmin
    ? players.map((player) => player.id)
    : userWithPlayer?.playerId
      ? [userWithPlayer.playerId]
      : [];
  const exportLocations = exportOwnerIds.length
    ? await prisma.inventoryLocation.findMany({
        where: {
          ownerPlayerId: { in: exportOwnerIds },
          active: true,
          kind: InventoryLocationKind.NORMAL,
          systemManaged: false,
        },
        select: {
          id: true,
          name: true,
          ownerPlayerId: true,
        },
        orderBy: [{ ownerPlayerId: "asc" }, { name: "asc" }],
      })
    : [];
  const exportOwners = (
    isAdmin
      ? players
      : players.filter((player) => player.id === userWithPlayer?.playerId)
  ).map((player) => ({
    id: player.id,
    name: player.displayName,
    locations: exportLocations
      .filter((location) => location.ownerPlayerId === player.id)
      .map((location) => ({ id: location.id, name: location.name })),
  }));
  const requestedExportOwnerId = String(params.ownerId || "");
  const initialExportOwnerId = exportOwners.some(
    (owner) => owner.id === requestedExportOwnerId,
  )
    ? requestedExportOwnerId
    : (defaultPlayer?.id ?? exportOwners[0]?.id ?? "");
  const requestedExportLocationId = Array.isArray(params.locationId)
    ? String(params.locationId[0] || "")
    : String(params.locationId || "");
  const locationsForSelectedOwner = selectedBatch
    ? (
        await getLocationsForOwner(prisma, selectedBatch.selectedPlayerId)
      ).filter(
        (location) =>
          location.active &&
          location.kind === InventoryLocationKind.NORMAL &&
          !location.systemManaged,
      )
    : [];
  const summary = getImportReviewSummary(selectedItems);
  const filterCounts = {
    all: selectedItems.length,
    resolved: filterImportReviewItems(selectedItems, "resolved").length,
    "needs-review": filterImportReviewItems(selectedItems, "needs-review")
      .length,
    unresolved: filterImportReviewItems(selectedItems, "unresolved").length,
    failed: filterImportReviewItems(selectedItems, "failed").length,
    skipped: filterImportReviewItems(selectedItems, "skipped").length,
    committed: filterImportReviewItems(selectedItems, "committed").length,
  };
  const unresolvedCount =
    summary.needsReview + summary.unresolved + summary.failed;
  const firstProblemItem = selectedItems.find((item) =>
    ["needs-review", "unresolved", "failed"].includes(
      getImportReviewBucket(item),
    ),
  );
  const resolverItem = params.resolveItemId
    ? selectedItems.find((item) => item.id === params.resolveItemId)
    : null;
  const resolverParsed = resolverItem?.parsedRowJson as ParsedRow | undefined;
  const resolverQuery = resolverParsed
    ? buildResolverQuery(resolverParsed, params.resolverQ)
    : "";
  const resolverSearch =
    resolverItem && resolverQuery
      ? await searchLocalThenScryfallCards(resolverQuery)
      : { cards: [], message: "" };
  const resolverResults = resolverSearch.cards;
  const maintenanceSummary = isAdmin
    ? {
        previewFailed: await prisma.importBatch.count({
          where: {
            status: {
              in: [
                "PREVIEW",
                "FAILED",
                "CANCELLED",
                "preview",
                "failed",
                "cancelled",
              ],
            },
          },
        }),
        totalBatches: await prisma.importBatch.count(),
        unresolvedItems: await prisma.importBatchItem.count({
          where: {
            status: {
              in: ["unmatched", "ambiguous", "error", "suggested_match"],
            },
          },
        }),
      }
    : null;
  const undoPreview = selectedBatch
    ? {
        totalItems: selectedItems.length,
        legacySourceRecords: selectedItems.filter((item) =>
          Boolean(item.pullId),
        ).length,
        inventoryDeletes: selectedItems.filter(
          (item) =>
            item.status === "imported" &&
            item.createdNewInventoryItem &&
            item.beforeQuantity === 0 &&
            item.inventoryItemId,
        ).length,
        quantityReductions: selectedItems.filter(
          (item) =>
            item.status === "imported" &&
            item.updatedExistingInventoryItem &&
            item.inventoryItemId,
        ).length,
        cannotUndo: selectedItems.filter(
          (item) =>
            item.status === "imported" &&
            (!item.quantityImported ||
              item.beforeQuantity === null ||
              item.beforeQuantity === undefined ||
              item.afterQuantity === null ||
              item.afterQuantity === undefined),
        ).length,
      }
    : null;
  const selectedProgress = selectedBatch
    ? calculateImportProgress({
        batchStatus: selectedBatch.status,
        itemStatuses: selectedItems.map((item) => item.status),
      })
    : null;
  const selectedResolutionJob = selectedBatch?.resolutionJobs?.[0] ?? null;
  const selectedResolutionJobSnapshot = serializeImportResolutionJob(
    selectedResolutionJob,
  );
  const importResolutionConfig = getImportResolutionJobConfig();
  const canCommitSelectedBatch = Boolean(
    selectedBatch &&
    selectedBatch.status === "PREVIEW" &&
    !selectedBatch.importType.endsWith(":preview") &&
    summary.readyToCommit > 0,
  );
  const commitBlockedReason = selectedBatch?.importType.endsWith(":preview")
    ? "This batch is preview only. Upload again with an import behavior to commit records."
    : selectedBatch && ["IMPORTED", "UNDONE"].includes(selectedBatch.status)
      ? "This import has already been committed or closed."
      : summary.readyToCommit <= 0
        ? "No cards are ready to commit."
        : unresolvedCount > 0
          ? `${unresolvedCount} rows still need review. You can commit ${summary.readyToCommit} ready rows now or resolve remaining rows first.`
          : "Ready to commit.";
  const defaultDestinationLocation = locationsForSelectedOwner[0];
  const inventoryLink = defaultDestinationLocation
    ? `/inventory?locationId=${defaultDestinationLocation.id}`
    : "/inventory";

  return (
    <main className="p-8 space-y-6">
      <Nav />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Imports</h1>
          <p className="text-sm text-[var(--app-muted)]">
            Upload inventory CSVs, review unresolved rows, and commit ready
            cards from one workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedBatch ? (
            <a className={filterButtonClass} href="#import-review">
              Current import
            </a>
          ) : null}
          <a className={filterButtonClass} href="/api/imports/sample">
            Sample CSV
          </a>
        </div>
      </div>
      <CollapsiblePanel
        title="Add single card"
        summary="Manual one-off inventory entry"
        defaultOpen={params.singleCardAdded === "1"}
        storageKey="imports-single-card-add"
      >
        <SingleCardInventoryAdd
          locations={manualLocations.map((location) => ({
            id: location.id,
            name: location.name,
          }))}
          defaultLocationId={manualDefaultLocation?.id}
          added={params.singleCardAdded === "1"}
          embedded
        />
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Export Inventory"
        summary="Download CSV exports"
        defaultOpen={params.exportTools === "1"}
      >
        <InventoryExportForm
          owners={exportOwners}
          initialOwnerId={initialExportOwnerId}
          initialLocationId={requestedExportLocationId}
          adminMode={isAdmin}
        />
      </CollapsiblePanel>

      <section className={cn(filterPanelClass, "space-y-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">New CSV import</h2>
            <p className="text-sm text-[var(--app-muted)]">
              MTG Inventory sample files and Moxfield collection exports are
              supported.
            </p>
          </div>
          <span className="rounded-md border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-2 text-xs text-[var(--app-muted)]">
            {isAdmin
              ? "Admin mode: choose target owner"
              : defaultPlayer
                ? `Importing for ${defaultPlayer.displayName}`
                : "Importing into your inventory"}
          </span>
        </div>
        <form
          action={previewImport}
          className="grid gap-3 lg:grid-cols-[minmax(180px,0.8fr)_minmax(220px,1fr)_minmax(220px,1.1fr)_auto] lg:items-end"
          encType="multipart/form-data"
        >
          {isAdmin ? (
            <>
              <label className={filterFieldClass}>
                Current owner
                <select
                  name="selectedPlayerId"
                  defaultValue={defaultPlayer?.id}
                  className={cn(filterSelectClass, "mt-1 w-full")}
                >
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <input
                type="hidden"
                name="selectedPlayerId"
                value={defaultPlayer?.id ?? ""}
              />
            </>
          )}
          <label className={filterFieldClass}>
            Duplicate behavior
            <select
              name="duplicateBehavior"
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              <option value="add">
                Add quantities to existing matching inventory item
              </option>
              <option value="separate">
                Create separate inventory rows where possible
              </option>
              <option value="preview">Preview only</option>
            </select>
          </label>
          <label className={filterFieldClass}>
            CSV file
            <input
              name="csvFile"
              type="file"
              accept=".csv,text/csv"
              required
              className={cn(filterInputClass, "mt-1 w-full")}
            />
          </label>
          <SubmitButton
            pendingLabel="Identifying cards…"
            className={cn(filterPrimaryButtonClass, "lg:min-w-36")}
          >
            Preview Import
          </SubmitButton>
        </form>
        <div className="border-t border-[var(--app-border)] pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Recent imports</h3>
            <a className="text-xs underline" href="#import-history">
              Full history
            </a>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {history.slice(0, 6).map((batch) => (
              <a
                key={batch.id}
                className={cn(
                  "rounded-md border p-3 text-sm transition-colors",
                  selectedBatch?.id === batch.id
                    ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]"
                    : "border-[var(--app-border)] bg-[var(--app-surface)] hover:border-[var(--app-border-strong)]",
                )}
                href={`${buildImportReviewUrl(batch.id)}#import-review`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="block truncate font-medium">
                    {batch.filename}
                  </span>
                  <span className="rounded border border-[var(--app-border)] px-2 py-0.5 text-[10px] uppercase text-[var(--app-muted)]">
                    {batch.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--app-muted)]">
                  {batch.createdAt.toLocaleString()} -{" "}
                  {batch.selectedPlayer.displayName}
                </div>
                <div className="mt-1 text-xs text-[var(--app-muted)]">
                  {batch.totalRows} rows - {batch.errorRows} need review
                </div>
              </a>
            ))}
            {history.length === 0 ? (
              <p className="rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-3 text-sm text-[var(--app-muted)]">
                No imports yet. Upload a CSV to start a review batch.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {isAdmin && maintenanceSummary ? (
        <section className="border border-zinc-800 rounded p-4 space-y-3">
          <h2 className="text-xl font-semibold">Import Maintenance</h2>
          <div className="grid md:grid-cols-3 gap-2 text-sm">
            <div className="border border-zinc-700 rounded p-2">
              <div className="text-zinc-400">Preview / failed imports</div>
              <div className="text-2xl font-bold">
                {maintenanceSummary.previewFailed}
              </div>
            </div>
            <div className="border border-zinc-700 rounded p-2">
              <div className="text-zinc-400">Total import batches</div>
              <div className="text-2xl font-bold">
                {maintenanceSummary.totalBatches}
              </div>
            </div>
            <div className="border border-zinc-700 rounded p-2">
              <div className="text-zinc-400">Unresolved rows</div>
              <div className="text-2xl font-bold">
                {maintenanceSummary.unresolvedItems}
              </div>
            </div>
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
            {latestImportedBatch ? (
              <details className="border border-red-800 rounded p-3">
                <summary className="cursor-pointer font-semibold">
                  Undo most recent import
                </summary>
                <p className="my-2 text-zinc-400">
                  Reverses tracked inventory changes from{" "}
                  <strong>{latestImportedBatch.filename}</strong>. This is for
                  the newest committed import only.
                </p>
                <form action={undoImportBatch} className="space-y-2">
                  <input
                    type="hidden"
                    name="batchId"
                    value={latestImportedBatch.id}
                  />
                  <label className="block">
                    Type DELETE IMPORT
                    <input
                      name="confirmation"
                      className="mt-1 w-full border p-2 bg-zinc-900"
                    />
                  </label>
                  <SubmitButton
                    pendingLabel="Undoing importâ€¦"
                    className="border border-red-700 px-3 py-2"
                  >
                    Undo latest import
                  </SubmitButton>
                </form>
              </details>
            ) : null}
            <details className="border border-amber-800 rounded p-3">
              <summary className="cursor-pointer font-semibold">
                Clear preview / failed imports
              </summary>
              <p className="my-2 text-zinc-400">
                Deletes PREVIEW, FAILED, and CANCELLED import batches and their
                row history only. Inventory is not touched.
              </p>
              <form action={purgePreviewFailedImports}>
                <SubmitButton
                  pendingLabel="Clearing…"
                  className="border border-amber-600 px-3 py-2"
                >
                  Confirm clear preview / failed
                </SubmitButton>
              </form>
            </details>
            <details className="border border-red-800 rounded p-3">
              <summary className="cursor-pointer font-semibold">
                Clear all import history
              </summary>
              <p className="my-2 text-zinc-400">
                Deletes all ImportBatch and ImportBatchItem history. Inventory
                is not touched.
              </p>
              <form action={deleteImportHistory}>
                <SubmitButton
                  pendingLabel="Deleting history…"
                  className="border border-red-700 px-3 py-2"
                >
                  Confirm delete history
                </SubmitButton>
              </form>
            </details>
            <form
              action={retryUnresolvedRows}
              className="border border-zinc-700 rounded p-3 space-y-2"
            >
              <input type="hidden" name="scope" value="all" />
              <div className="font-semibold">Retry all unresolved rows</div>
              <p className="text-zinc-400">
                Admin-only retry across every batch.
              </p>
              <SubmitButton
                pendingLabel="Retrying rows…"
                name="mode"
                value="normal_retry"
                className="border px-3 py-2 mr-2"
              >
                Retry unresolved rows
              </SubmitButton>
              <SubmitButton
                pendingLabel="Deep resolving…"
                name="mode"
                value="deep_resolve"
                className="border px-3 py-2"
              >
                Deep resolve unresolved rows
              </SubmitButton>
            </form>
          </div>
        </section>
      ) : null}

      {!isAdmin && history.length ? (
        <section className={cn(filterPanelClass, "space-y-3")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Import history tools</h2>
              <p className="text-sm text-[var(--app-muted)]">
                Clear your own import batch history. Inventory records are not
                changed.
              </p>
            </div>
            <form action={deleteImportHistory}>
              <SubmitButton
                pendingLabel="Clearing historyâ€¦"
                className="border border-red-700 px-3 py-2"
              >
                Clear my import history
              </SubmitButton>
            </form>
          </div>
        </section>
      ) : null}

      {selectedBatch ? (
        <section
          id="import-review"
          className={cn(filterPanelClass, "scroll-mt-4 space-y-4")}
        >
          <div>
            <h2 className="text-xl font-semibold">
              Preview: {selectedBatch.filename}
            </h2>
            <p className="text-sm text-zinc-400">
              Owner: {selectedBatch.selectedPlayer.displayName} • Import batch:{" "}
              {selectedBatch.id} • Status: {selectedBatch.status}
            </p>
          </div>
          {selectedProgress ? (
            <ImportProgressPanel
              batchId={selectedBatch.id}
              initialProgress={selectedProgress}
              initialResolutionJob={selectedResolutionJobSnapshot}
              pollIntervalMs={importResolutionConfig.pollIntervalMs}
            />
          ) : null}
          <div className="sticky top-2 z-30 rounded-lg border border-[var(--app-border-strong)] bg-[color-mix(in_srgb,var(--app-surface)_94%,transparent)] p-3 shadow-xl shadow-[var(--app-shadow)] backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{selectedBatch.filename}</div>
                <p className="text-sm text-zinc-400">
                  Destination owner: {selectedBatch.selectedPlayer.displayName}
                  {defaultDestinationLocation
                    ? ` • Destination: ${defaultDestinationLocation.name}`
                    : ""}
                </p>
                <p className="text-sm text-zinc-300">
                  {summary.parsedLines} parsed lines · {summary.totalCards}{" "}
                  total cards · {summary.resolved} resolved ·{" "}
                  {summary.needsReview + summary.unresolved + summary.failed}{" "}
                  need review · {summary.readyToCommit} ready to commit ·{" "}
                  {summary.committed} already committed
                </p>
                {!canCommitSelectedBatch ? (
                  <p className="text-xs text-amber-300">
                    {commitBlockedReason}
                  </p>
                ) : unresolvedCount > 0 ? (
                  <p className="text-xs text-amber-300">
                    {commitBlockedReason}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <form action={startImportResolutionJob}>
                  <input
                    type="hidden"
                    name="batchId"
                    value={selectedBatch.id}
                  />
                  <input
                    type="hidden"
                    name="returnStatus"
                    value={activeReviewFilter}
                  />
                  <input type="hidden" name="returnQ" value={reviewSearch} />
                  <SubmitButton
                    pendingLabel="Starting resolution…"
                    disabled={Boolean(
                      selectedResolutionJob &&
                      isActiveImportResolutionStatus(
                        selectedResolutionJob.status,
                      ),
                    )}
                    className={filterButtonClass}
                  >
                    {selectedResolutionJob &&
                    ["FAILED", "STALE"].includes(selectedResolutionJob.status)
                      ? "Resume Resolution"
                      : selectedResolutionJob?.status ===
                          "COMPLETED_WITH_REVIEW"
                        ? "Resolve Remaining"
                        : "Resolve Cards"}
                  </SubmitButton>
                </form>
                {selectedResolutionJob &&
                isActiveImportResolutionStatus(selectedResolutionJob.status) ? (
                  <form action={cancelResolutionJobAction}>
                    <input
                      type="hidden"
                      name="jobId"
                      value={selectedResolutionJob.id}
                    />
                    <SubmitButton
                      pendingLabel="Cancellingâ€¦"
                      className="rounded-md border border-red-700 bg-red-950/30 px-3 py-2 text-sm text-red-100 transition-colors hover:border-red-500 disabled:opacity-50"
                    >
                      Cancel Resolution
                    </SubmitButton>
                  </form>
                ) : null}
                {firstProblemItem ? (
                  <a
                    className={filterButtonClass}
                    href={buildImportReviewUrl(selectedBatch.id, {
                      status: "unresolved",
                      q: reviewSearch,
                      resolveItemId: firstProblemItem.id,
                    })}
                  >
                    Review Unresolved
                  </a>
                ) : null}
                {!["IMPORTED", "UNDONE"].includes(selectedBatch.status) &&
                !selectedBatch.importType.endsWith(":preview") ? (
                  <form
                    action={confirmImport}
                    className="flex gap-2 items-center"
                  >
                    <input
                      type="hidden"
                      name="batchId"
                      value={selectedBatch.id}
                    />
                    <input
                      type="hidden"
                      name="returnStatus"
                      value={activeReviewFilter}
                    />
                    <input type="hidden" name="returnQ" value={reviewSearch} />
                    <select
                      name="destinationLocationId"
                      className={filterSelectClass}
                      aria-label="Destination location"
                    >
                      {locationsForSelectedOwner.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                    <SubmitButton
                      pendingLabel="Committing import…"
                      disabled={!canCommitSelectedBatch}
                      confirmMessage={
                        summary.readyToCommit >= 100
                          ? `Commit ${summary.readyToCommit} ready rows to {selection}?`
                          : undefined
                      }
                      confirmSelectionName="destinationLocationId"
                      className="rounded-md border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100 transition-colors hover:border-emerald-500 disabled:opacity-50"
                    >
                      {unresolvedCount > 0
                        ? "Commit Ready Cards"
                        : "Commit Import"}
                    </SubmitButton>
                  </form>
                ) : selectedBatch.status.includes("IMPORTED") ? (
                  <a
                    className="rounded-md border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100"
                    href={inventoryLink}
                  >
                    View Inventory
                  </a>
                ) : null}
                <a className={filterButtonClass} href="/imports">
                  Cancel
                </a>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <form action={startImportResolutionJob}>
              <input type="hidden" name="batchId" value={selectedBatch.id} />
              <SubmitButton
                pendingLabel="Starting resolution…"
                disabled={Boolean(
                  selectedResolutionJob &&
                  isActiveImportResolutionStatus(selectedResolutionJob.status),
                )}
                className="border px-3 py-2 disabled:opacity-50"
              >
                {selectedResolutionJob &&
                ["FAILED", "STALE"].includes(selectedResolutionJob.status)
                  ? "Resume Resolution"
                  : selectedResolutionJob?.status === "COMPLETED_WITH_REVIEW"
                    ? "Resolve Remaining"
                    : "Resolve Import"}
              </SubmitButton>
            </form>
            {selectedResolutionJob &&
            isActiveImportResolutionStatus(selectedResolutionJob.status) ? (
              <form action={cancelResolutionJobAction}>
                <input
                  type="hidden"
                  name="jobId"
                  value={selectedResolutionJob.id}
                />
                <SubmitButton
                  pendingLabel="Cancelling…"
                  className="border border-red-700 px-3 py-2 text-red-200"
                >
                  Cancel Resolution
                </SubmitButton>
              </form>
            ) : null}
            {unresolvedCount > 0 ? (
              <a
                className="border px-3 py-2"
                href={`/imports?batchId=${selectedBatch.id}&resolveItemId=${
                  selectedItems.find(
                    (item) =>
                      !item.cardPrintingId &&
                      ["ambiguous", "unmatched", "error"].includes(item.status),
                  )?.id ?? ""
                }`}
              >
                Review Unmatched Cards
              </a>
            ) : null}
            {isAdmin ? (
              <details className="border border-zinc-700 rounded px-3 py-2">
                <summary className="cursor-pointer">Batch maintenance</summary>
                <div className="mt-3 space-y-3">
                  <form action={deleteImportHistory}>
                    <input
                      type="hidden"
                      name="batchId"
                      value={selectedBatch.id}
                    />
                    <SubmitButton
                      pendingLabel="Deleting history…"
                      className="border px-3 py-2"
                    >
                      Delete history only
                    </SubmitButton>
                  </form>
                  {undoPreview ? (
                    <div className="border border-red-800 rounded p-3 space-y-2">
                      <p className="font-semibold">
                        Undo preview for {selectedBatch.filename}
                      </p>
                      <p>
                        Total items: {undoPreview.totalItems} • Legacy source
                        records to delete: {undoPreview.legacySourceRecords} •
                        Inventory deletes: {undoPreview.inventoryDeletes} •
                        Quantity reductions: {undoPreview.quantityReductions} •
                        Cannot undo: {undoPreview.cannotUndo}
                      </p>
                      {undoPreview.cannotUndo ? (
                        <p className="text-amber-300">
                          Some rows cannot be automatically undone because they
                          lack undo tracking.
                        </p>
                      ) : null}
                      <form action={undoImportBatch} className="space-y-2">
                        <input
                          type="hidden"
                          name="batchId"
                          value={selectedBatch.id}
                        />
                        <label className="block">
                          Type DELETE IMPORT
                          <input
                            name="confirmation"
                            className="ml-2 border p-1 bg-zinc-900"
                          />
                        </label>
                        <SubmitButton
                          pendingLabel="Undoing import…"
                          className="border border-red-700 px-3 py-2"
                        >
                          Undo import and delete created records
                        </SubmitButton>
                      </form>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-2 text-sm">
            {[
              ["Parsed lines", summary.parsedLines, "border-zinc-700"],
              ["Ready to commit", summary.readyToCommit, "border-emerald-700"],
              ["Resolved", summary.resolved, "border-emerald-700"],
              ["Needs review", summary.needsReview, "border-amber-700"],
              ["Unresolved", summary.unresolved, "border-red-800"],
              ["Failed", summary.failed, "border-red-900"],
              ["Skipped", summary.skipped, "border-zinc-600"],
              ["Committed", summary.committed, "border-emerald-800"],
              ["Warnings", summary.warnings, "border-yellow-700"],
            ].map(([label, value, border]) => (
              <div
                key={String(label)}
                className={`rounded border ${border} bg-zinc-950 p-2`}
              >
                <div className="text-zinc-400">{label}</div>
                <div className="text-2xl font-bold">{value}</div>
              </div>
            ))}
          </div>
          <div className="h-3 overflow-hidden rounded bg-zinc-900 flex">
            {summary.parsedLines
              ? [
                  ["bg-emerald-600", summary.resolved],
                  ["bg-amber-600", summary.needsReview],
                  ["bg-red-700", summary.unresolved + summary.failed],
                  ["bg-zinc-600", summary.skipped],
                  ["bg-emerald-800", summary.committed],
                ].map(([cls, count], index) => (
                  <div
                    key={index}
                    className={String(cls)}
                    style={{
                      width: `${(Number(count) / summary.parsedLines) * 100}%`,
                    }}
                  />
                ))
              : null}
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950 p-3 space-y-3">
            <form method="get" className="flex flex-wrap gap-2 items-end">
              <input type="hidden" name="batchId" value={selectedBatch.id} />
              <input type="hidden" name="status" value={activeReviewFilter} />
              <label className="flex-1 min-w-64 text-sm">
                Search import rows
                <input
                  name="q"
                  defaultValue={reviewSearch}
                  placeholder="Card, raw row, set, collector #, error, location…"
                  className="mt-1 w-full border p-2 bg-zinc-900"
                />
              </label>
              <button className="border px-3 py-2">Search</button>
              {reviewSearch ? (
                <a
                  className="border px-3 py-2"
                  href={buildImportReviewUrl(selectedBatch.id, {
                    status: activeReviewFilter,
                  })}
                >
                  Clear search
                </a>
              ) : null}
            </form>
            <div
              className="flex flex-wrap gap-2 text-sm"
              aria-label="Import row status filters"
            >
              {importReviewFilters.map((filter) => {
                const count = filterCounts[filter.key];
                const active = activeReviewFilter === filter.key;
                return (
                  <a
                    key={filter.key}
                    className={`rounded border px-3 py-2 ${
                      active
                        ? "border-sky-500 bg-sky-950 text-sky-100"
                        : "border-zinc-700 text-zinc-200"
                    }`}
                    href={buildImportReviewUrl(selectedBatch.id, {
                      status: filter.key,
                      q: reviewSearch,
                    })}
                  >
                    {filter.label} {count}
                  </a>
                );
              })}
              <a
                className="rounded border border-amber-600 px-3 py-2 text-amber-100"
                href={buildImportReviewUrl(selectedBatch.id, {
                  status: "unresolved",
                  q: reviewSearch,
                })}
              >
                Needs review / unresolved only
              </a>
            </div>
            <p className="text-sm text-zinc-400">
              Showing {filteredItems.length} of {selectedItems.length} parsed
              rows.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th>Row</th>
                  <th>Qty</th>
                  <th>Imported Name</th>
                  <th>Image</th>
                  <th>Matched Card</th>
                  <th>Set</th>
                  <th>#</th>
                  <th>Foil Raw</th>
                  <th>Foil Status</th>
                  <th>Condition</th>
                  <th>Language</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Message</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const parsed = item.parsedRowJson as ParsedRow;
                  const img = cardImage(item.cardPrinting);
                  const actionLabel =
                    item.status === "ambiguous"
                      ? "Choose Match"
                      : item.cardPrintingId
                        ? "Change Match"
                        : "Resolve";
                  return (
                    <tr
                      key={item.id}
                      className="border-b border-zinc-900 align-top"
                    >
                      <td>{item.rowNumber}</td>
                      <td>{parsed.quantity}</td>
                      <td>{parsed.name}</td>
                      <td>
                        {img ? (
                          <img src={img} alt="" className="h-16 rounded" />
                        ) : (
                          <div className="h-16 w-12 rounded border border-zinc-700 text-[10px] flex items-center justify-center text-zinc-500">
                            No image
                          </div>
                        )}
                      </td>
                      <td>{item.cardPrinting?.name ?? "—"}</td>
                      <td>
                        {item.cardPrinting?.setCode?.toUpperCase() ??
                          parsed.setCode?.toUpperCase() ??
                          "—"}
                      </td>
                      <td>
                        {item.cardPrinting?.collectorNumber ??
                          parsed.collectorNumber ??
                          "—"}
                      </td>
                      <td>{parsed.foilRaw ?? ""}</td>
                      <td>{item.parsedFoilStatus}</td>
                      <td>{item.parsedCondition}</td>
                      <td>{parsed.language}</td>
                      <td>{parsed.locationName || "—"}</td>
                      <td>
                        <span
                          className={`inline-block rounded border px-2 py-1 text-xs ${statusBadgeClass(item.status)}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="max-w-xs">
                        {item.message ?? parsed.warning ?? ""}
                      </td>
                      <td className="space-y-1">
                        <a
                          className="block underline"
                          href={buildImportReviewUrl(selectedBatch.id, {
                            status: activeReviewFilter,
                            q: reviewSearch,
                            resolveItemId: item.id,
                          })}
                        >
                          {actionLabel}
                        </a>
                        <form action={retryUnresolvedRows}>
                          <input
                            type="hidden"
                            name="batchId"
                            value={selectedBatch.id}
                          />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input
                            type="hidden"
                            name="returnStatus"
                            value={activeReviewFilter}
                          />
                          <input
                            type="hidden"
                            name="returnQ"
                            value={reviewSearch}
                          />
                          <SubmitButton
                            pendingLabel="Retrying…"
                            name="mode"
                            value="normal_retry"
                            className="underline"
                            minWidthClassName="min-w-20"
                          >
                            Retry row
                          </SubmitButton>
                        </form>
                        <form action={setRowSkipped}>
                          {item.status === "skipped" ? (
                            <>
                              <input
                                type="hidden"
                                name="itemId"
                                value={item.id}
                              />
                              <input
                                type="hidden"
                                name="returnStatus"
                                value={activeReviewFilter}
                              />
                              <input
                                type="hidden"
                                name="returnQ"
                                value={reviewSearch}
                              />
                              <input type="hidden" name="unskip" value="true" />
                              <SubmitButton
                                pendingLabel="Restoring…"
                                className="underline"
                                minWidthClassName="min-w-16"
                              >
                                Unskip
                              </SubmitButton>
                            </>
                          ) : (
                            <>
                              <input
                                type="hidden"
                                name="itemId"
                                value={item.id}
                              />
                              <input
                                type="hidden"
                                name="returnStatus"
                                value={activeReviewFilter}
                              />
                              <input
                                type="hidden"
                                name="returnQ"
                                value={reviewSearch}
                              />
                              <SubmitButton
                                pendingLabel="Skipping…"
                                className="underline"
                                minWidthClassName="min-w-16"
                              >
                                Skip
                              </SubmitButton>
                            </>
                          )}
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {unresolvedCount > 0 ? (
            <p className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-100">
              {commitBlockedReason}
            </p>
          ) : null}
          {!["IMPORTED", "UNDONE"].includes(selectedBatch.status) &&
          !selectedBatch.importType.endsWith(":preview") ? (
            <form action={confirmImport} className="hidden" aria-hidden="true">
              <input type="hidden" name="batchId" value={selectedBatch.id} />
              <input
                type="hidden"
                name="returnStatus"
                value={activeReviewFilter}
              />
              <input type="hidden" name="returnQ" value={reviewSearch} />
              <label className="text-sm">
                Destination location
                <select
                  name="destinationLocationId"
                  className="block border p-2 bg-zinc-900"
                >
                  {locationsForSelectedOwner.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton
                pendingLabel="Committing import…"
                disabled={!canCommitSelectedBatch}
                confirmMessage={
                  summary.readyToCommit >= 100
                    ? `Commit ${summary.readyToCommit} ready rows to inventory?`
                    : undefined
                }
                className="border border-emerald-700 px-3 py-2 disabled:opacity-50"
              >
                {unresolvedCount > 0 ? "Commit Ready Cards" : "Commit Import"}
              </SubmitButton>
            </form>
          ) : null}
          {selectedBatch.importType.endsWith(":preview") ? (
            <p className="text-sm text-amber-300">
              This batch is preview only. Upload it again with an import
              behavior to commit records.
            </p>
          ) : null}
        </section>
      ) : null}

      {resolverItem && resolverParsed && selectedBatch ? (
        <section className="fixed inset-0 z-50 bg-black/60">
          <div className="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto bg-zinc-950 border-l border-zinc-800 p-4 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  Resolve Row {resolverItem.rowNumber}
                </h2>
                <p className="text-sm text-zinc-400">
                  {resolverParsed.name} •{" "}
                  {resolverParsed.setCode?.toUpperCase() || "no set"} #
                  {resolverParsed.collectorNumber || "—"}
                </p>
              </div>
              <a
                className="border px-2"
                href={buildImportReviewUrl(selectedBatch.id, {
                  status: activeReviewFilter,
                  q: reviewSearch,
                })}
              >
                Close
              </a>
            </div>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div className="border border-zinc-800 rounded p-3 space-y-1">
                <h3 className="font-semibold">Imported Row</h3>
                <p>Quantity: {resolverParsed.quantity}</p>
                <p>Foil: {resolverParsed.foilStatus}</p>
                <p>Condition: {resolverItem.parsedCondition}</p>
                <p>Language: {resolverParsed.language}</p>
                <p>Imported location: {resolverParsed.locationName || "—"}</p>
                <p>Notes: {resolverParsed.notes || "—"}</p>
              </div>
              <div className="border border-zinc-800 rounded p-3 space-y-1">
                <h3 className="font-semibold">Current Match</h3>
                {resolverItem.cardPrinting ? (
                  <>
                    <p>{resolverItem.cardPrinting.name}</p>
                    <p>
                      {resolverItem.cardPrinting.setName} (
                      {resolverItem.cardPrinting.setCode.toUpperCase()}) #
                      {resolverItem.cardPrinting.collectorNumber}
                    </p>
                    {cardImage(resolverItem.cardPrinting) ? (
                      <img
                        src={cardImage(resolverItem.cardPrinting)}
                        alt=""
                        className="h-28 rounded"
                      />
                    ) : null}
                  </>
                ) : (
                  <p className="text-zinc-400">No card selected yet.</p>
                )}
              </div>
            </div>
            <details className="border border-zinc-800 rounded p-3">
              <summary className="cursor-pointer font-semibold">
                View Attempts
              </summary>
              <div className="mt-2 space-y-2 text-sm">
                {resolverItem.resolutionAttempts.length ? (
                  resolverItem.resolutionAttempts.map((attempt) => (
                    <div
                      key={attempt.id}
                      className="border border-zinc-800 rounded p-2"
                    >
                      <div>
                        {attempt.mode} • {attempt.resolutionMethod} •{" "}
                        {attempt.confidence}
                      </div>
                      <div className="text-zinc-400">
                        {attempt.previousStatus} → {attempt.newStatus} • Query:{" "}
                        {attempt.queryUsed || "—"}
                      </div>
                      <div>{attempt.message || "—"}</div>
                    </div>
                  ))
                ) : (
                  <p className="text-zinc-400">
                    No retry attempts have been recorded for this row yet.
                  </p>
                )}
              </div>
            </details>
            <form
              action={updateImportRow}
              className="border border-zinc-800 rounded p-3 grid md:grid-cols-5 gap-2"
            >
              <input type="hidden" name="itemId" value={resolverItem.id} />
              <input
                type="hidden"
                name="returnStatus"
                value={activeReviewFilter}
              />
              <input type="hidden" name="returnQ" value={reviewSearch} />
              <label className="text-sm">
                Quantity
                <input
                  name="quantity"
                  type="number"
                  min={1}
                  defaultValue={resolverParsed.quantity}
                  className="w-full border p-2 bg-zinc-900"
                />
              </label>
              <label className="text-sm">
                Foil
                <select
                  name="foilStatus"
                  defaultValue={resolverParsed.foilStatus}
                  className="w-full border p-2 bg-zinc-900"
                >
                  <option value="NONFOIL">nonfoil</option>
                  <option value="FOIL">foil</option>
                  <option value="ETCHED">etched</option>
                </select>
              </label>
              <label className="text-sm">
                Condition
                <input
                  name="condition"
                  defaultValue={
                    resolverItem.parsedCondition || resolverParsed.condition
                  }
                  className="w-full border p-2 bg-zinc-900"
                />
              </label>
              <label className="text-sm">
                Language
                <input
                  name="language"
                  defaultValue={resolverParsed.language}
                  className="w-full border p-2 bg-zinc-900"
                />
              </label>
              <label className="text-sm md:col-span-5">
                Notes / row warning
                <input
                  name="rowNote"
                  defaultValue={resolverParsed.warning || ""}
                  className="w-full border p-2 bg-zinc-900"
                />
              </label>
              <label className="text-sm md:col-span-5">
                Card notes
                <input
                  name="notes"
                  defaultValue={resolverParsed.notes || ""}
                  className="w-full border p-2 bg-zinc-900"
                />
              </label>
              <SubmitButton
                pendingLabel="Saving row…"
                className="border px-3 py-2 md:col-span-5"
              >
                Save Row Edits
              </SubmitButton>
            </form>
            <form
              method="get"
              className="border border-zinc-800 rounded p-3 flex gap-2"
            >
              <input type="hidden" name="batchId" value={selectedBatch.id} />
              <input
                type="hidden"
                name="resolveItemId"
                value={resolverItem.id}
              />
              <input
                name="resolverQ"
                defaultValue={resolverQuery}
                className="flex-1 border p-2 bg-zinc-900"
                placeholder="Card name or Scryfall query, e.g. command tower set:c20"
              />
              <button className="border px-3">Search</button>
            </form>
            <div className="space-y-2">
              <h3 className="font-semibold">Card Printing Results</h3>
              {resolverSearch.message ? (
                <p className="text-sm text-zinc-400" role="status">
                  {resolverSearch.message}
                </p>
              ) : null}
              {resolverResults.slice(0, 20).map((card) => (
                <form
                  key={card.id}
                  action={resolveImportRow}
                  className="border border-zinc-800 rounded p-2 flex gap-3 items-center"
                >
                  <input type="hidden" name="itemId" value={resolverItem.id} />
                  <input
                    type="hidden"
                    name="returnStatus"
                    value={activeReviewFilter}
                  />
                  <input type="hidden" name="returnQ" value={reviewSearch} />
                  <input type="hidden" name="scryfallId" value={card.id} />
                  {cardImage({
                    imageUris:
                      card.image_uris ?? card.card_faces?.[0]?.image_uris ?? {},
                    imageUri:
                      card.image_uris?.normal ??
                      card.card_faces?.[0]?.image_uris?.normal,
                  }) ? (
                    <img
                      src={cardImage({
                        imageUris:
                          card.image_uris ??
                          card.card_faces?.[0]?.image_uris ??
                          {},
                        imageUri:
                          card.image_uris?.normal ??
                          card.card_faces?.[0]?.image_uris?.normal,
                      })}
                      alt=""
                      className="h-20 rounded"
                    />
                  ) : (
                    <div className="h-20 w-14 border border-zinc-700 rounded" />
                  )}
                  <div className="flex-1 text-sm">
                    <div className="font-semibold">{card.name}</div>
                    <div>
                      {card.set_name} ({card.set.toUpperCase()}) #
                      {card.collector_number} • {card.rarity}
                    </div>
                    <div className="text-zinc-400">{card.type_line}</div>
                  </div>
                  <SubmitButton
                    pendingLabel="Resolving…"
                    className="border px-3 py-2"
                  >
                    Select
                  </SubmitButton>
                </form>
              ))}
              {resolverResults.length === 0 ? (
                <p className="text-sm text-zinc-400">
                  No results yet. Try card name, <code>set:cmr cn:57</code>, or
                  exact name plus set.
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section id="import-history" className="space-y-2 scroll-mt-4">
        <h2 className="text-xl font-semibold">Import History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th>Filename</th>
                <th>Date</th>
                <th>Owner</th>
                <th>Total</th>
                <th>Imported</th>
                <th>Skipped</th>
                <th>Manual</th>
                <th>Warnings</th>
                <th>Unmatched</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((batch) => {
                const manual = batch.items.filter((i) =>
                  ["resolved", "manually_resolved", "changed"].includes(
                    i.status,
                  ),
                ).length;
                return (
                  <tr key={batch.id} className="border-b border-zinc-900">
                    <td>
                      <a
                        className="underline"
                        href={`/imports?batchId=${batch.id}`}
                      >
                        {batch.filename}
                      </a>
                    </td>
                    <td>{batch.createdAt.toLocaleString()}</td>
                    <td>{batch.selectedPlayer.displayName}</td>
                    <td>{batch.totalRows}</td>
                    <td>{batch.matchedRows}</td>
                    <td>{batch.skippedRows}</td>
                    <td>{manual}</td>
                    <td>{batch.warningRows}</td>
                    <td>{batch.errorRows}</td>
                    <td>{batch.status}</td>
                    <td>
                      <details className="min-w-48 rounded border border-zinc-800 px-2 py-1">
                        <summary className="cursor-pointer">Actions</summary>
                        <div className="mt-2 space-y-2">
                          <a
                            className="block underline"
                            href={`${buildImportReviewUrl(batch.id)}#import-review`}
                          >
                            Open review
                          </a>
                          <form action={deleteImportHistory}>
                            <input
                              type="hidden"
                              name="batchId"
                              value={batch.id}
                            />
                            <SubmitButton
                              pendingLabel="Clearingâ€¦"
                              className="underline"
                              minWidthClassName="min-w-24"
                            >
                              Clear this history
                            </SubmitButton>
                          </form>
                          {isAdmin &&
                          ["IMPORTED", "imported"].includes(batch.status) ? (
                            <form
                              action={undoImportBatch}
                              className="space-y-1"
                            >
                              <input
                                type="hidden"
                                name="batchId"
                                value={batch.id}
                              />
                              <input
                                name="confirmation"
                                placeholder="DELETE IMPORT"
                                className="w-full border p-1 bg-zinc-900"
                              />
                              <SubmitButton
                                pendingLabel="Undoingâ€¦"
                                className="underline text-red-200"
                                minWidthClassName="min-w-20"
                              >
                                Undo import
                              </SubmitButton>
                            </form>
                          ) : null}
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
