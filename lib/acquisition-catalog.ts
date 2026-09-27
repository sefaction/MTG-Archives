import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { isAdminUser } from "./auth-policy";
import { cardWriteData } from "./card-import";
import type { ScryfallCard } from "./scryfall";
import type { AcquisitionActor } from "./acquisition-store";

export const acquisitionCatalogSourceSchema = z
  .object({
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceType: z.literal("scryfall-default-jsonl-gzip-v1"),
    sourceUpdatedAt: z.coerce.date(),
    sourceBytes: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024 * 1024),
    expectedRows: z.number().int().positive().max(2000000),
  })
  .strict();
// Validate structural values before they reach the shared normalizer. Optional
// Scryfall fields remain intact; no second catalog or card-ID replacement.
export const acquisitionCatalogCardSchema = z
  .object({
    object: z.literal("card"),
    id: z.string().uuid(),
    name: z.string().min(1).max(500),
    set: z.string().min(1).max(30),
    set_name: z.string().min(1).max(500),
    collector_number: z.string().min(1).max(100),
    rarity: z.string().min(1),
    cmc: z.number().finite().optional(),
    color_identity: z.array(z.string()),
    lang: z.string().min(1).max(20),
  })
  .passthrough();
async function authorize(
  tx: Prisma.TransactionClient,
  actor: AcquisitionActor,
) {
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    include: { player: true },
  });
  if (
    !actor.adminMode ||
    !user?.isActive ||
    user.forcePasswordChange ||
    !isAdminUser(user, user.player)
  )
    throw new Error(
      "Catalog maintenance requires an active administrator in Admin Mode",
    );
}
async function locked<T>(
  db: PrismaClient,
  actor: AcquisitionActor,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      // All refreshes serialize one bounded batch, not the entire file. A second
      // caller re-reads the durable cursor after the previous writer commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('mtg-acquisition-catalog-refresh',0))`;
      await authorize(tx, actor);
      return work(tx);
    },
    { maxWait: 10000, timeout: 60000 },
  );
}
export async function beginAcquisitionCatalog(
  db: PrismaClient,
  actor: AcquisitionActor,
  raw: unknown,
) {
  const input = acquisitionCatalogSourceSchema.parse(raw);
  return locked(db, actor, async (tx) => {
    const previous = await tx.acquisitionCatalogRefresh.findUnique({
      where: { sourceDigest: input.sourceDigest },
    });
    if (previous) {
      if (
        previous.sourceType !== input.sourceType ||
        previous.sourceUpdatedAt.getTime() !==
          input.sourceUpdatedAt.getTime() ||
        previous.sourceBytes !== BigInt(input.sourceBytes) ||
        previous.expectedRows !== input.expectedRows
      )
        throw new Error("Catalog source metadata conflicts with its digest");
      return previous;
    }
    return tx.acquisitionCatalogRefresh.create({
      data: { ...input, requestedByUserId: actor.userId },
    });
  });
}
export async function applyAcquisitionCatalogBatch(
  db: PrismaClient,
  actor: AcquisitionActor,
  refreshId: string,
  offset: number,
  rawCards: unknown[],
) {
  z.number().int().nonnegative().parse(offset);
  const cards = z
    .array(acquisitionCatalogCardSchema)
    .min(1)
    .max(256)
    .parse(rawCards) as ScryfallCard[];
  if (new Set(cards.map((c) => c.id)).size !== cards.length)
    throw new Error("Duplicate card identity within catalog batch");
  return locked(db, actor, async (tx) => {
    const run = await tx.acquisitionCatalogRefresh.findUniqueOrThrow({
      where: { id: refreshId },
    });
    if (offset + cards.length <= run.processedRows)
      return { run, replay: true };
    if (
      run.status === "COMPLETE" ||
      offset !== run.processedRows ||
      offset + cards.length > run.expectedRows
    )
      throw new Error("Catalog cursor changed; resume from durable progress");
    const existing = await tx.card.findMany({
      where: { scryfallId: { in: cards.map((c) => c.id) } },
      select: {
        id: true,
        scryfallId: true,
        scryfallFingerprint: true,
        lastSyncedAt: true,
      },
    });
    const byId = new Map(existing.map((c) => [c.scryfallId, c]));
    const create: Prisma.CardCreateManyInput[] = [];
    let updated = 0,
      preserved = 0;
    for (const card of cards) {
      const data = cardWriteData(card) as Omit<
        Prisma.CardCreateManyInput,
        "scryfallId"
      >;
      const previous = byId.get(card.id);
      // A historical bulk retry must not overwrite a fresher direct fetch.
      if (
        previous &&
        (previous.scryfallFingerprint === data.scryfallFingerprint ||
          (previous.lastSyncedAt &&
            previous.lastSyncedAt > run.sourceUpdatedAt))
      ) {
        preserved++;
        continue;
      }
      const write = { ...data, lastSyncedAt: run.sourceUpdatedAt };
      if (previous) {
        const changed = await tx.card.updateMany({
          where: {
            id: previous.id,
            scryfallFingerprint: previous.scryfallFingerprint,
            OR: [
              { lastSyncedAt: null },
              { lastSyncedAt: { lte: run.sourceUpdatedAt } },
            ],
          },
          data: write,
        });
        updated += changed.count;
        preserved += 1 - changed.count;
      } else create.push({ ...write, scryfallId: card.id });
    }
    // A concurrent direct fetch can win an insertion. Skipping it preserves its
    // identity/relationships; this refresh records that row as preserved.
    const inserted = create.length
      ? (await tx.card.createMany({ data: create, skipDuplicates: true })).count
      : 0;
    preserved += create.length - inserted;
    const next = await tx.acquisitionCatalogRefresh.update({
      where: { id: run.id },
      data: {
        processedRows: { increment: cards.length },
        createdCards: { increment: inserted },
        updatedCards: { increment: updated },
        preservedCards: { increment: preserved },
        status: "RUNNING",
        errorCode: null,
      },
    });
    return { run: next, replay: false };
  });
}
export async function finishAcquisitionCatalog(
  db: PrismaClient,
  actor: AcquisitionActor,
  refreshId: string,
  verifiedDigest: string,
) {
  return locked(db, actor, async (tx) => {
    const run = await tx.acquisitionCatalogRefresh.findUniqueOrThrow({
      where: { id: refreshId },
    });
    if (
      run.sourceDigest !== verifiedDigest ||
      run.processedRows !== run.expectedRows
    )
      throw new Error("Catalog source is incomplete or changed");
    if (run.status === "COMPLETE") return run;
    return tx.acquisitionCatalogRefresh.update({
      where: { id: run.id },
      data: { status: "COMPLETE", completedAt: new Date(), errorCode: null },
    });
  });
}
