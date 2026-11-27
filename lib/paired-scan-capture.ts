import { Prisma } from "@prisma/client";
import {
  pairedEvidenceSchema,
  assertPairedPhotoBinding,
} from "./paired-scan-policy";
import {
  capturedScanSideSchema,
  unpairedEvidenceSchema,
  type ScanSide,
} from "./paired-scan-profile";
import { scannerCanonical } from "./scanner-run-protocol";
type PhotoInput = {
  slotId: string;
  uploadKey: string;
  generation: number;
  metadata: {
    digest: string;
    bytes: number;
    mediaType: string;
    width: number;
    height: number;
  };
  inputKind?: "PHOTO" | "CARD_SCAN";
  sourceMetadata?: Prisma.InputJsonObject;
  side?: ScanSide | "UNKNOWN";
};
export async function beginPairedPhoto(
  tx: Prisma.TransactionClient,
  row: { run: { id: string } | null; scanProfile: string },
  input: PhotoInput,
  accepting: boolean,
) {
  const side = capturedScanSideSchema.parse(input.side);
  const slot = await tx.acquisitionCaptureSlot.findUniqueOrThrow({
    where: { id: input.slotId },
  });
  if (slot.runId !== row.run?.id) throw Error("Pair unavailable.");
  const prior = await tx.acquisitionPhoto.findUnique({
    where: {
      runId_uploadKey: { runId: slot.runId, uploadKey: input.uploadKey },
    },
  });
  if (prior) {
    if (
      (prior.captureSlotId ?? prior.slotId) !== slot.id ||
      (prior.captureGeneration ?? prior.generation) !== input.generation ||
      ((prior.sourceMetadata as { side?: string } | null)?.side ??
        prior.side) !== (input.sourceMetadata?.side ?? side) ||
      prior.digest !== input.metadata.digest ||
      prior.bytes !== input.metadata.bytes ||
      scannerCanonical(prior.sourceMetadata) !==
        scannerCanonical(input.sourceMetadata ?? null)
    )
      throw Error("Paired upload identity conflict.");
    return prior;
  }
  const native = pairedEvidenceSchema.safeParse(slot.pairingEvidence);
  const unpaired = native.success
    ? null
    : unpairedEvidenceSchema.parse(slot.pairingEvidence);
  const candidate = await tx.acquisitionCandidate.findUnique({
    where: { runId_physicalId: { runId: slot.runId, physicalId: slot.id } },
    include: { receipt: true },
  });
  if (
    !accepting ||
    candidate?.receipt ||
    candidate?.ignored ||
    candidate?.excluded
  )
    throw Error("Pair is not accepting new images.");
  if (slot.generation !== input.generation || slot.generation < 1)
    throw Error("Pair generation changed. Retake both sides explicitly.");
  // Bind before writing either side. A second image can never silently replace an accepted side.
  const probe = {
    id: input.uploadKey,
    side,
    generation: input.generation,
    digest: input.metadata.digest,
    ready: true,
    purgedAt: null,
    sourceMetadata: input.sourceMetadata,
  };
  if (native.success) assertPairedPhotoBinding(native.data, probe);
  else {
    const metadata = input.sourceMetadata;
    if (
      side !== "UNKNOWN" ||
      !["UNKNOWN", "FRONT", "BACK"].includes(String(metadata?.side)) ||
      !["UNKNOWN", "SCANNER_SHEET"].includes(
        String(metadata?.physicalBoundary),
      ) ||
      metadata?.runId !== unpaired!.runId ||
      metadata?.executionId !== unpaired!.executionId ||
      metadata?.artifactId !== unpaired!.artifactId
    )
      throw Error("Capture unpaired image source changed.");
  }
  if (
    await tx.acquisitionPhoto.findUnique({
      where: {
        slotId_generation_side: {
          slotId: slot.id,
          generation: slot.generation,
          side,
        },
      },
    })
  )
    throw Error(
      "This side is already reserved. Retry its existing upload or retake the complete pair.",
    );
  return tx.acquisitionPhoto.create({
    data: {
      runId: slot.runId,
      slotId: slot.id,
      uploadKey: input.uploadKey,
      generation: slot.generation,
      captureSlotId: slot.id,
      captureGeneration: slot.generation,
      side,
      ...input.metadata,
      inputKind: input.inputKind ?? "CARD_SCAN",
      sourceMetadata: input.sourceMetadata,
    },
  });
}
