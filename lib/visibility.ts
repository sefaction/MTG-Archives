import { DefaultCollectionVisibility, Visibility } from "@prisma/client";

export type EffectiveVisibility = DefaultCollectionVisibility;

export function resolveInventoryVisibility(
  userDefault: DefaultCollectionVisibility,
  locationVisibility: Visibility | null | undefined,
): EffectiveVisibility {
  if (locationVisibility === Visibility.PUBLIC)
    return DefaultCollectionVisibility.PUBLIC;
  if (locationVisibility === Visibility.PRIVATE)
    return DefaultCollectionVisibility.PRIVATE;
  return userDefault;
}

export function resolveDeckVisibility(
  userDefault: DefaultCollectionVisibility,
  deckVisibility: Visibility | null | undefined,
): EffectiveVisibility {
  if (deckVisibility === Visibility.PUBLIC)
    return DefaultCollectionVisibility.PUBLIC;
  if (deckVisibility === Visibility.PRIVATE)
    return DefaultCollectionVisibility.PRIVATE;
  return userDefault;
}

export function visibilityLabel(value: Visibility) {
  switch (value) {
    case Visibility.PUBLIC:
      return "Public";
    case Visibility.PRIVATE:
      return "Private";
    case Visibility.INHERIT:
      return "Use account default";
  }
}

export function defaultVisibilityLabel(value: DefaultCollectionVisibility) {
  return value === DefaultCollectionVisibility.PUBLIC
    ? "Public by default"
    : "Private by default";
}

export function effectiveVisibilityLabel(value: EffectiveVisibility) {
  return value === DefaultCollectionVisibility.PUBLIC ? "Public" : "Private";
}

export function normalizePublicSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function assertPublicSlug(input: string) {
  const slug = normalizePublicSlug(input);
  if (!slug) throw new Error("Public slug is required.");
  if (slug.length < 3)
    throw new Error("Public slug must be at least 3 characters.");
  if (!/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/.test(slug))
    throw new Error(
      "Public slug may contain lowercase letters, numbers, hyphens, and underscores.",
    );
  return slug;
}
