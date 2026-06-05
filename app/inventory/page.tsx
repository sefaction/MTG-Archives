export const dynamic = "force-dynamic";
import { getCurrentUser, isAdminUser, requireAdmin } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import { InventoryBrowser } from "@/components/InventoryBrowser";
import { FoilStatus, InventorySourceType } from "@prisma/client";
import { searchCards, getCardByScryfallId } from "@/lib/scryfall";
import { revalidatePath } from "next/cache";
import { cleanupZeroQuantityInventory, deleteInventoryItem } from "./actions";
import { SubmitButton } from "@/components/feedback/SubmitButton";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  const userWithPlayer = user;
  const isAdmin = isAdminUser(user, user?.player);

  const p = await searchParams;
  const where: any = { quantity: { gt: 0 } };
  if (p.cardName)
    where.card = {
      ...(where.card || {}),
      name: { contains: p.cardName, mode: "insensitive" },
    };
  if (p.oracleText)
    where.card = {
      ...(where.card || {}),
      oracleText: { contains: p.oracleText, mode: "insensitive" },
    };
  if (p.typeLine)
    where.card = {
      ...(where.card || {}),
      typeLine: { contains: p.typeLine, mode: "insensitive" },
    };
  if (p.ownerId) where.currentOwnerId = p.ownerId;
  if (p.originalOpenerId) where.originalOpenerId = p.originalOpenerId;
  if (p.roundId) where.roundId = p.roundId;
  if (p.set)
    where.card = { ...(where.card || {}), setCode: p.set.toLowerCase() };
  if (p.rarity) where.card = { ...(where.card || {}), rarity: p.rarity };
  if (p.foil === "true") where.foil = true;
  if (p.foil === "false") where.foil = false;
  if (p.manaValueMin || p.manaValueMax)
    where.card = {
      ...(where.card || {}),
      manaValue: {
        gte: p.manaValueMin ? Number(p.manaValueMin) : undefined,
        lte: p.manaValueMax ? Number(p.manaValueMax) : undefined,
      },
    };
  const colorIdentityNeedle = p.colorIdentity?.trim().toUpperCase();
  const keywordNeedle = p.keyword?.trim().toLowerCase();
  const priceMin = p.priceMin ? Number(p.priceMin) : undefined;
  const priceMax = p.priceMax ? Number(p.priceMax) : undefined;

  const [items, players, rounds, zeroQuantityCount] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: {
        card: true,
        currentOwner: true,
        originalOpener: true,
        round: true,
        auditLogs: {
          orderBy: { createdAt: "desc" },
          include: { changedByUser: { include: { player: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.player.findMany({ orderBy: { displayName: "asc" } }),
    prisma.round.findMany({ orderBy: { startDate: "desc" } }),
    isAdmin
      ? prisma.inventoryItem.count({ where: { quantity: { lte: 0 } } })
      : Promise.resolve(0),
  ]);

  const auditCardIds = Array.from(
    new Set(
      items.flatMap((item) =>
        item.auditLogs.flatMap((audit) => {
          const beforeJson = audit.beforeJson as Record<string, unknown>;
          const afterJson = audit.afterJson as Record<string, unknown>;
          return [beforeJson?.cardId, afterJson?.cardId].filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          );
        }),
      ),
    ),
  );

  const auditCards = auditCardIds.length
    ? await prisma.card.findMany({
        where: { id: { in: auditCardIds } },
        select: { id: true, name: true, setCode: true, collectorNumber: true },
      })
    : [];

  const cardLabels = Object.fromEntries([
    ...items.map((item) => [
      item.cardId,
      `${item.card.name} (${item.card.setCode.toUpperCase()}) #${item.card.collectorNumber}`,
    ]),
    ...auditCards.map((card) => [
      card.id,
      `${card.name} (${card.setCode.toUpperCase()}) #${card.collectorNumber}`,
    ]),
  ]);

  async function onSearchPrintings(fd: FormData) {
    "use server";
    await requireAdmin();
    const q = String(fd.get("q") || "");
    const r = await searchCards(q);
    return r.slice(0, 20).map((c) => ({
      id: c.id,
      name: c.name,
      set: c.set,
      set_name: c.set_name,
      collector_number: c.collector_number,
      rarity: c.rarity,
      image_uris: c.image_uris,
    }));
  }

  async function onSaveEdit(fd: FormData) {
    "use server";
    const actionUser = await requireAdmin();
    const inventoryItemId = String(fd.get("inventoryItemId") || "");
    const quantity = Number(fd.get("quantity"));
    if (!Number.isInteger(quantity) || quantity <= 0)
      throw new Error("Quantity must be a positive integer");
    const currentOwnerId = String(fd.get("currentOwnerId") || "");
    if (!currentOwnerId) throw new Error("Current owner is required");

    const before = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!before) throw new Error("Inventory item not found");

    let cardId = String(fd.get("existingCardId") || before.cardId);
    const newScryfallId = String(fd.get("newScryfallId") || "");
    if (newScryfallId) {
      const existing = await prisma.card.findUnique({
        where: { scryfallId: newScryfallId },
      });
      if (existing) {
        cardId = existing.id;
      } else {
        const cardData = await getCardByScryfallId(newScryfallId);
        if (!cardData) throw new Error("Invalid printing selection");
        const created = await prisma.card.create({
          data: {
            scryfallId: cardData.id,
            oracleId: cardData.oracle_id ?? null,
            name: cardData.name,
            manaCost: cardData.mana_cost ?? null,
            manaValue: cardData.cmc,
            colors: cardData.colors ?? [],
            colorIdentity: cardData.color_identity ?? [],
            typeLine: cardData.type_line,
            oracleText: cardData.oracle_text ?? null,
            power: cardData.power ?? null,
            toughness: cardData.toughness ?? null,
            loyalty: cardData.loyalty ?? null,
            defense: cardData.defense ?? null,
            keywords: cardData.keywords ?? [],
            legalities: cardData.legalities ?? {},
            setCode: cardData.set,
            setName: cardData.set_name,
            collectorNumber: cardData.collector_number,
            rarity: cardData.rarity,
            artist: cardData.artist ?? null,
            imageUri: cardData.image_uris?.normal ?? null,
            imageUris: cardData.image_uris ?? {},
            prices: cardData.prices ?? {},
            purchaseUris: cardData.purchase_uris ?? {},
            scryfallUri: cardData.scryfall_uri ?? null,
            lastSyncedAt: new Date(),
          },
        });
        cardId = created.id;
      }
    }

    const roundIdRaw = String(fd.get("roundId") || "");
    const originalOpenerRaw = String(fd.get("originalOpenerId") || "");
    const foilStatus = String(fd.get("foilStatus") || "NONFOIL") as FoilStatus;

    const updated = await prisma.inventoryItem.update({
      where: { id: inventoryItemId },
      data: {
        currentOwnerId,
        originalOpenerId: originalOpenerRaw || before.originalOpenerId,
        roundId: roundIdRaw || null,
        quantity,
        foilStatus,
        foil: foilStatus !== FoilStatus.NONFOIL,
        condition: String(fd.get("condition") || before.condition),
        notes: String(fd.get("notes") || "") || null,
        sourceType: String(
          fd.get("sourceType") || "CORRECTION",
        ) as InventorySourceType,
        cardId,
      },
    });

    await prisma.inventoryAuditLog.create({
      data: {
        inventoryItemId: updated.id,
        changedByUserId: actionUser.id,
        changeType: newScryfallId ? "printing_correction" : "manual_edit",
        beforeJson: before as any,
        afterJson: updated as any,
        reason: String(fd.get("reason") || "") || null,
      },
    });

    revalidatePath("/inventory");
  }

  const rows = items
    .map((i) => ({
      id: i.id,
      cardId: i.cardId,
      cardName: i.card.name,
      quantity: i.quantity,
      currentOwnerId: i.currentOwnerId,
      currentOwner: i.currentOwner.displayName,
      currentOwnerColor: i.currentOwner.color || "#64748b",
      originalOpenerId: i.originalOpenerId,
      originalOpener: i.originalOpener.displayName,
      roundId: i.roundId ?? "",
      setCode: i.card.setCode.toUpperCase(),
      setName: i.card.setName ?? "",
      rarity: i.card.rarity,
      manaCost: i.card.manaCost ?? "",
      manaValue: i.card.manaValue ?? undefined,
      typeLine: i.card.typeLine,
      colorIdentity: Array.isArray(i.card.colorIdentity)
        ? i.card.colorIdentity.join(",")
        : JSON.stringify(i.card.colorIdentity ?? ""),
      colors: Array.isArray(i.card.colors)
        ? i.card.colors.join(",")
        : JSON.stringify(i.card.colors ?? ""),
      priceUsd: (i.card.prices as any)?.usd ?? "",
      priceUsdFoil: (i.card.prices as any)?.usd_foil ?? "",
      priceUsdEtched: (i.card.prices as any)?.usd_etched ?? "",
      priceEur: (i.card.prices as any)?.eur ?? "",
      priceEurFoil: (i.card.prices as any)?.eur_foil ?? "",
      priceTix: (i.card.prices as any)?.tix ?? "",
      foil: i.foil,
      foilStatus: i.foilStatus,
      sourceType: i.sourceType,
      roundOpened: i.round?.name ?? "No acquisition group",
      oracleText: i.card.oracleText ?? "",
      powerToughness: [i.card.power, i.card.toughness]
        .filter(Boolean)
        .join("/"),
      power: i.card.power ?? "",
      toughness: i.card.toughness ?? "",
      loyalty: i.card.loyalty ?? "",
      defense: i.card.defense ?? "",
      legalities: (i.card.legalities as any) ?? {},
      artist: i.card.artist ?? "",
      collectorNumber: i.card.collectorNumber,
      keywords: Array.isArray(i.card.keywords)
        ? i.card.keywords.join(", ")
        : JSON.stringify(i.card.keywords ?? ""),
      notes: i.notes ?? "",
      condition: i.condition,
      imageUri:
        (i.card.imageUris as any)?.normal ??
        (i.card.imageUris as any)?.small ??
        i.card.imageUri ??
        "",
      imageSmall: (i.card.imageUris as any)?.small ?? "",
      scryfallUri: i.card.scryfallUri ?? "",
      auditHistory: i.auditLogs.map((a) => ({
        id: a.id,
        changeType: a.changeType,
        reason: a.reason ?? "",
        createdAt: a.createdAt.toISOString(),
        changedBy:
          a.changedByUser?.player?.displayName ??
          a.changedByUser?.username ??
          "",
        beforeJson: a.beforeJson as Record<string, unknown>,
        afterJson: a.afterJson as Record<string, unknown>,
      })),
    }))
    .filter((row) => {
      if (colorIdentityNeedle) {
        const colorHaystack = row.colorIdentity.toUpperCase();
        if (!colorHaystack.includes(colorIdentityNeedle)) return false;
      }
      if (keywordNeedle) {
        const keywordHaystack = row.keywords.toLowerCase();
        if (!keywordHaystack.includes(keywordNeedle)) return false;
      }
      const usdPrice = row.priceUsd ? Number(row.priceUsd) : undefined;
      if (
        priceMin !== undefined &&
        (usdPrice === undefined ||
          Number.isNaN(usdPrice) ||
          usdPrice < priceMin)
      )
        return false;
      if (
        priceMax !== undefined &&
        (usdPrice === undefined ||
          Number.isNaN(usdPrice) ||
          usdPrice > priceMax)
      )
        return false;
      return true;
    });

  return (
    <main className="p-8 space-y-4">
      <Nav />
      <h1 className="text-3xl font-bold">Inventory</h1>
      {user ? (
        <section className="border border-zinc-800 rounded p-3 space-y-2">
          <h2 className="font-semibold">Export Inventory</h2>
          <form
            action="/api/inventory/export"
            method="get"
            className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end"
          >
            <input type="hidden" name="cardName" value={p.cardName || ""} />
            <input type="hidden" name="oracleText" value={p.oracleText || ""} />
            <input type="hidden" name="typeLine" value={p.typeLine || ""} />
            <input
              type="hidden"
              name="originalOpenerId"
              value={p.originalOpenerId || ""}
            />
            <input type="hidden" name="set" value={p.set || ""} />
            <input type="hidden" name="rarity" value={p.rarity || ""} />
            <input type="hidden" name="foil" value={p.foil || ""} />
            <input
              type="hidden"
              name="colorIdentity"
              value={p.colorIdentity || ""}
            />
            <input
              type="hidden"
              name="manaValueMin"
              value={p.manaValueMin || ""}
            />
            <input
              type="hidden"
              name="manaValueMax"
              value={p.manaValueMax || ""}
            />
            <input type="hidden" name="keyword" value={p.keyword || ""} />
            <input type="hidden" name="priceMin" value={p.priceMin || ""} />
            <input type="hidden" name="priceMax" value={p.priceMax || ""} />
            <label className="text-sm">
              Format
              <select name="format" className="w-full border p-2 bg-zinc-900">
                <option value="full">MTG Inventory Full CSV</option>
                <option value="moxfield">Moxfield Collection CSV</option>
              </select>
            </label>
            <label className="text-sm">
              Scope
              <select
                name="scope"
                defaultValue="my"
                className="w-full border p-2 bg-zinc-900"
              >
                <option value="filtered">Current filtered view</option>
                <option value="my">My inventory</option>
                {isAdmin ? <option value="all">All inventory</option> : null}
                {isAdmin ? (
                  <option value="owner">Selected current owner</option>
                ) : null}
              </select>
            </label>
            <label className="text-sm">
              Current owner
              <select
                name="ownerId"
                defaultValue={p.ownerId || userWithPlayer?.playerId || ""}
                className="w-full border p-2 bg-zinc-900"
              >
                <option value="">
                  {isAdmin ? "all owners" : "my inventory"}
                </option>
                {players.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Acquisition group
              <select
                name="roundId"
                defaultValue={p.roundId || ""}
                className="w-full border p-2 bg-zinc-900"
              >
                <option value="">all groups</option>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Moxfield foil
              <select
                name="foilFormat"
                className="w-full border p-2 bg-zinc-900"
              >
                <option value="moxfield">foil or blank</option>
                <option value="boolean">true / false</option>
                <option value="text">foil / nonfoil</option>
              </select>
            </label>
            <div className="col-span-2 md:col-span-5">
              <SubmitButton
                pendingLabel="Generating…"
                className="border px-3 py-2"
              >
                Download CSV
              </SubmitButton>
            </div>
          </form>
          <p className="text-xs text-zinc-400">
            Exports are generated server-side. Non-admin users are always
            limited to their own inventory even if a different scope is
            submitted.
          </p>
        </section>
      ) : (
        <p className="rounded border border-zinc-800 p-3 text-sm text-zinc-400">
          Guest mode is read-only. Log in to export inventory or make changes.
        </p>
      )}
      {isAdmin ? (
        <section className="border border-zinc-800 rounded p-3 space-y-2">
          <h2 className="font-semibold">Inventory Maintenance</h2>
          <p className="text-sm text-zinc-400">
            Zero-quantity rows are hidden from inventory. Current zero-quantity
            rows: {zeroQuantityCount}.
          </p>
          <form
            action={cleanupZeroQuantityInventory}
            className="flex flex-wrap gap-2 items-end"
          >
            <label className="text-sm flex-1 min-w-64">
              Cleanup reason
              <input
                name="reason"
                defaultValue="Admin cleanup of zero-quantity inventory items."
                className="w-full border p-2 bg-zinc-900"
              />
            </label>
            <SubmitButton
              pendingLabel="Cleaning up…"
              className="border px-3 py-2"
              disabled={zeroQuantityCount === 0}
            >
              Clean up zero-quantity inventory items
            </SubmitButton>
          </form>
        </section>
      ) : null}
      <details open className="border border-zinc-800 rounded p-3">
        <summary className="cursor-pointer font-semibold">
          Advanced Filters
        </summary>
        <form className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <input
            name="cardName"
            defaultValue={p.cardName}
            placeholder="card name contains"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="oracleText"
            defaultValue={p.oracleText}
            placeholder="oracle text contains"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="typeLine"
            defaultValue={p.typeLine}
            placeholder="type line contains"
            className="border p-2 bg-zinc-900"
          />
          <select
            name="ownerId"
            defaultValue={p.ownerId}
            className="border p-2 bg-zinc-900"
          >
            <option value="">current owner</option>
            {players.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.displayName}
              </option>
            ))}
          </select>
          <select
            name="originalOpenerId"
            defaultValue={p.originalOpenerId}
            className="border p-2 bg-zinc-900"
          >
            <option value="">original opener</option>
            {players.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.displayName}
              </option>
            ))}
          </select>
          <select
            name="roundId"
            defaultValue={p.roundId}
            className="border p-2 bg-zinc-900"
          >
            <option value="">acquisition group</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            name="set"
            defaultValue={p.set}
            placeholder="set"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="rarity"
            defaultValue={p.rarity}
            placeholder="rarity"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="colorIdentity"
            defaultValue={p.colorIdentity}
            placeholder="color identity"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="manaValueMin"
            defaultValue={p.manaValueMin}
            placeholder="mana value min"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="manaValueMax"
            defaultValue={p.manaValueMax}
            placeholder="mana value max"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="keyword"
            defaultValue={p.keyword}
            placeholder="keyword contains"
            className="border p-2 bg-zinc-900"
          />
          <select
            name="foil"
            defaultValue={p.foil}
            className="border p-2 bg-zinc-900"
          >
            <option value="">foil/nonfoil</option>
            <option value="true">foil</option>
            <option value="false">nonfoil</option>
          </select>
          <input
            name="priceMin"
            defaultValue={p.priceMin}
            placeholder="price min"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="priceMax"
            defaultValue={p.priceMax}
            placeholder="price max"
            className="border p-2 bg-zinc-900"
          />
          <div className="col-span-2 flex gap-2">
            <button className="border px-3">Apply</button>
            <a href="/inventory" className="border px-3 py-2">
              Clear Filters
            </a>
          </div>
        </form>
      </details>
      <InventoryBrowser
        rows={rows}
        players={players.map((p) => ({
          id: p.id,
          name: p.displayName,
          color: p.color,
        }))}
        rounds={rounds.map((r) => ({ id: r.id, name: r.name }))}
        cardLabels={cardLabels}
        isAdmin={isAdmin}
        onSaveEdit={onSaveEdit}
        onSearchPrintings={onSearchPrintings}
        onDeleteInventoryItem={deleteInventoryItem}
      />
    </main>
  );
}
