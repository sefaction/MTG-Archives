import { DeckSection } from "@prisma/client";
import { deckSectionLabel, deckSections } from "./decks";

type ExportCard = {
  section: DeckSection;
  quantity: number;
  cardName: string;
  card: { setCode: string; collectorNumber: string } | null;
};

function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function formatDecklistText(cards: ExportCard[]) {
  const groups = deckSections.flatMap((section) => {
    const lines = cards
      .filter((card) => card.section === section && card.quantity > 0)
      .sort((a, b) => a.cardName.localeCompare(b.cardName) ||
        (a.card?.setCode ?? "").localeCompare(b.card?.setCode ?? "") ||
        (a.card?.collectorNumber ?? "").localeCompare(b.card?.collectorNumber ?? ""))
      .map((card) => {
        const name = singleLine(card.cardName);
        const set = card.card?.setCode;
        const number = card.card?.collectorNumber;
        const printing = set && number && /^[A-Za-z0-9]{2,6}$/.test(set) &&
          /^[A-Za-z0-9-]+$/.test(number)
          ? ` (${set.toUpperCase()}) ${number}` : "";
        return `${card.quantity} ${name}${printing}`;
      });
    return lines.length ? [`${deckSectionLabel(section)}\n${lines.join("\n")}`] : [];
  });
  return `${groups.join("\n\n")}\n`;
}

export function decklistFilename(name: string) {
  const slug = name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 64) || "deck";
  return `${slug}-decklist.txt`;
}
