import { Prisma } from "@prisma/client";
import {
  artCardIdentity,
  tokenFace,
  tokenPairIdentity,
  type PairedDecision,
} from "./paired-scan-policy";
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function resolvePairedCardIdentity(
  tx: Prisma.TransactionClient,
  decision: PairedDecision,
) {
  const ids =
    decision.profile === "TOKEN"
      ? [decision.front.cardId, decision.back.cardId]
      : [decision.cardId];
  const cards = await tx.card.findMany({ where: { id: { in: ids } } });
  const get = (id: string) => {
    const c = cards.find((c) => c.id === id);
    if (!c) throw Error("Selected catalog printing is unavailable.");
    return c;
  };
  const sources =
    decision.profile === "TOKEN"
      ? [get(decision.front.cardId), get(decision.back.cardId)]
      : [get(decision.cardId)];
  const identity =
    decision.profile === "TOKEN"
      ? tokenPairIdentity(
          tokenFace(sources[0], decision.front.face),
          tokenFace(sources[1], decision.back.face),
        )
      : artCardIdentity(sources[0], decision.stamp);
  const primary = identity.faces[0],
    primarySource = get(primary.sourceCardId);
  const languages = [
    ...new Set(sources.flatMap((c) => (c.lang ? [c.lang.toLowerCase()] : []))),
  ];
  const language = languages.length > 1 ? "mul" : (languages[0] ?? null);
  const finishLists = sources.map((c) =>
    Array.isArray(c.finishes)
      ? c.finishes.filter((v): v is string => typeof v === "string")
      : [],
  );
  const finishes = finishLists[0].filter((v) =>
    finishLists.every((f) => f.includes(v)),
  );
  if (!finishes.length)
    throw Error(
      "The selected face printings have no compatible physical finish. Check both matches.",
    );
  return tx.card.upsert({
    where: { applicationIdentityKey: identity.key },
    update: {},
    create: {
      scryfallId: null,
      applicationIdentityKey: identity.key,
      applicationIdentityKind: identity.kind,
      name: identity.name,
      layout:
        decision.profile === "TOKEN" ? "double_faced_token" : "art_series",
      typeLine:
        decision.profile === "TOKEN"
          ? identity.faces.map((f) => f.snapshot.type_line).join(" // ")
          : "Art Card",
      setCode: [...new Set(identity.faces.map(f=>f.setCode))].join(" // "),
      collectorNumber:
        decision.profile === "TOKEN"
          ? identity.faces.map((f) => f.collectorNumber).join(" // ")
          : primary.collectorNumber,
      rarity: primarySource.rarity,
      lang: language,
      digital: false,
      games: ["paper"],
      imageUri: primary.snapshot.image_uris?.normal ?? primarySource.imageUri,
      imageUris: json(primary.snapshot.image_uris ?? {}),
      cardFaces: json(
        identity.faces.map((f) => ({
          ...f.snapshot,
          mtg_archives_source: {
            cardId: f.sourceCardId,
            face: f.sourceFace,
            identityKey: f.key,
            setCode: f.setCode,
            collectorNumber: f.collectorNumber,
          },
        })),
      ),
      finishes,
      nonfoil: finishes.includes("nonfoil"),
      foil: finishes.includes("foil"),
      artist: primarySource.artist,
      prices: Prisma.DbNull,
      rawScryfallJson: Prisma.DbNull,
      oracleId: null,
      applicationFaces: {
        create: identity.faces.map((face, position) => ({
          position,
          sourceCardId: face.sourceCardId,
          sourceFace: face.sourceFace,
          identityKey: face.key,
          snapshot: json(face.snapshot),
        })),
      },
    },
  });
}
