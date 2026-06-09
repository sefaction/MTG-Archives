export type CollectionCardSize = "small" | "medium" | "large";

export function normalizeCollectionCardSize(
  value: string | null | undefined,
): CollectionCardSize {
  return value === "small" || value === "large" || value === "medium"
    ? value
    : "medium";
}

export function collectionCardGridClass(size: CollectionCardSize) {
  return size === "small"
    ? "grid-cols-2 md:grid-cols-4 lg:grid-cols-8"
    : size === "large"
      ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
      : "grid-cols-2 md:grid-cols-4 lg:grid-cols-6";
}
