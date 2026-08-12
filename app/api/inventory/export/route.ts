import { NextRequest } from "next/server";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { InventoryLocationKind } from "@prisma/client";
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

function moxfieldFoilValue(foilStatus: string) {
  if (foilStatus === "ETCHED") return "etched";
  if (foilStatus === "FOIL") return "foil";
  return "";
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

const MAX_SELECTED_EXPORT_ITEMS = 5_000;

function parseSelectedItemIds(params: URLSearchParams) {
  if (params.get("scope") !== "selection") return null;
  if (params.get("selectionMode") === "all") return null;

  try {
    const parsed = JSON.parse(params.get("itemIds") || "[]");
    if (!Array.isArray(parsed)) return null;
    const ids = Array.from(
      new Set(
        parsed.filter(
          (value): value is string =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= 100,
        ),
      ),
    );
    return ids.length <= MAX_SELECTED_EXPORT_ITEMS ? ids : null;
  } catch {
    return null;
  }
}

async function exportInventory(params: URLSearchParams) {
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

  const format = params.get("format") === "moxfield" ? "moxfield" : "full";
  const scope = params.get("scope") || "my";
  const selectionMode =
    params.get("selectionMode") === "all" ? "all" : "selected";
  const selectedItemIds = parseSelectedItemIds(params);
  if (
    scope === "selection" &&
    selectionMode === "selected" &&
    (!selectedItemIds || selectedItemIds.length === 0)
  ) {
    return new Response("Choose at least one inventory entry to export.", {
      status: 400,
    });
  }
  const ownerId = params.get("ownerId") || "";
  let effectiveOwnerId = ownerId || signedInPlayerId || "";
  let selectedLocation: {
    id: string;
    name: string;
    ownerPlayerId: string;
  } | null = null;

  if (scope === "location") {
    const locationId = params.get("locationId") || "";
    if (!locationId) {
      return new Response("Choose a location to export.", { status: 400 });
    }
    const location = await prisma.inventoryLocation.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        name: true,
        ownerPlayerId: true,
        active: true,
        kind: true,
        systemManaged: true,
      },
    });
    if (
      !location ||
      !location.active ||
      location.kind !== InventoryLocationKind.NORMAL ||
      location.systemManaged
    ) {
      return new Response(
        "Choose an active, normal inventory location. Export deck contents from the deck.",
        { status: 400 },
      );
    }
    if (ownerId && ownerId !== location.ownerPlayerId) {
      return new Response(
        "The selected location does not belong to that owner.",
        {
          status: 400,
        },
      );
    }
    selectedLocation = location;
    effectiveOwnerId = location.ownerPlayerId;
  }

  if (!canExportInventory(user, effectiveOwnerId, adminModeActive)) {
    return new Response("Not authorized to export that inventory.", {
      status: 403,
    });
  }

  const filters = parseInventoryFilters(params);
  const where: any = buildInventoryWhereFromFilters(filters, {
    adminModeActive,
    playerId: signedInPlayerId,
  });
  if (selectedLocation) {
    where.currentOwnerId = selectedLocation.ownerPlayerId;
    where.locationId = selectedLocation.id;
  } else if (!adminModeActive) {
    where.currentOwnerId = signedInPlayerId;
  } else if (scope === "my" && signedInPlayerId) {
    where.currentOwnerId = signedInPlayerId;
  } else if ((scope === "owner" || scope === "filtered") && ownerId) {
    where.currentOwnerId = ownerId;
  } else if (scope === "all") {
    delete where.currentOwnerId;
  }
  if (scope === "selection" && selectionMode === "selected") {
    where.id = { in: selectedItemIds };
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

  const selectedOwner = effectiveOwnerId
    ? await prisma.player.findUnique({ where: { id: effectiveOwnerId } })
    : null;
  let filenameBase = selectedLocation
    ? `mtg-inventory-${safeFilenamePart(selectedLocation.name)}`
    : scope === "selection"
      ? `mtg-inventory-${selectionMode === "all" ? "filtered" : "selected"}`
      : "mtg-inventory-full";

  let csv: string;
  if (format === "moxfield") {
    filenameBase =
      scope === "selection"
        ? `moxfield-inventory-${selectionMode === "all" ? "filtered" : "selected"}`
        : `moxfield-inventory-${safeFilenamePart(selectedLocation?.name || selectedOwner?.displayName || user.player?.displayName || (adminModeActive && scope === "all" ? "all" : "my"))}`;
    const headers = [
      "Count",
      "Name",
      "Edition",
      "Condition",
      "Language",
      "Foil",
      "Collector Number",
      "Tag",
    ];
    const rows = items.map((item) => [
      item.quantity,
      item.card.name,
      item.card.setCode.toUpperCase(),
      item.condition || "NM",
      item.language || "EN",
      moxfieldFoilValue(item.foilStatus),
      item.card.collectorNumber,
      [
        "MTGInventory",
        `Owner:${item.currentOwner.displayName}`,
        `Source:${item.sourceType}`,
        `Location:${item.location?.name ?? "Unassigned"}`,
        ...(item.locationSection ? [`Section:${item.locationSection}`] : []),
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
      "Section",
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
      item.locationSection ?? "",
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

export async function GET(request: NextRequest) {
  return exportInventory(request.nextUrl.searchParams);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const params = new URLSearchParams(String(formData.get("filterQuery") || ""));
  params.set("scope", "selection");
  params.set(
    "selectionMode",
    formData.get("selectionMode") === "all" ? "all" : "selected",
  );
  params.set("itemIds", String(formData.get("itemIds") || "[]"));
  params.set(
    "format",
    formData.get("format") === "moxfield" ? "moxfield" : "full",
  );
  return exportInventory(params);
}
