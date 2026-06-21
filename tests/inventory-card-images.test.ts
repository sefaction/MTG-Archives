import assert from "node:assert/strict";
import test from "node:test";
import { getInventoryCardImagePair } from "../lib/inventory-card-images";

test("single-face rows use the top-level image", () => {
  assert.deepEqual(
    getInventoryCardImagePair({
      imageUri: "https://img.example/card-normal.jpg",
      imageSmall: "https://img.example/card-small.jpg",
    }),
    {
      front: "https://img.example/card-normal.jpg",
      back: "",
    },
  );
});

test("multi-face rows use two face image URLs", () => {
  assert.deepEqual(
    getInventoryCardImagePair({
      imageUri: "https://img.example/card-normal.jpg",
      cardFaces: [
        { image_uris: { normal: "https://img.example/front-normal.jpg" } },
        { image_uris: { normal: "https://img.example/back-normal.jpg" } },
      ],
    }),
    {
      front: "https://img.example/front-normal.jpg",
      back: "https://img.example/back-normal.jpg",
    },
  );
});

test("multi-face rows without a second face image do not expose a back image", () => {
  assert.deepEqual(
    getInventoryCardImagePair({
      imageUri: "https://img.example/card-normal.jpg",
      cardFaces: [{ image_uris: { normal: "https://img.example/front.jpg" } }],
    }),
    {
      front: "https://img.example/front.jpg",
      back: "",
    },
  );
});

test("face image selection supports snake-case image_uris", () => {
  assert.deepEqual(
    getInventoryCardImagePair({
      cardFaces: [
        { image_uris: { large: "https://img.example/front-large.jpg" } },
        { image_uris: { small: "https://img.example/back-small.jpg" } },
      ],
    }),
    {
      front: "https://img.example/front-large.jpg",
      back: "https://img.example/back-small.jpg",
    },
  );
});

test("face image selection supports camel-case imageUris", () => {
  assert.deepEqual(
    getInventoryCardImagePair({
      cardFaces: [
        { imageUris: { normal: "https://img.example/front-normal.jpg" } },
        { imageUris: { large: "https://img.example/back-large.jpg" } },
      ],
    }),
    {
      front: "https://img.example/front-normal.jpg",
      back: "https://img.example/back-large.jpg",
    },
  );
});
