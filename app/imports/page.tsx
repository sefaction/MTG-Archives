export const dynamic = "force-dynamic";
import Papa from "papaparse";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { FoilStatus, InventorySourceType } from "@prisma/client";
import { Nav } from "@/components/Nav";
import { isAdminUser, requireLogin as requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  findOrImportCard,
  normalizeCollectorNumber,
  normalizeSetCode,
  upsertScryfallCard,
} from "@/lib/card-import";
import { getCardByScryfallId, searchCards } from "@/lib/scryfall";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { ImportProgressPanel } from "@/components/ImportProgressPanel";
import { calculateImportProgress } from "@/lib/import-progress";

const aliases: Record<string, string[]> = {
  quantity: ["quantity", "count", "qty", "copies"],
  name: ["name", "card name"],
  setCode: ["set", "set code", "edition"],
  collectorNumber: ["collector number", "collector #", "number", "cn"],
  foil: ["foil", "foil status", "finish"],
  condition: ["condition"],
  language: ["language", "lang"],
  notes: ["notes", "comment", "tag", "tags"],
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

const importableStatuses = [
  "matched",
  "new",
  "resolved",
  "manually_resolved",
  "changed",
];
const finalStatuses = [...importableStatuses, "imported"];

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
  scryfallId?: string;
  warning?: string;
  error?: string;
};

