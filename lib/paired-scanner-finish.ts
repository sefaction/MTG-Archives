import { Prisma } from "@prisma/client";
import { z } from "zod";
import { scannerRunOutcomeSchema } from "./scanner-run-protocol";
import { pairedSourceFingerprint } from "./paired-scan-policy";
type Run = Prisma.ScannerRunGetPayload<{
  include: { acquisitionRun: { include: { session: true } } };
}>;
export async function finishPairedScannerRun(
  tx: Prisma.TransactionClient,
  run: Run,
  photos: Prisma.AcquisitionPhotoGetPayload<{ include: { slot: true } }>[],
  outcome: z.infer<typeof scannerRunOutcomeSchema>,
  actorId: string,
) {
  const sequences = photos
    .map((p) => (p.sourceMetadata as { sequence?: number } | null)?.sequence)
    .sort((a, b) => (a ?? 0) - (b ?? 0));
  if (
    photos.length !== outcome.imageCount ||
    photos.some((p) => !p.ready) ||
    sequences.some((v, i) => v !== i + 1)
  )
    throw Error(
      "Capture scanner side uploads need reconciliation before completion.",
    );
  const groups = new Map<string, typeof photos>();
  for (const photo of photos) {
    const group = groups.get(photo.slotId) ?? [];
    group.push(photo);
    groups.set(photo.slotId, group);
  }
  let complete = true;
  for (const images of groups.values())
    try {
      pairedSourceFingerprint(
        run.acquisitionRun.session.scanProfile,
        images[0].slot.generation,
        images[0].slot.pairingEvidence,
        images,
      );
    } catch {
      complete = false;
    }
  const clean =
    complete &&
    !outcome.nativeError &&
    ["COMPLETED", "SOURCE_EXHAUSTED"].includes(outcome.outcome) &&
    photos.length <= 2 * run.physicalTarget! &&
    (photos.length === 2 * run.physicalTarget! ||
      outcome.sourceExhausted === "REPORTED_EMPTY");
  if (!run.outcome && clean) {
    for (const slotId of groups.keys())
      await tx.acquisitionCandidate.updateMany({
        where: {
          runId: run.acquisitionRunId,
          physicalId: slotId,
          countConfirmed: false,
          excluded: false,
          ignored: false,
        },
        data: { countConfirmed: true, revision: { increment: 1 } },
      });
  }
  const status = clean ? "DRAINED" : "ERROR";
  await tx.scannerRun.update({
    where: { id: run.id },
    data: {
      status,
      outcome,
      ...(clean
        ? {
            reconciliation: {
              mode: "PAIRED_SCANNER_SHEET_METADATA",
              actorUserId: actorId,
              physicalItems: groups.size,
              imageCount: photos.length,
              observedAt: new Date().toISOString(),
              basis: "NATIVE_EXECUTION_DOCUMENT_PAPERCOUNT_PAGESIDE",
            },
          }
        : {}),
    },
  });
  if (!run.outcome)
    await tx.acquisitionSession.update({
      where: { id: run.acquisitionRun.sessionId },
      data: {
        phase: run.acquisitionRun.session.cancelledAt
          ? "CANCELLED"
          : clean
            ? "COMPLETE"
            : "STOPPING",
        scannerReserved: groups.size,
        revision: { increment: 1 },
      },
    });
  return {
    version: 1,
    runId: run.id,
    status,
    physicalCount: clean ? "NATIVE_PAIRED_SHEETS" : "UNCONFIRMED",
  };
}
