import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  acquisitionTransaction,
  readAcquisitionRow,
  getAcquisitionCardReview,
  type AcquisitionActor,
} from "./acquisition-store";
import {
  pairedSourceFingerprint,
  pairedDecisionSchema,
} from "./paired-scan-policy";
import { isPairedProfile } from "./paired-scan-profile";
import { requireVisibleAcquisitionBatch } from "./acquisition-batch-policy";
import { searchLocalCardCatalog } from "./local-card-search";
import { searchPairedCardsResult } from "./scryfall";
import { upsertScryfallCard } from "./card-import";
import type { Card } from "@prisma/client";
const sourceAllowed = (
  c: Pick<Card, "layout" | "digital" | "scryfallId">,
  profile: string,
) =>
  !!c.scryfallId &&
  c.digital !== true &&
  (profile === "ART"
    ? c.layout === "art_series"
    : ["token", "double_faced_token"].includes(c.layout ?? ""));
export function pairedCatalogChoices(cards: Card[], profile: string) {
  return cards
    .filter((c) => sourceAllowed(c, profile))
    .flatMap((c) => {
      const faces = Array.isArray(c.cardFaces) ? c.cardFaces : [];
      return (profile === "ART" ? [0] : faces.length ? [0, 1] : [0]).flatMap(
        (index) => {
          const face = faces[index] as
            | {
                name?: string;
                type_line?: string;
                image_uris?: { normal?: string };
              }
            | undefined;
          if (
            profile === "TOKEN" &&
            !/^Token\b/.test(face?.type_line ?? c.typeLine)
          )
            return [];
          return [
            {
              cardId: c.id,
              face: index as 0 | 1,
              name: face?.name ?? c.name,
              setCode: c.setCode,
              collectorNumber: c.collectorNumber,
              imageUri: face?.image_uris?.normal ?? c.imageUri,
              backImageUri:
                profile === "ART"
                  ? ((
                      faces[1] as
                        | { image_uris?: { normal?: string } }
                        | undefined
                    )?.image_uris?.normal ?? null)
                  : null,
              language: c.lang,
            },
          ];
        },
      );
    });
}
export async function readPairedScanBatch(
  db: PrismaClient,
  actor: AcquisitionActor,
  batchId: string,
  rawPage: unknown = 0,
) {
  const page = z.coerce.number().int().nonnegative().max(5000).parse(rawPage);
  const state = await acquisitionTransaction(db, async (tx) => {
    const row = await readAcquisitionRow(tx, actor, batchId, {});
    requireVisibleAcquisitionBatch(row);
    if (!isPairedProfile(row.scanProfile))
      throw Error("Use the ordinary scan review for this batch.");
    const candidates = await tx.acquisitionCandidate.findMany({
      where: { runId: row.run!.id },
      include: { receipt: true },
    });
    const retired = candidates
      .filter((c) => c.excluded)
      .map((c) => c.physicalId);
    const slotWhere = { runId: row.run!.id, id: { notIn: retired } };
    const total = await tx.acquisitionCaptureSlot.count({ where: slotWhere });
    const at = Math.min(page, Math.max(0, total - 1));
    const slot = await tx.acquisitionCaptureSlot.findFirst({
      where: slotWhere,
      orderBy: { position: "asc" },
      skip: at,
      include: { photos: true },
    });
    const candidate = slot
      ? await tx.acquisitionCandidate.findUnique({
          where: {
            runId_physicalId: { runId: row.run!.id, physicalId: slot.id },
          },
          include: { receipt: true },
        })
      : null;
    let sourceFingerprint: string | null = null,
      problem = "";
    if (slot)
      try {
        sourceFingerprint = pairedSourceFingerprint(
          row.scanProfile,
          slot.generation,
          slot.pairingEvidence,
          slot.photos,
        );
      } catch (e) {
        problem =
          e instanceof Error && /^(Both|These)/.test(e.message)
            ? e.message
            : "Scanner pairing evidence needs reconciliation.";
      }
    const saved = pairedDecisionSchema.safeParse(
      (candidate?.pairedReview as { decision?: unknown } | null)?.decision,
    );
    const photos =
      slot?.photos
        .filter((p) => p.generation === slot.generation)
        .map((p) => ({
          id: p.id,
          side: p.side,
          ready: p.ready && !p.purgedAt,
          digest: p.digest,
          purged: !!p.purgedAt,
          generation: p.generation,
        })) ?? [];
    const confirmed = await tx.acquisitionCandidate.count({
      where: {
        runId: row.run!.id,
        review: { not: Prisma.DbNull },
        receipt: null,
        ignored: false,
        excluded: false,
      },
    });
    const committed = await tx.acquisitionCommitMember.count({
      where: { runId: row.run!.id },
    });
    const scanner = await tx.scannerRun.findFirst({
      where: { acquisitionRunId: row.run!.id },
      orderBy: { segment: "desc" },
      select: { id: true, status: true, reconciliation: true, outcome: true },
    });
    const repair = await tx.acquisitionCaptureSlot.findMany({
      where: slotWhere,
      include: { photos: true },
      orderBy: { position: "asc" },
    });
    const candidateBySlot = new Map(candidates.map((c) => [c.physicalId, c]));
    const repairSources = repair.flatMap((s) => {
      const c = candidateBySlot.get(s.id);
      return !c || c.receipt || c.ignored
        ? []
        : s.photos
            .filter(
              (p) => p.generation === s.generation && p.ready && !p.purgedAt,
            )
            .map((p) => ({
              photoId: p.id,
              slotId: s.id,
              position: s.position,
              side: p.side,
              digest: p.digest,
              revision: c.revision,
            }));
    });
    const imageCounts = new Map<string, number>();
    for (const source of repairSources)
      imageCounts.set(source.slotId, (imageCounts.get(source.slotId) ?? 0) + 1);
    return {
      id: row.id,
      profile: row.scanProfile as "TOKEN" | "ART",
      batchNumber: row.batchNumber,
      phase: row.phase,
      locationId: row.locationId!,
      section: row.section,
      total,
      page: at,
      confirmed,
      committed,
      defaults: row.reviewDefaults,
      scanner,
      repairSources,
      unresolvedImages: repairSources.filter(
        (p) => imageCounts.get(p.slotId) !== 2,
      ).length,
      item: slot
        ? {
            slotId: slot.id,
            position: slot.position,
            revision: candidate?.revision ?? 0,
            sourceFingerprint,
            problem,
            photos,
            saved: saved.success ? saved.data : null,
            review: candidate?.review ?? null,
            committed: !!candidate?.receipt,
            ignored: !!candidate?.ignored,
          }
        : null,
    };
  });
  const eligible = state.item?.photos.filter((p) => p.ready) ?? [];
  const evidence = await Promise.all(
    eligible.map(async (photo) => {
      const review = await getAcquisitionCardReview(
        db,
        actor,
        batchId,
        photo.id,
      );
      const savedIds =
        state.item?.saved?.profile === "TOKEN"
          ? [state.item.saved.front.cardId, state.item.saved.back.cardId]
          : state.item?.saved?.profile === "ART"
            ? [state.item.saved.cardId]
            : [];
      const ids = [
        ...new Set([
          ...review.suggestions.map((s) => s.printing.id),
          ...savedIds,
        ]),
      ];
      const cards = ids.length
        ? await db.card.findMany({ where: { id: { in: ids } } })
        : [];
      return {
        side: photo.side,
        status: review.recognitionStatus,
        choices: pairedCatalogChoices(cards, state.profile),
      };
    }),
  );
  return { ...state, evidence };
}
export async function searchPairedCatalog(
  db: PrismaClient,
  actor: AcquisitionActor,
  batchId: string,
  raw: unknown,
) {
  const query = z.string().trim().min(2).max(120).parse(raw);
  const row = await acquisitionTransaction(db, (tx) =>
    readAcquisitionRow(tx, actor, batchId, {}),
  );
  requireVisibleAcquisitionBatch(row);
  if (!isPairedProfile(row.scanProfile))
    throw Error("Use ordinary printing search for this batch.");
  const layouts =
    row.scanProfile === "ART"
      ? ["art_series"]
      : ["token", "double_faced_token"];
  let cards = await searchLocalCardCatalog(db, {
    query,
    setCode: query.toLowerCase(),
    limit: 40,
    paperOnly: true,
    externalOnly: true,
    layouts,
  });
  if (!cards.length) {
    const external = await searchPairedCardsResult(
      "(" +
        query +
        ") (" +
        layouts.map((layout) => "layout:" + layout).join(" or ") +
        ") game:paper",
    );
    if (external.ok)
      for (const card of external.data.data.slice(0, 40))
        if (layouts.includes(card.layout ?? "") && !card.digital)
          await upsertScryfallCard(card, db);
    cards = await searchLocalCardCatalog(db, {
      query,
      setCode: query.toLowerCase(),
      limit: 40,
      paperOnly: true,
      externalOnly: true,
      layouts,
    });
  }
  return { choices: pairedCatalogChoices(cards, row.scanProfile) };
}
