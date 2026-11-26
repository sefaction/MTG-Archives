import { Prisma, type PrismaClient } from "@prisma/client";
import { handoffHash, handoffStamp } from "./card-handoff-policy";
import { HandoffError } from "./card-handoffs";
import { buildReservedInventoryQuantities } from "./trade-lines";
import { normalizeInventoryCondition } from "./inventory-condition";
import {
  bulkScopeInput,
  locationIsBulk,
  pullExcluded,
  type BulkScope,
  type PullBrowse,
} from "./pull-scope";
import { bulkDestinations } from "./bulk-locations";
import { buildLocationPathMap } from "./inventory-locations";
import {
  BULK_BOX_TYPE,
  bulkGroupKey,
  excessCounts,
  type BulkSettings,
  type BulkItem,
  type BulkPlan,
  type BulkContext,
} from "./bulk-cleanup-policy";

export type BulkTx = Prisma.TransactionClient;
export async function bulkOwner(tx: BulkTx, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR SHARE`;
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { player: true },
  });
  if (
    !user?.isActive ||
    user.forcePasswordChange ||
    !user.playerId ||
    !user.player?.active
  )
    throw new HandoffError("Sign in with an active inventory account.", 403);
  return { ...user, playerId: user.playerId };
}
export type BulkOwner = Awaited<ReturnType<typeof bulkOwner>>;
export function bulkSettings(user: BulkOwner): BulkSettings {
  const values = {
    enabled: user.bulkCleanupEnabled,
    maxCopies: user.bulkCleanupMaxCopies,
    includeDecks: user.bulkCleanupIncludeDecks,
    revision: user.bulkCleanupRevision,
  };
  return { ...values, stamp: handoffHash([user.id, user.playerId, values]) };
}
const statuses = [
  "PROPOSED",
  "ACCEPTED_PENDING_EXCHANGE",
  "PARTIALLY_COMMITTED",
] as const;
export async function bulkReservations(tx: BulkTx, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  if (ids.length > 2000) {
    const result = new Map<string, number>();
    for (let offset = 0; offset < ids.length; offset += 2000) {
      const slice = ids.slice(offset, offset + 2000),
        part = await bulkReservations(tx, slice);
      // A legacy trade can mention both sides in different chunks. Only take
      // this chunk's IDs; its other-side count must not overwrite modern holds
      // already accumulated for an earlier chunk.
      for (const id of slice) if (part.has(id)) result.set(id, part.get(id)!);
    }
    return result;
  }
  const [lines, legacy] = await Promise.all([
    tx.tradeLine.findMany({
      where: {
        inventoryItemId: { in: ids },
        trade: { status: { in: [...statuses] } },
      },
      select: { inventoryItemId: true, quantity: true },
    }),
    tx.trade.findMany({
      where: {
        status: { in: [...statuses] },
        lines: { none: {} },
        OR: [
          { offeredInventoryItemId: { in: ids } },
          { requestedInventoryItemId: { in: ids } },
        ],
      },
      select: { offeredInventoryItemId: true, requestedInventoryItemId: true },
    }),
  ]);
  return buildReservedInventoryQuantities(lines, legacy);
}
export async function bulkStock(
  tx: BulkTx,
  owner: BulkOwner,
  cardIds?: string[],
  scope?: BulkScope,
) {
  const [stock, locations] = await Promise.all([
    tx.inventoryItem.findMany({
      where: {
        currentOwnerId: owner.playerId,
        quantity: { gt: 0 },
        ...(cardIds ? { cardId: { in: cardIds } } : {}),
      },
      include: {
        card: {
          select: {
            name: true,
            setCode: true,
            collectorNumber: true,
            imageUri: true,
          },
        },
      },
    }),
    tx.inventoryLocation.findMany({ where: { ownerPlayerId: owner.playerId } }),
  ]);
  const paths = buildLocationPathMap(locations),
    byId = new Map(locations.map((row) => [row.id, row]));
  // Hash geometry once per location, rather than serializing a potentially
  // hundred-section layout again for every physical inventory lot.
  const locationStamps = new Map(
    locations.map((row) => [row.id, handoffHash(row)]),
  );
  const holds = await bulkReservations(
    tx,
    stock.map((row) => row.id),
  );
  const settings = bulkSettings(owner);
  type Group = {
    loose: number;
    deck: number;
    rows: typeof stock;
    stamp: string;
  };
  const groups = new Map<string, Group>();
  const isDeck = (id: string | null) => {
    const l = id ? byId.get(id) : null;
    return l?.kind === "DECK" || l?.systemManaged || l?.type === "Deck";
  };
  const safeLocation = (id: string | null): boolean => {
    const seen = new Set<string>();
    while (id) {
      if (seen.has(id)) return false;
      seen.add(id);
      const l = byId.get(id);
      if (
        !l?.active ||
        l.ownerPlayerId !== owner.playerId ||
        l.kind !== "NORMAL" ||
        l.systemManaged ||
        l.type === "Deck"
      )
        return false;
      id = l.parentLocationId;
    }
    return true;
  };
  for (const row of stock) {
    if (
      row.locationId &&
      !isDeck(row.locationId) &&
      locationIsBulk(row.locationId, byId)
    )
      continue;
    const key = bulkGroupKey(row.cardId, row.foilStatus, row.language);
    const group = groups.get(key) ?? { loose: 0, deck: 0, rows: [], stamp: "" };
    group[isDeck(row.locationId) ? "deck" : "loose"] += row.quantity;
    group.rows.push(row);
    groups.set(key, group);
  }
  if (
    !cardIds &&
    scope?.held?.some(
      (pin) =>
        !stock.some(
          (row) =>
            row.id === pin.id &&
            !locationIsBulk(row.locationId, byId) &&
            handoffStamp(row) === pin.stamp,
        ),
    )
  )
    throw new HandoffError(
      "A pulled stack changed. Clear its pulled mark and re-evaluate.",
    );
  const items: BulkItem[] = [];
  let protectedCopies = 0;
  const severity = (value: string) =>
    ["DMG", "HP", "MP", "LP", "NM"].indexOf(normalizeInventoryCondition(value));
  for (const [key, group] of groups) {
    group.rows.sort((a, b) => a.id.localeCompare(b.id));
    group.stamp = handoffHash([
      settings.stamp,
      group.rows.map((row) => [
        handoffStamp(row),
        holds.get(row.id) ?? 0,
        row.locationId ? (locationStamps.get(row.locationId) ?? null) : null,
      ]),
    ]);
    const counts = excessCounts(
      group.loose,
      group.deck,
      settings.maxCopies,
      settings.includeDecks,
    );
    let remaining = counts.existingExcess;
    const eligible = group.rows.filter(
      (row) =>
        !isDeck(row.locationId) &&
        safeLocation(row.locationId) &&
        !row.roundId &&
        !row.acquiredFromPullId,
    );
    const held = scope?.held ?? [];
    for (const pin of held.filter((pin) =>
      group.rows.some((row) => row.id === pin.id),
    )) {
      const row = eligible.find((row) => row.id === pin.id);
      if (
        !row ||
        handoffStamp(row) !== pin.stamp ||
        pin.quantity > row.quantity - (holds.get(row.id) ?? 0) ||
        pin.quantity > remaining
      )
        throw new HandoffError(
          "A physically pulled copy changed. Unmark it and re-evaluate cleanup.",
        );
    }
    const groupHeld = held.filter((pin) =>
      group.rows.some((row) => row.id === pin.id),
    );
    if (groupHeld.reduce((n, pin) => n + pin.quantity, 0) > remaining)
      throw new HandoffError(
        "Pulled copies exceed current excess. Unmark and re-evaluate.",
      );
    const unspentHeld = new Map(groupHeld.map((pin) => [pin.id, pin.quantity]));
    const available = eligible.filter(
      (row) =>
        held.some((pin) => pin.id === row.id) ||
        !pullExcluded(scope, row.id, row.locationId, row.locationSection, byId),
    );
    available.sort(
      (a, b) =>
        Number(held.some((pin) => pin.id === b.id)) -
          Number(held.some((pin) => pin.id === a.id)) ||
        severity(a.condition) - severity(b.condition) ||
        (paths.get(a.locationId ?? "") ?? "").localeCompare(
          paths.get(b.locationId ?? "") ?? "",
        ) ||
        (a.locationSection ?? "").localeCompare(b.locationSection ?? "") ||
        a.id.localeCompare(b.id),
    );
    eligible.sort(
      (a, b) =>
        severity(a.condition) - severity(b.condition) ||
        (paths.get(a.locationId ?? "") ?? "").localeCompare(
          paths.get(b.locationId ?? "") ?? "",
        ) ||
        (a.locationSection ?? "").localeCompare(b.locationSection ?? "") ||
        a.id.localeCompare(b.id),
    );
    for (const row of available) {
      unspentHeld.delete(row.id);
      const reservedHeld = [...unspentHeld.values()].reduce((n, q) => n + q, 0);
      const pin = held.find((pin) => pin.id === row.id);
      const availableQuantity = pullExcluded(
        scope,
        row.id,
        row.locationId,
        row.locationSection,
        byId,
      )
        ? (pin?.quantity ?? 0)
        : row.quantity - (holds.get(row.id) ?? 0);
      const quantity = Math.min(
        Math.max(0, remaining - reservedHeld),
        Math.max(0, availableQuantity),
      );
      if (!quantity) continue;
      remaining -= quantity;
      items.push({
        id: row.id,
        cardId: row.cardId,
        locationId: row.locationId ?? "unassigned",
        pulledQuantity: held.find((pin) => pin.id === row.id)?.quantity ?? 0,
        group: key,
        groupStamp: group.stamp,
        stamp: handoffStamp(row),
        quantity,
        name: row.card.name,
        setCode: row.card.setCode,
        collectorNumber: row.card.collectorNumber,
        finish: row.foilStatus,
        condition: row.condition,
        language: row.language,
        location: paths.get(row.locationId ?? "") ?? "Unassigned",
        section: row.locationSection,
        imageUri: row.card.imageUri,
        owned: group.loose,
        deckCopies: group.deck,
        existingExcess: counts.existingExcess,
        pendingKept: 0,
      });
    }
    protectedCopies += remaining;
  }
  items.sort(
    (a, b) =>
      a.location.localeCompare(b.location) ||
      (a.section ?? "").localeCompare(b.section ?? "") ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  return { items, groups, stock, protectedCopies };
}

type Pending = {
  id: string;
  runId: string;
  batchId: string;
  batchNumber: number;
  position: number;
  photoId: string;
  digest: string;
  generation: number;
  revision: number;
  cardId: string;
  finish: string;
  language: string;
  condition: string;
  rank: bigint;
  pending: bigint;
};
export async function bulkScans(tx: BulkTx, owner: BulkOwner, batchId: string) {
  const batch = await tx.acquisitionSession.findFirst({
    where: {
      id: batchId,
      ownerPlayerId: owner.playerId,
      trashedAt: null,
      deletedAt: null,
      cancelledAt: null,
      phase: { not: "CANCELLED" },
      intent: "ADD_NEW",
    },
  });
  if (!batch)
    throw new HandoffError(
      "This batch is unavailable for your personal cleanup.",
      403,
    );
  // Windowing happens before the current-batch filter: confirmed scans in other
  // batches consume the allowance, but this action never returns their photos.
  const pending = await tx.$queryRaw<Pending[]>(Prisma.sql`
    WITH pending AS (
      SELECT c.id, c."runId", s.id AS "batchId", s.phase, s."batchNumber", slot.position,
        p.id AS "photoId", p.digest, p.generation, c.revision,
        c.review->>'cardId' AS "cardId", c.review->>'finish' AS finish,
        upper(trim(c.review->>'language')) AS language, c.review->>'condition' AS condition,
        row_number() OVER w AS rank, count(*) OVER (PARTITION BY c.review->>'cardId', c.review->>'finish', upper(trim(c.review->>'language'))) AS pending
      FROM "AcquisitionCandidate" c
      JOIN "AcquisitionRun" r ON r.id=c."runId"
      JOIN "AcquisitionSession" s ON s.id=r."sessionId"
      JOIN "AcquisitionCaptureSlot" slot ON slot.id=c."physicalId" AND slot."runId"=r.id
      JOIN "AcquisitionPhoto" p ON p."slotId"=slot.id AND p.generation=slot.generation AND p.ready AND p."purgedAt" IS NULL
      LEFT JOIN "AcquisitionCommitMember" receipt ON receipt."candidateId"=c.id
      WHERE s."ownerPlayerId"=${owner.playerId} AND s."trashedAt" IS NULL AND s."deletedAt" IS NULL
        AND s."cancelledAt" IS NULL AND s.phase <> 'CANCELLED' AND s.intent='ADD_NEW'
        AND NOT c.excluded AND NOT c.ignored AND c."countConfirmed"
        AND receipt."candidateId" IS NULL AND c.review->>'cardId' IS NOT NULL
        AND c.review->>'finish' IN ('NONFOIL','FOIL','ETCHED')
        AND c.review->>'condition' IN ('NM','LP','MP','HP','DMG')
        AND length(trim(c.review->>'language')) BETWEEN 2 AND 20
      WINDOW w AS (PARTITION BY c.review->>'cardId', c.review->>'finish', upper(trim(c.review->>'language')) ORDER BY s."createdAt",s.id,c."acquisitionOrder",c."spatialOrder",c.id)
    ) SELECT * FROM pending WHERE "batchId"=${batchId} AND phase IN ('STOPPING','COMPLETE') ORDER BY position,id`);
  const cardIds = [...new Set(pending.map((row) => row.cardId))];
  const [{ groups }, cards] = await Promise.all([
    bulkStock(tx, owner, cardIds),
    tx.card.findMany({
      where: { id: { in: cardIds } },
      select: { id: true, name: true, setCode: true, collectorNumber: true },
    }),
  ]);
  const byId = new Map(cards.map((card) => [card.id, card])),
    settings = bulkSettings(owner);
  const items: BulkItem[] = [];
  for (const row of pending) {
    const key = bulkGroupKey(row.cardId, row.finish, row.language),
      group = groups.get(key),
      card = byId.get(row.cardId);
    if (!card) continue;
    const loose = group?.loose ?? 0,
      deck = group?.deck ?? 0;
    const counts = excessCounts(
      loose,
      deck,
      settings.maxCopies,
      settings.includeDecks,
    );
    if (Number(row.rank) <= counts.scanAllowance) continue;
    const groupStamp = handoffHash([
      settings.stamp,
      group?.stamp ?? null,
      Number(row.pending),
    ]);
    items.push({
      id: row.photoId,
      group: key,
      groupStamp,
      stamp: handoffHash({
        ...row,
        rank: String(row.rank),
        pending: String(row.pending),
      }),
      quantity: 1,
      name: card.name,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      finish: row.finish,
      language: row.language,
      condition: row.condition,
      location: "Current batch",
      section: null,
      imageUri: `/api/acquisition/${batchId}/photos/${row.photoId}?preview=1`,
      position: row.position + 1,
      batchNumber: row.batchNumber,
      owned: loose,
      deckCopies: deck,
      existingExcess: counts.existingExcess,
      pendingKept: Math.min(Number(row.pending), counts.scanAllowance),
    });
  }
  return { items, pending, batch, protectedCopies: 0 };
}
export function bulkPage(
  items: BulkItem[],
  page = 1,
  protectedCopies = 0,
  pageSize = 100,
): BulkPlan {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  page = Math.max(1, Math.min(pages, Math.floor(page) || 1));
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pages,
    totalItems: items.length,
    totalCopies: items.reduce((sum, row) => sum + row.quantity, 0),
    groups: new Set(items.map((row) => row.group)).size,
    protectedCopies,
  };
}
export function getBulkContext(
  db: PrismaClient,
  userId: string,
  input: {
    batchId?: string;
    page?: number;
    scope?: BulkScope;
    browse?: PullBrowse;
  } = {},
): Promise<BulkContext> {
  return db.$transaction(
    async (tx) => {
      const actor = await bulkOwner(tx, userId),
        settings = bulkSettings(actor);
      if (!settings.enabled)
        return { actorId: actor.id, enabled: false, settings };
      // Admin mode never expands this personal feature's owner scope.
      if (
        input.batchId &&
        !(await tx.acquisitionSession.findFirst({
          where: { id: input.batchId, ownerPlayerId: actor.playerId },
        }))
      )
        return { actorId: actor.id, enabled: false, settings };
      const data = input.batchId
        ? await bulkScans(tx, actor, input.batchId)
        : await bulkStock(tx, actor, undefined, input.scope);
      const [history, recipients] = input.batchId
        ? [[], []]
        : await Promise.all([
            tx.bulkCleanupAction.findMany({
              where: { actorUserId: userId, ownerPlayerId: actor.playerId },
              orderBy: { createdAt: "desc" },
              take: 20,
            }),
            tx.player.findMany({
              where: {
                active: true,
                id: { not: actor.playerId },
                users: { some: { isActive: true } },
              },
              select: { id: true, displayName: true },
              orderBy: { displayName: "asc" },
            }),
          ]);
      const browse = input.browse;
      const visible = browse
        ? data.items
            .filter(
              (row) =>
                (!browse.locationId || row.locationId === browse.locationId) &&
                [
                  row.name,
                  row.setCode,
                  row.collectorNumber,
                  row.location,
                  row.section,
                  row.finish,
                ].some((value) =>
                  String(value ?? "")
                    .toLowerCase()
                    .includes(browse.search.trim().toLowerCase()),
                ),
            )
            .sort((a, b) => {
              const order =
                browse.sort === "quantity"
                  ? a.quantity - b.quantity
                  : browse.sort === "name"
                    ? a.name.localeCompare(b.name, undefined, { numeric: true })
                    : `${a.location} ${a.section ?? ""} ${a.name}`.localeCompare(
                        `${b.location} ${b.section ?? ""} ${b.name}`,
                        undefined,
                        { numeric: true },
                      );
              return (browse.desc ? -order : order) || a.id.localeCompare(b.id);
            })
        : data.items;
      const boxes = await bulkDestinations(tx, actor.playerId);
      return {
        actorId: actor.id,
        enabled: true,
        settings,
        scope: input.scope,
        marked: input.batchId
          ? []
          : data.items.filter((row) => (row.pulledQuantity ?? 0) > 0),
        ...(boxes
          ? { locations: boxes.locations, destinations: boxes.destinations }
          : {}),
        plan: bulkPage(
          visible,
          input.page,
          data.protectedCopies,
          browse?.pageSize,
        ),
        history: history.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          result: row.resultJson as unknown as NonNullable<
            BulkContext["history"]
          >[number]["result"],
        })),
        recipients: recipients.map((row) => ({
          id: row.id,
          name: row.displayName,
        })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 30000 },
  );
}
