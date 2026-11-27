import { createHash } from "node:crypto";
import { z } from "zod";
import {
  artStampSchema,
  pairedProfileSchema,
  scanSideSchema,
  operatorPairEvidenceSchema,
} from "./paired-scan-profile";
function canonical(value: unknown): string {
  if (value === undefined) throw Error("Source metadata is unavailable.");
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => JSON.stringify(key) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const pairedMetadataHash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const hash = pairedMetadataHash;
export { pairedSheetSchema, pairedEvidenceSchema } from "./paired-scan-profile";
import { pairedSheetSchema, pairedEvidenceSchema } from "./paired-scan-profile";
export function pairedSheetKey(raw: unknown) {
  return "paired-sheet:" + hash(pairedEvidenceSchema.parse(raw));
}
export const pairedFaceChoiceSchema = z
  .object({
    cardId: z.string().min(1).max(200),
    face: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();
export const pairedDecisionSchema = z.discriminatedUnion("profile", [
  z
    .object({
      profile: z.literal("TOKEN"),
      front: pairedFaceChoiceSchema,
      back: pairedFaceChoiceSchema,
    })
    .strict(),
  z
    .object({
      profile: z.literal("ART"),
      cardId: z.string().min(1).max(200),
      artworkSide: scanSideSchema,
      stamp: artStampSchema,
    })
    .strict(),
]);
export type PairedDecision = z.infer<typeof pairedDecisionSchema>;
export type SourceFaceCard = {
  id: string;
  scryfallId: string | null;
  applicationIdentityKey?: string | null;
  name: string;
  layout: string | null;
  typeLine: string;
  setCode: string;
  collectorNumber: string;
  cardFaces: unknown;
  imageUri: string | null;
  digital?: boolean | null;
  lang?: string | null;
  finishes?: unknown;
  artist?: string | null;
  illustrationId?: string | null;
};
type FaceData = {
  name: string;
  type_line: string;
  image_uris?: Record<string, string>;
  mana_cost?: string;
  oracle_text?: string;
  artist?: string;
  illustration_id?: string;
  [key: string]: unknown;
};
export type IdentityFace = {
  key: string;
  sourceCardId: string;
  sourceFace: 0 | 1;
  name: string;
  setCode: string;
  collectorNumber: string;
  snapshot: FaceData;
};
function catalogFace(card: SourceFaceCard, index: 0 | 1): IdentityFace {
  const catalogId = z.string().uuid().parse(card.scryfallId);
  if (card.applicationIdentityKey || card.digital === true)
    throw Error("Choose a paper catalog printing for each face.");
  const faces = Array.isArray(card.cardFaces) ? card.cardFaces : [];
  if (index >= Math.max(1, faces.length) || faces.length > 2)
    throw Error("Choose an existing catalog face.");
  const face = (faces[index] ?? {
    name: card.name,
    type_line: card.typeLine,
    image_uris: card.imageUri ? { normal: card.imageUri } : undefined,
  }) as FaceData;
  if (
    !face ||
    typeof face.name !== "string" ||
    typeof face.type_line !== "string"
  )
    throw Error("Catalog face is incomplete.");
  return {
    key: catalogId + ":" + index,
    sourceCardId: card.id,
    sourceFace: index,
    name: face.name,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    snapshot: face,
  };
}
export function tokenFace(card: SourceFaceCard, index: 0 | 1): IdentityFace {
  if (
    !["token", "double_faced_token"].includes(card.layout ?? "") ||
    !/^Token\b/i.test(
      (Array.isArray(card.cardFaces)
        ? (card.cardFaces[index] as FaceData)?.type_line
        : card.typeLine) ?? "",
    )
  )
    throw Error(
      "Both sides must be identified token faces. Keep non-token or unknown backs unresolved.",
    );
  return catalogFace(card, index);
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function tokenPairIdentity(a: IdentityFace, b: IdentityFace) {
  const keys = [a.key, b.key].sort(compare);
  const faces = [a, b].sort(
    (x, y) =>
      compare(
        x.name.normalize("NFKC").toLocaleLowerCase("en"),
        y.name.normalize("NFKC").toLocaleLowerCase("en"),
      ) || compare(x.key, y.key),
  );
  return {
    key: "token-pair-v1:" + hash(keys),
    kind: "TOKEN_PAIR",
    name: faces.map((f) => f.name).join(" // "),
    faces,
  };
}
export function artCardIdentity(card: SourceFaceCard, stamp: unknown) {
  const variant = artStampSchema.parse(stamp);
  if (card.layout !== "art_series")
    throw Error(
      "Choose the art-series printing, not the depicted playable card.",
    );
  const front = catalogFace(card, 0),
    back = catalogFace(card, 1);
  const label = {
    UNSTAMPED: "Unstamped",
    GOLD_SIGNATURE: "Gold signature",
    GOLD_PLANESWALKER: "Gold Planeswalker stamp",
    OTHER_STAMP: "Other stamp",
  }[variant];
  return {
    key: "art-variant-v1:" + hash([card.scryfallId, variant]),
    kind: "ART_" + variant,
    name: front.name + " [Art card - " + label + "]",
    faces: [front, back],
  };
}
export type PairSourcePhoto = {
  id: string;
  side: string;
  generation: number;
  digest: string;
  ready: boolean;
  purgedAt: Date | null;
  sourceMetadata: unknown;
};
export function pairedSourceFingerprint(
  profile: string,
  generation: number,
  evidence: unknown,
  photos: PairSourcePhoto[],
) {
  pairedProfileSchema.parse(profile);
  const operator = operatorPairEvidenceSchema.safeParse(evidence);
  const binding = operator.success
    ? operator.data
    : pairedEvidenceSchema.parse(evidence);
  const current = photos.filter((p) => p.generation === generation);
  if (
    current.length !== 2 ||
    new Set(current.map((p) => p.side)).size !== 2 ||
    !current.some((p) => p.side === "FRONT") ||
    !current.some((p) => p.side === "BACK")
  )
    throw Error("Both sides of this physical item must be captured.");
  if (operator.success) {
    for (const photo of current) {
      const source = operator.data.sources.find(
        (source) => source.photoId === photo.id && source.side === photo.side,
      );
      if (
        !photo.ready ||
        photo.purgedAt ||
        !source ||
        source.digest !== photo.digest ||
        source.metadataHash !== pairedMetadataHash(photo.sourceMetadata)
      )
        throw Error(
          "These operator-paired source images changed. Review the pair again.",
        );
    }
  } else
    for (const photo of current)
      assertPairedPhotoBinding(pairedEvidenceSchema.parse(binding), photo);
  return hash({
    version: 1,
    profile,
    generation,
    binding,
    photos: current
      .sort((a, b) => compare(a.side, b.side))
      .map((p) => ({ id: p.id, side: p.side, digest: p.digest })),
  });
}

export function assertPairedPhotoBinding(
  binding: z.infer<typeof pairedEvidenceSchema>,
  photo: PairSourcePhoto,
) {
  if (!photo.ready || photo.purgedAt)
    throw Error(
      "Both current sides must finish uploading before confirmation.",
    );
  const source = z
    .object({
      runId: z.string().uuid(),
      executionId: z.string().uuid(),
      side: scanSideSchema,
      sheet: pairedSheetSchema,
    })
    .passthrough()
    .parse(photo.sourceMetadata);
  if (
    source.runId !== binding.runId ||
    source.executionId !== binding.executionId ||
    source.side !== photo.side ||
    source.sheet.documentNumber !== binding.documentNumber ||
    source.sheet.paperCount !== binding.paperCount
  )
    throw Error(
      "These sides do not have the same scanner sheet identity. Reconcile the pair.",
    );
}
