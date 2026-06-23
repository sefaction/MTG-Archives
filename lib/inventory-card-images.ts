export type InventoryCardImageFace = {
  imageUri?: string | null;
  image_uri?: string | null;
  imageUris?: {
    small?: string | null;
    normal?: string | null;
    large?: string | null;
    png?: string | null;
  } | null;
  image_uris?: {
    small?: string | null;
    normal?: string | null;
    large?: string | null;
    png?: string | null;
  } | null;
};

export type InventoryRelatedCardImagePart = {
  component?: string | null;
  imageUri?: string | null;
  image_uri?: string | null;
  imageUris?: InventoryCardImageFace["imageUris"];
  image_uris?: InventoryCardImageFace["image_uris"];
};

export type InventoryCardImageRow = {
  layout?: string | null;
  imageUri?: string | null;
  imageSmall?: string | null;
  cardFaces?: InventoryCardImageFace[] | null;
  allParts?: InventoryRelatedCardImagePart[] | null;
};

export function getInventoryFaceImage(face?: InventoryCardImageFace | null) {
  if (!face) return "";
  const imageUris = face.imageUris ?? face.image_uris ?? {};
  return (
    imageUris.normal ||
    imageUris.large ||
    imageUris.small ||
    face.imageUri ||
    face.image_uri ||
    imageUris.png ||
    ""
  );
}

export function getInventoryCardImagePair(row: InventoryCardImageRow) {
  const faces = row.cardFaces ?? [];
  const meldResult = (row.allParts ?? []).find(
    (part) => part.component === "meld_result",
  );
  return {
    front:
      getInventoryFaceImage(faces[0]) || row.imageUri || row.imageSmall || "",
    back: getInventoryFaceImage(faces[1]) || getInventoryFaceImage(meldResult),
  };
}