type SearchParams = {
  batchId?: string;
  resolveItemId?: string;
  resolverQ?: string;
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
  const v = norm(value);
  if (!v) return "NM";
  const map: Record<string, string> = {
    nm: "NM",
    "near mint": "NM",
    nearmint: "NM",
    lp: "LP",
    "lightly played": "LP",
    lightlyplayed: "LP",
    sp: "LP",
    "slightly played": "LP",
    mp: "MP",
    "moderately played": "MP",
    moderatelyplayed: "MP",
    hp: "HP",
    "heavily played": "HP",
    heavilyplayed: "HP",
    dmg: "DMG",
    damaged: "DMG",
    poor: "DMG",
  };
  return map[v] ?? value.trim().toUpperCase();
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
    | { small?: string; normal?: string }
    | null
    | undefined;
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
async function recalculateBatchCounts(batchId: string) {
  const items = await prisma.importBatchItem.findMany({
    where: { importBatchId: batchId },
  });
  const matchedRows = items.filter((item) =>
    finalStatuses.includes(item.status),
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
    const method = resolutionMethodFromMessage(match.message);
    const confidence = confidenceFromStatus(nextStatus, match.message);
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
  if (!isAdminUser(actionUser, actionUserWithPlayer?.player))
    throw new Error("Admin permissions required.");
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
  const isAdmin = isAdminUser(user, userWithPlayer?.player);
  const params = await searchParams;
  const players = await prisma.player.findMany({
    where: { active: true },
    orderBy: { displayName: "asc" },
  });
  const rounds = await prisma.round.findMany({
    orderBy: { startDate: "desc" },
  });
  const defaultPlayer = userWithPlayer?.player ?? players[0];

  async function previewImport(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionIsAdmin = isAdminUser(actionUser, actionUserWithPlayer?.player);
    if (!actionIsAdmin && !actionUserWithPlayer?.playerId)
      throw new Error(
        "Your login is not linked to an inventory owner. Ask an admin to save your account before importing.",
      );
    const selectedPlayerId = actionIsAdmin
      ? String(fd.get("selectedPlayerId") || "")
      : String(actionUserWithPlayer!.playerId);
    const selectedOriginalOpenerId = actionIsAdmin
      ? String(fd.get("selectedOriginalOpenerId") || selectedPlayerId)
      : String(actionUserWithPlayer!.playerId);
    const selectedRoundId = String(fd.get("selectedRoundId") || "");
    const file = fd.get("csvFile") as File | null;
    const duplicateBehavior = ["add", "separate", "preview"].includes(
      String(fd.get("duplicateBehavior")),
    )
      ? String(fd.get("duplicateBehavior"))
      : "add";
    if (!selectedPlayerId || !selectedOriginalOpenerId || !file)
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
        selectedRoundId: selectedRoundId || null,
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
    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const parsedRow = parseRow(row, rowNumber);
      let status = "unmatched";
      let message = parsedRow.error || "";
      let cardId: string | undefined;
      if (parsedRow.error) {
        status = "error";
      } else {
        const match = await findOrImportCard(parsedRow);
        status = match.status;
        message = [
          match.message,
          parsedRow.warning ? `Warning: ${parsedRow.warning}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        cardId = match.card?.id;
      }
      await prisma.importBatchItem.create({
        data: {
          importBatchId: batch.id,
          rowNumber,
          rawRowJson: jsonSafe(row),
          parsedRowJson: jsonSafe(parsedRow),
          status,
          message: message || null,
          cardPrintingId: cardId,
          parsedFoilStatus: parsedRow.foilStatus,
          parsedCondition: parsedRow.condition,
        },
      });
    }
    await recalculateBatchCounts(batch.id);
    redirect(`/imports?batchId=${batch.id}`);
  }

  async function updateImportRow(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionIsAdmin = isAdminUser(actionUser, actionUserWithPlayer?.player);
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
    redirect(`/imports?batchId=${item.importBatchId}&resolveItemId=${item.id}`);
  }

  async function resolveImportRow(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionIsAdmin = isAdminUser(actionUser, actionUserWithPlayer?.player);
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
    const cardData = await getCardByScryfallId(scryfallId);
    if (!cardData)
      throw new Error("Selected Scryfall card could not be found.");
    const card = await upsertScryfallCard(cardData);
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
    redirect(`/imports?batchId=${item.importBatchId}`);
  }

  async function setRowSkipped(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionIsAdmin = isAdminUser(actionUser, actionUserWithPlayer?.player);
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
    redirect(`/imports?batchId=${item.importBatchId}`);
  }

  async function retryUnresolvedRows(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionIsAdmin = isAdminUser(actionUser, actionUserWithPlayer?.player);
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
    await assertAdminUser();
    const batchId = String(fd.get("batchId") || "");
    const where = batchId ? { importBatchId: batchId } : {};
    await prisma.importResolutionAttempt.deleteMany({
      where: batchId ? { importBatchItem: { importBatchId: batchId } } : {},
    });
    await prisma.importBatchItem.deleteMany({ where });
    await prisma.importBatch.deleteMany({
      where: batchId ? { id: batchId } : {},
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
              message: "Pull deleted; inventory item was already gone.",
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
    redirect(`/imports?batchId=${batch.id}`);
  }

  async function confirmImport(fd: FormData) {
    "use server";
    const actionUser = await requireAuth();
    const actionUserWithPlayer = await prisma.user.findUnique({
      where: { id: actionUser.id },
      include: { player: true },
    });
    const actionIsAdmin = isAdminUser(actionUser, actionUserWithPlayer?.player);
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
    const unresolved = batch.items.filter(
      (item) =>
        item.status !== "skipped" &&
        (!item.cardPrintingId || !importableStatuses.includes(item.status)),
    );
    if (unresolved.length)
      throw new Error(
        "Resolve or skip all unmatched/ambiguous rows before importing.",
      );
    let skippedRows = 0,
      committedRows = 0,
      errorRows = 0;
    for (const item of batch.items) {
      if (item.status === "skipped") {
        await prisma.importBatchItem.update({
          where: { id: item.id },
          data: { status: "skipped" },
        });
        skippedRows++;
        continue;
      }
      if (!item.cardPrintingId || !importableStatuses.includes(item.status)) {
        await prisma.importBatchItem.update({
          where: { id: item.id },
          data: { status: "error", message: "Not importable at confirm time." },
        });
        errorRows++;
        continue;
      }
      const card = await prisma.card.findUnique({
        where: { id: item.cardPrintingId },
      });
      if (!card) {
        await prisma.importBatchItem.update({
          where: { id: item.id },
          data: {
            status: "error",
            message: "Selected card printing no longer exists.",
          },
        });
        errorRows++;
        continue;
      }
      const parsedRow = item.parsedRowJson as ParsedRow;
      const quantity = Number(parsedRow.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        await prisma.importBatchItem.update({
          where: { id: item.id },
          data: {
            status: "error",
            message: "Quantity must be a positive integer.",
          },
        });
        errorRows++;
        continue;
      }
      const foilStatus = (item.parsedFoilStatus ||
        parsedRow.foilStatus ||
        "NONFOIL") as FoilStatus;
      const condition = item.parsedCondition || parsedRow.condition || "NM";
      const pull = batch.selectedRoundId
        ? await prisma.pull.create({
            data: {
              roundId: batch.selectedRoundId,
              playerId: batch.selectedOriginalOpenerId,
              cardId: item.cardPrintingId,
              quantity,
              foil: foilStatus !== FoilStatus.NONFOIL,
              condition,
              notes: parsedRow.notes || null,
            },
          })
        : null;
      const matchingWhere = {
        currentOwnerId: batch.selectedPlayerId,
        originalOpenerId: batch.selectedOriginalOpenerId,
        cardId: item.cardPrintingId,
        foil: foilStatus !== FoilStatus.NONFOIL,
        foilStatus,
        condition,
        language: parsedRow.language || "EN",
        roundId: batch.selectedRoundId ?? null,
        quantity: { gt: 0 },
      };
      const createData = {
        currentOwnerId: batch.selectedPlayerId,
        originalOpenerId: batch.selectedOriginalOpenerId,
        cardId: item.cardPrintingId,
        quantity,
        foil: foilStatus !== FoilStatus.NONFOIL,
        foilStatus,
        condition,
        acquiredFromPullId: pull?.id ?? null,
        roundId: batch.selectedRoundId ?? null,
        notes: parsedRow.notes || null,
        sourceType: InventorySourceType.CSV_PULL_IMPORT,
        language: parsedRow.language || "EN",
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
        where: { id: item.id },
        data: {
          status: "imported",
          inventoryItemId: inventory.id,
          pullId: pull?.id ?? null,
          quantityImported: quantity,
          duplicateBehaviorUsed: duplicateBehavior,
          createdNewInventoryItem: !existingInventory,
          updatedExistingInventoryItem: Boolean(existingInventory),
          beforeQuantity,
          afterQuantity: inventory.quantity,
        },
      });
      committedRows++;
    }
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: errorRows ? "IMPORTED_WITH_ERRORS" : "IMPORTED",
        skippedRows,
        matchedRows: committedRows,
        errorRows,
      },
    });
    revalidatePath("/imports");
    revalidatePath("/inventory");
    redirect(`/imports?batchId=${batch.id}`);
  }

  const selectedBatch = params.batchId
    ? await prisma.importBatch.findUnique({
        where: { id: params.batchId },
        include: {
          selectedPlayer: true,
          selectedOriginalOpener: true,
          selectedRound: true,
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
      selectedRound: true,
      items: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const selectedItems = selectedBatch?.items ?? [];
  const summary = {
    total: selectedItems.length,
    ready: selectedItems.filter(
      (item) =>
        item.status !== "skipped" &&
        item.cardPrintingId &&
        importableStatuses.includes(item.status),
    ).length,
    matched: selectedItems.filter((item) => item.status === "matched").length,
    new: selectedItems.filter((item) => item.status === "new").length,
    manual: selectedItems.filter((item) =>
      ["resolved", "manually_resolved", "changed"].includes(item.status),
    ).length,
    unmatched: selectedItems.filter((item) => item.status === "unmatched")
      .length,
    ambiguous: selectedItems.filter((item) => item.status === "ambiguous")
      .length,
    warnings: selectedItems.filter((item) =>
      Boolean(
        item.message?.toLowerCase().includes("warning") ||
        (item.parsedRowJson as ParsedRow).warning,
      ),
    ).length,
    skipped: selectedItems.filter((item) => item.status === "skipped").length,
  };
  const unresolvedCount = selectedItems.filter(
    (item) =>
      item.status !== "skipped" &&
      (!item.cardPrintingId || !importableStatuses.includes(item.status)),
  ).length;
  const resolverItem = params.resolveItemId
    ? selectedItems.find((item) => item.id === params.resolveItemId)
    : null;
  const resolverParsed = resolverItem?.parsedRowJson as ParsedRow | undefined;
  const resolverQuery = resolverParsed
    ? buildResolverQuery(resolverParsed, params.resolverQ)
    : "";
  const resolverResults =
    resolverItem && resolverQuery ? await searchCards(resolverQuery) : [];
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
        pullRecords: selectedItems.filter((item) => Boolean(item.pullId))
          .length,
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

  return (
    <main className="p-8 space-y-6">
      <Nav />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Imports</h1>
        <a className="border px-3 py-2" href="/api/imports/sample">
          Download sample inventory import CSV
        </a>
      </div>
      <section className="border border-zinc-800 rounded p-4 space-y-3">
        <h2 className="text-xl font-semibold">Inventory CSV Import</h2>
        <p className="text-sm text-zinc-400">
          Accepts MTG Inventory sample columns or Moxfield collection exports
          with Count, Name, Edition, Condition, Language, Foil, and Collector
          Number columns.
        </p>
        {!isAdmin && defaultPlayer ? (
          <p className="text-sm text-zinc-300">
            Importing inventory for:{" "}
            <strong>{defaultPlayer.displayName}</strong>
          </p>
        ) : null}
        <form
          action={previewImport}
          className="grid md:grid-cols-2 gap-3"
          encType="multipart/form-data"
        >
          {isAdmin ? (
            <>
              <label className="text-sm">
                Current owner
                <select
                  name="selectedPlayerId"
                  defaultValue={defaultPlayer?.id}
                  className="w-full border p-2 bg-zinc-900"
                >
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Original opener
                <select
                  name="selectedOriginalOpenerId"
                  defaultValue={defaultPlayer?.id}
                  className="w-full border p-2 bg-zinc-900"
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
              <input
                type="hidden"
                name="selectedOriginalOpenerId"
                value={defaultPlayer?.id ?? ""}
              />
            </>
          )}
          <label className="text-sm">
            Acquisition group (optional)
            <select
              name="selectedRoundId"
              className="w-full border p-2 bg-zinc-900"
            >
              <option value="">No legacy round</option>
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Duplicate behavior
            <select
              name="duplicateBehavior"
              className="w-full border p-2 bg-zinc-900"
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
          <label className="text-sm md:col-span-2">
            CSV file
            <input
              name="csvFile"
              type="file"
              accept=".csv,text/csv"
              required
              className="w-full border p-2 bg-zinc-900"
            />
          </label>
          <SubmitButton
            pendingLabel="Identifying cards…"
            className="border px-3 py-2 md:col-span-2"
          >
            Preview Import
          </SubmitButton>
        </form>
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
          <div className="grid md:grid-cols-3 gap-3 text-sm">
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
                Delete all import history only
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

      {selectedBatch ? (
        <section className="border border-zinc-800 rounded p-4 space-y-4">
          <div>
            <h2 className="text-xl font-semibold">
              Preview: {selectedBatch.filename}
            </h2>
            <p className="text-sm text-zinc-400">
              Owner: {selectedBatch.selectedPlayer.displayName} • Acquisition
              group: {selectedBatch.selectedRound?.name ?? "None"} • Status:{" "}
              {selectedBatch.status}
            </p>
          </div>
          {selectedProgress ? (
            <ImportProgressPanel
              batchId={selectedBatch.id}
              initialProgress={selectedProgress}
            />
          ) : null}
          <div className="flex flex-wrap gap-2 text-sm">
            <form action={retryUnresolvedRows}>
              <input type="hidden" name="batchId" value={selectedBatch.id} />
              <SubmitButton
                pendingLabel="Retrying rows…"
                name="mode"
                value="normal_retry"
                className="border px-3 py-2"
              >
                Retry unresolved rows
              </SubmitButton>
            </form>
            <form action={retryUnresolvedRows}>
              <input type="hidden" name="batchId" value={selectedBatch.id} />
              <SubmitButton
                pendingLabel="Deep resolving…"
                name="mode"
                value="deep_resolve"
                className="border px-3 py-2"
              >
                Deep resolve unresolved rows
              </SubmitButton>
            </form>
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
                        Total items: {undoPreview.totalItems} • Legacy pull rows
                        to delete: {undoPreview.pullRecords} • Inventory
                        deletes: {undoPreview.inventoryDeletes} • Quantity
                        reductions: {undoPreview.quantityReductions} • Cannot
                        undo: {undoPreview.cannotUndo}
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
              ["Total rows", summary.total, "border-zinc-700"],
              ["Ready", summary.ready, "border-emerald-700"],
              ["Matched", summary.matched, "border-emerald-700"],
              ["New", summary.new, "border-sky-700"],
              ["Manual", summary.manual, "border-purple-700"],
              ["Unmatched", summary.unmatched, "border-red-800"],
              ["Ambiguous", summary.ambiguous, "border-amber-700"],
              ["Warnings", summary.warnings, "border-yellow-700"],
              ["Skipped", summary.skipped, "border-zinc-600"],
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
            {summary.total
              ? [
                  ["bg-emerald-600", summary.matched],
                  ["bg-sky-600", summary.new],
                  ["bg-purple-600", summary.manual],
                  ["bg-red-700", summary.unmatched],
                  ["bg-amber-600", summary.ambiguous],
                  ["bg-zinc-600", summary.skipped],
                ].map(([cls, count], index) => (
                  <div
                    key={index}
                    className={String(cls)}
                    style={{
                      width: `${(Number(count) / summary.total) * 100}%`,
                    }}
                  />
                ))
              : null}
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
                  <th>Status</th>
                  <th>Message</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedItems.map((item) => {
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
                          href={`/imports?batchId=${selectedBatch.id}&resolveItemId=${item.id}`}
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
              Resolve or skip all unmatched/ambiguous rows before importing.
            </p>
          ) : null}
          {selectedBatch.status === "PREVIEW" &&
          !selectedBatch.importType.endsWith(":preview") ? (
            <form action={confirmImport} className="flex gap-3 items-center">
              <input type="hidden" name="batchId" value={selectedBatch.id} />
              <SubmitButton
                pendingLabel="Importing…"
                disabled={unresolvedCount > 0}
                className="border px-3 py-2 disabled:opacity-50"
              >
                Confirm Import
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
                href={`/imports?batchId=${selectedBatch.id}`}
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
                placeholder="Search Scryfall by name, set, or collector number"
              />
              <button className="border px-3">Search</button>
            </form>
            <div className="space-y-2">
              <h3 className="font-semibold">Scryfall Results</h3>
              {resolverResults.slice(0, 20).map((card) => (
                <form
                  key={card.id}
                  action={resolveImportRow}
                  className="border border-zinc-800 rounded p-2 flex gap-3 items-center"
                >
                  <input type="hidden" name="itemId" value={resolverItem.id} />
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

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Import History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th>Filename</th>
                <th>Date</th>
                <th>Owner</th>
                <th>Acquisition group</th>
                <th>Total</th>
                <th>Imported</th>
                <th>Skipped</th>
                <th>Manual</th>
                <th>Warnings</th>
                <th>Unmatched</th>
                <th>Status</th>
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
                    <td>{batch.selectedRound?.name ?? "None"}</td>
                    <td>{batch.totalRows}</td>
                    <td>{batch.matchedRows}</td>
                    <td>{batch.skippedRows}</td>
                    <td>{manual}</td>
                    <td>{batch.warningRows}</td>
                    <td>{batch.errorRows}</td>
                    <td>{batch.status}</td>
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
