import type { InventoryRow } from "../components/InventoryBrowser";
import type { HuntCard } from "./card-hunt";
export function pullCardRow(input: {
  id: string;
  cardId?: string;
  name: string;
  quantity: number;
  setCode: string;
  collectorNumber: string;
  finish: string;
  card?: HuntCard;
  imageUri?: string | null;
  location?: string;
  destination?: string;
}): InventoryRow {
  return {
    id: input.id,
    cardId: input.cardId ?? input.card?.id ?? "",
    cardName: input.name,
    quantity: input.quantity,
    currentOwnerId: "own-pull",
    currentOwner: "Your inventory",
    setCode: input.setCode,
    collectorNumber: input.collectorNumber,
    foilStatus: ["NONFOIL", "FOIL", "ETCHED"].includes(input.finish)
      ? (input.finish as "NONFOIL" | "FOIL" | "ETCHED")
      : undefined,
    foil: input.finish === "FOIL",
    imageUri: input.imageUri ?? input.card?.imageUri ?? undefined,
    cardFaces: Array.isArray(input.card?.cardFaces) ? input.card.cardFaces : [],
    colorIdentity: Array.isArray(input.card?.colorIdentity)
      ? input.card.colorIdentity.join(",")
      : "",
    manaCost: input.card?.manaCost ?? "",
    typeLine: input.card?.typeLine ?? "",
    rarity: input.card?.rarity ?? "",
    oracleText: input.card?.oracleText ?? "",
    rollupPrinting: true,
    pull: {
      quantity: input.quantity,
      location: input.location,
      destination: input.destination,
    },
  };
}
