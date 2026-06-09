import { NextRequest } from "next/server";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { canExportInventory, getAccessScope, requireLogin } from "@/lib/auth";
import {
  buildInventoryWhereFromFilters,
  inventoryCardMatchesPostFilters,
  parseInventoryFilters,
} from "@/lib/inventory-filters";

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function jsonList(value: unknown) {
  if (Array.isArray(value)) return value.join("");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value ? String(value) : "";
}

function priceValue(prices: unknown, key: string) {
  return prices && typeof prices === "object"
    ? String((prices as Record<string, unknown>)[key] ?? "")
    : "";
}

function moxfieldFoilValue(foilStatus: string, format: string) {
  const isFoil = foilStatus === "FOIL" || foilStatus === "ETCHED";
  if (format === "boolean") return isFoil ? "true" : "false";
  if (format === "text")
    return foilStatus === "NONFOIL" ? "nonfoil" : foilStatus.toLowerCase();
  return isFoil ? "foil" : "";
}

function buildCsv(headers: string[], rows: unknown[][]) {
  return (
    [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") +
    "\n"
  );
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function persistExportFile(filename: string, csv: string) {
  const directory = process.env.EXPORTS_DATA_PATH;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, path.basename(filename)), csv, "utf8");
}

function safeFilenamePart(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "inventory"
  );
}

export async function GET(request: NextRequest) {
  const user = await requireLogin();
  const accessScope = await getAccessScope(user);
  const adminModeActive = accessScope?.mode === "admin";
  const signedInPlayerId = user.playerId;

  if (!signedInPlayerId && !adminModeActive) {
    return new Response(
      "Your login is not linked to an inventory owner, so there is no inventory to export.",
      { status: 403 },
    );
  }

  const params = request.nextUrl.searchParams;
  const format = params.get("format") === "moxfield" ? "moxfield" : "full";
  const scope = params.get("scope") || "my";
  const ownerId = params.get("ownerId") || "";
  const foilFormat = params.get("foilFormat") || "moxfield";

  if (!canExportInventory(user, ownerId || signedInPlayerId, adminModeActive)) {
    return new Response("Not authorized to export that inventory.", {
      status: 403,
    });
  }

  const filters = parseInventoryFilters(params);
  const where: any = buildInventoryWhereFromFilters(filters, {
    adminModeActive,
    playerId: signedInPlayerId,
  });
  if (!adminModeActive) {
    where.currentOwnerId = signedInPlayerId;
  } else if (scope === "my" && signedInPlayerId) {
    where.currentOwnerId = signedInPlayerId;
  } else if ((scope === "owner" || scope === "filtered") && ownerId) {
    where.currentOwnerId = ownerId;
  } else if (scope === "all") {
    delete where.currentOwnerId;
  }

  const allItems = await prisma.inventoryItem.findMany({
    where,
    include: {
      card: true,
      currentOwner: true,
      location: true,
    },
    orderBy: [
      { currentOwner: { displayName: "asc" } },
      { card: { name: "asc" } },
    ],
  });

  const items = allItems.filter((item) =>
    inventoryCardMatchesPostFilters(item.card, filters),
  );

  const selectedOwner = ownerId
    ? await prisma.player.findUnique({ where: { id: ownerId } })
    : null;
  let filenameBase = "mtg-inventory-full";

  let csv: string;
  if (format === "moxfield") {
    filenameBase = `moxfield-inventory-${safeFilenamePart(selectedOwner?.displayName || user.player?.displayName || (adminModeActive && scope === "all" ? "all" : "my"))}`;
    const headers = [
      "Count",
      "Name",
      "Edition",
      "Condition",
      "Language",
      "Foil",
      "Tag",
    ];
    const rows = items.map((item) => [
      item.quantity,
      item.card.name,
      item.card.setCode.toUpperCase(),
      item.condition || "NM",
      item.language || "EN",
      moxfieldFoilValue(item.foilStatus, foilFormat),
      [
        "MTGInventory",
        `Owner:${item.currentOwner.displayName}`,
        `Source:${item.sourceType}`,
        `Location:${item.location?.name ?? "Unassigned"}`,
      ].join(", "),
    ]);
    csv = buildCsv(headers, rows);
  } else {
    const headers = [
      "Quantity",
      "Name",
      "Set Code",
      "Set Name",
      "Collector Number",
      "Rarity",
      "Mana Cost",
      "Type Line",
      "Oracle Text",
      "Colors",
      "Color Identity",
      "Foil Status",
      "Condition",
      "Language",
      "Owner",
      "Location",
      "Source",
      "Scryfall ID",
      "Oracle ID",
      "USD Price",
      "USD Foil Price",
      "Notes",
    ];
    const rows = items.map((item) => [
      item.quantity,
      item.card.name,
      item.card.setCode.toUpperCase(),
      item.card.setName || "",
      item.card.collectorNumber,
      item.card.rarity,
      item.card.manaCost || "",
      item.card.typeLine,
      item.card.oracleText || "",
      jsonList(item.card.colors),
      jsonList(item.card.colorIdentity),
      item.foilStatus,
      item.condition || "NM",
      item.language || "EN",
      item.currentOwner.displayName,
      item.location?.name ?? "Unassigned",
      item.sourceType,
      item.card.scryfallId,
      item.card.oracleId || "",
      priceValue(item.card.prices, "usd"),
      priceValue(item.card.prices, "usd_foil"),
      item.notes || "",
    ]);
    csv = buildCsv(headers, rows);
  }

  const downloadFilename = `${filenameBase}-${todayStamp()}.csv`;
  await persistExportFile(downloadFilename, csv);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${downloadFilename}"`,
    },
  });
}
