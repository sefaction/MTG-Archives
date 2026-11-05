import type { FoilStatus } from "@prisma/client";

const finishLabels: Record<FoilStatus, string> = {
  NONFOIL: "Nonfoil",
  FOIL: "Foil",
  ETCHED: "Etched",
};

export function deckCommitSourceLabel(source: {
  locationName: string;
  locationSection: string | null;
  foilStatus: FoilStatus;
}) {
  const section = source.locationSection?.trim();
  return `${source.locationName} → ${section ? `Section ${section}` : "No section"} · ${finishLabels[source.foilStatus]}`;
}
