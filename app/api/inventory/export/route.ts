import { NextRequest } from "next/server";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { canExportInventory, isAdminUser, requireLogin } from "@/lib/auth";

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
  const userWithPlayer = user;
  const isAdmin = isAdminUser(user, user.player);
  const signedInPlayerId = user.playerId;

  if (!signedInPlayerId && !isAdmin) {
    return new Response(
      "Your login is not linked to an inventory owner, so there is no inventory to export.",
      { status: 403 },
    );
  }

  const params = request.nextUrl.searchParams;
  const format = params.get("format") === "moxfield" ? "moxfield" : "full";
  const scope = params.get("scope") || "my";
  const ownerId = params.get("ownerId") || "";
  const roundId = params.get("roundId") || "";
  const foilFormat = params.get("foilFormat") || "moxfield";

  if (!canExportInventory(user, ownerId || signedInPlayerId)) {
    return new Response("Not authorized to export that inventory.", {
      status: 403,
    });
  }

  const where: any = { quantity: { gt: 0 } };
  if (!isAdmin) {
    where.currentOwnerId = signedInPlayerId;
  } else if (scope === "my" && signedInPlayerId) {
    where.currentOwnerId = signedInPlayerId;
  } else if ((scope === "owner" || scope === "filtered") && ownerId) {
    where.currentOwnerId = ownerId;
  }

  if (roundId) where.roundId = roundId;
  const cardWhere: any = {};
  const cardName = params.get("cardName")?.trim();
  const oracleText = params.get("oracleText")?.trim();
  const typeLine = params.get("typeLine")?.trim();
  const set = params.get("set")?.trim();
  const rarity = params.get("rarity")?.trim();
  if (cardName) cardWhere.name = { contains: cardName, mode: "insensitive" };
  if (oracleText)
    cardWhere.oracleText = { contains: oracleText, mode: "insensitive" };
  if (typeLine)
    cardWhere.typeLine = { contains: typeLine, mode: "insensitive" };
  if (set) cardWhere.setCode = set.toLowerCase();
  if (rarity) cardWhere.rarity = rarity;
  if (params.get("manaValueMin") || params.get("manaValueMax"))
    cardWhere.manaValue = {
      gte: params.get("manaValueMin")
        ? Number(params.get("manaValueMin"))
        : undefined,
      lte: params.get("manaValueMax")
        ? Number(params.get("manaValueMax"))
        : undefined,
    };
  if (Object.keys(cardWhere).length) where.card = cardWhere;
  if (params.get("originalOpenerId"))
    where.originalOpenerId = params.get("originalOpenerId");
  if (params.get("foil") === "true") where.foil = true;
  if (params.get("foil") === "false") where.foil = false;

  const colorIdentityNeedle = params.get("colorIdentity")?.trim().toUpperCase();
  const keywordNeedle = params.get("keyword")?.trim().toLowerCase();
  const priceMin = params.get("priceMin")
    ? Number(params.get("priceMin"))
    : undefined;
  const priceMax = params.get("priceMax")
    ? Number(params.get("priceMax"))
    : undefined;

  const allItems = await prisma.inventoryItem.findMany({
    where,
    include: {
      card: true,
      currentOwner: true,
      originalOpener: true,
      round: true,
    },
    orderBy: [
      { currentOwner: { displayName: "asc" } },
      { card: { name: "asc" } },
    ],
  });

  const items = allItems.filter((item) => {
    if (colorIdentityNeedle) {
      const identity = Array.isArray(item.card.colorIdentity)
        ? item.card.colorIdentity.join("")
        : JSON.stringify(item.card.colorIdentity ?? "");
      if (!identity.toUpperCase().includes(colorIdentityNeedle)) return false;
    }
    if (keywordNeedle) {
      const keywords = Array.isArray(item.card.keywords)
        ? item.card.keywords.join(" ")
        : JSON.stringify(item.card.keywords ?? "");
      if (!keywords.toLowerCase().includes(keywordNeedle)) return false;
    }
    const usd = priceValue(item.card.prices, "usd");
    const usdNumber = usd ? Number(usd) : undefined;
    if (
      priceMin !== undefined &&
      (usdNumber === undefined ||
        Number.isNaN(usdNumber) ||
        usdNumber < priceMin)
    )
      return false;
    if (
      priceMax !== undefined &&
      (usdNumber === undefined ||
        Number.isNaN(usdNumber) ||
        usdNumber > priceMax)
    )
      return false;
    return true;
  });

  const selectedOwner = ownerId
    ? await prisma.player.findUnique({ where: { id: ownerId } })
    : null;
  let filenameBase = "mtg-inventory-full";

  let csv: string;
  if (format === "moxfield") {
    filenameBase = `moxfield-inventory-${safeFilenamePart(selectedOwner?.displayName || userWithPlayer?.player?.displayName || (isAdmin && scope === "all" ? "all" : "my"))}`;
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
        `AcquisitionGroup:${item.round?.name ?? "None"}`,
        `OriginalOwner:${item.originalOpener.displayName}`,
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
      "Original Owner",
      "Acquisition Group",
      "Source Type",
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
      item.originalOpener.displayName,
      item.round?.name ?? "",
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
