import {
  getDisplayManaCosts,
  getManaCostSeparatorText,
  ManaDisplayCard,
} from "@/lib/mtg/mana-display";
import { ManaCost } from "./ManaCost";

export function CardManaCost({
  card,
  showFaceNames = false,
}: {
  card: ManaDisplayCard;
  showFaceNames?: boolean;
}) {
  const display = getDisplayManaCosts(card);

  if (display.kind === "none") return <ManaCost value={null} />;
  if (display.kind === "single") return <ManaCost value={display.manaCost} />;

  return (
    <span className="mtg-face-mana-costs">
      {display.faces.map((face, index) => (
        <span
          key={`${face.name ?? "face"}-${index}`}
          className="mtg-face-mana-cost"
        >
          {index > 0 ? (
            <span className="mtg-face-mana-separator" aria-hidden="true">
              {getManaCostSeparatorText(display.separator)}
            </span>
          ) : null}
          {showFaceNames && face.name ? (
            <span className="text-zinc-400">{face.name}: </span>
          ) : null}
          <ManaCost value={face.manaCost} />
        </span>
      ))}
    </span>
  );
}
