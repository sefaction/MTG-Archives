"use client";

export type InventoryAuditEntry = {
  id: string;
  createdAt: string;
  changedBy?: string;
  changeType: string;
  reason?: string;
  beforeJson: Record<string, unknown>;
  afterJson: Record<string, unknown>;
};

type LabelMap = Record<string, string>;

type Props = {
  entries?: InventoryAuditEntry[];
  playerLabels: LabelMap;
  roundLabels: LabelMap;
  cardLabels: LabelMap;
};

const FIELD_LABELS: Record<string, string> = {
  currentOwnerId: "Current Owner",
  originalOpenerId: "Original Opener",
  roundId: "Round Opened",
  cardId: "Card Printing",
  cardPrintingId: "Card Printing",
  quantity: "Quantity",
  foil: "Foil",
  foilStatus: "Foil Status",
  condition: "Condition",
  sourceType: "Source Type",
  notes: "Notes",
};

const DISPLAY_FIELDS = [
  "currentOwnerId",
  "originalOpenerId",
  "roundId",
  "cardId",
  "cardPrintingId",
  "quantity",
  "foilStatus",
  "foil",
  "condition",
  "sourceType",
  "notes",
];

function normalize(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function stableStringify(value: unknown): string {
  const normalized = normalize(value);
  if (normalized === null) return "—";
  if (typeof normalized === "object") return JSON.stringify(normalized);
  return String(normalized);
}

function valuesEqual(before: unknown, after: unknown) {
  return stableStringify(before) === stableStringify(after);
}

function friendlyEnum(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(
  field: string,
  value: unknown,
  lookups: Pick<Props, "playerLabels" | "roundLabels" | "cardLabels">,
) {
  const normalized = normalize(value);
  if (normalized === null) return "—";
  const raw = String(normalized);

  if (field === "currentOwnerId" || field === "originalOpenerId")
    return lookups.playerLabels[raw] || raw;
  if (field === "roundId") return lookups.roundLabels[raw] || raw;
  if (field === "cardId" || field === "cardPrintingId")
    return lookups.cardLabels[raw] || raw;
  if (field === "foilStatus" || field === "sourceType")
    return friendlyEnum(raw);
  if (typeof normalized === "object")
    return JSON.stringify(normalized, null, 0);
  return raw;
}

function getChangedFields(
  entry: InventoryAuditEntry,
  lookups: Pick<Props, "playerLabels" | "roundLabels" | "cardLabels">,
) {
  const fields = Array.from(
    new Set([
      ...DISPLAY_FIELDS,
      ...Object.keys(entry.beforeJson || {}),
      ...Object.keys(entry.afterJson || {}),
    ]),
  );
  return fields
    .filter((field) => FIELD_LABELS[field])
    .filter(
      (field) =>
        !valuesEqual(entry.beforeJson?.[field], entry.afterJson?.[field]),
    )
    .map((field) => ({
      field,
      label: FIELD_LABELS[field] || field,
      before: formatValue(field, entry.beforeJson?.[field], lookups),
      after: formatValue(field, entry.afterJson?.[field], lookups),
    }));
}

export function InventoryAuditTrail({
  entries = [],
  playerLabels,
  roundLabels,
  cardLabels,
}: Props) {
  if (!entries.length) {
    return (
      <div className="rounded border border-zinc-800 p-4 text-sm text-zinc-400">
        No audit history for this inventory item yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const changedFields = getChangedFields(entry, {
          playerLabels,
          roundLabels,
          cardLabels,
        });
        return (
          <section
            key={entry.id}
            className="rounded border border-zinc-800 bg-zinc-950 p-3 text-sm"
          >
            <div className="mb-3 flex flex-col gap-1 border-b border-zinc-800 pb-2">
              <div className="font-semibold">
                {friendlyEnum(entry.changeType)}
              </div>
              <div className="text-zinc-400">
                {new Date(entry.createdAt).toLocaleString()}
              </div>
              <div>
                Changed by:{" "}
                <span className="text-zinc-200">{entry.changedBy || "—"}</span>
              </div>
              <div>
                Reason:{" "}
                <span className="text-zinc-200">{entry.reason || "—"}</span>
              </div>
            </div>
            <div className="font-medium mb-2">Changed fields:</div>
            {changedFields.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-400">
                      <th className="p-2">Field</th>
                      <th className="p-2">Before</th>
                      <th className="p-2">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changedFields.map((change) => (
                      <tr
                        key={change.field}
                        className="border-b border-zinc-900 bg-sky-950/10"
                      >
                        <td className="p-2 font-medium text-zinc-100">
                          {change.label}
                        </td>
                        <td className="p-2 text-zinc-300">{change.before}</td>
                        <td className="p-2 text-zinc-300">{change.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-zinc-500">
                No changed display fields were found for this audit entry.
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
