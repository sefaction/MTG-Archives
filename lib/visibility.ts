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
