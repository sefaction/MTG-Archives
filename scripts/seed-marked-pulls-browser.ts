import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import bcrypt from "bcryptjs";
import { seedHuntWorkspace } from "./verify-hunt-workspace";
import { seedBulkScans } from "./verify-bulk-cleanup";
import {
  writeAcquisitionPhotoBytes,
  photoDigest,
} from "../lib/acquisition-files";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.MTG_MARKED_PULLS_UI !== "1" ||
    url.hostname !== "marked-pulls-db" ||
    url.pathname !== "/marked_pulls_review"
  )
    throw Error("Requires the isolated marked-pulls browser database.");
  const db = new PrismaClient();
  try {
    const tag = Date.now();
    const browse = await seedHuntWorkspace(db, `marked-browse-${tag}`);
    const actions = await seedHuntWorkspace(db, `marked-actions-${tag}`);
    const bulk = await seedHuntWorkspace(db, `marked-bulk-${tag}`);
    const partial = await seedHuntWorkspace(db, `marked-partial-${tag}`);
    const scans = await seedHuntWorkspace(db, `marked-scans-${tag}`);
    const review = await seedHuntWorkspace(db, `marked-review-${tag}`);
    await db.user.update({
      where: { id: review.owner },
      data: {
        username: "review",
        passwordHash: await bcrypt.hash("local-review-only", 4),
      },
    });
    await db.user.update({
      where: { id: actions.owner },
      data: { publicWishlistCategories: ["manual"] },
    });
    await db.wishlistItem.create({
      data: {
        ownerUserId: actions.owner,
        cardId: actions.card.id,
        quantity: 2,
      },
    });
    await db.inventoryLocation.update({
      where: { id: scans.destination.id },
      data: {
        storageLayout: {
          capacity: 1000,
          sections: [
            { name: "0", capacity: 500 },
            { name: "1", capacity: 500 },
          ],
        },
      },
    });
    const current = await seedBulkScans(db, scans, 5);
    const older = await seedBulkScans(db, scans, 1);
    const humanBatch = await seedBulkScans(db, review, 5);
    const bytes = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350"><rect width="250" height="350" rx="12" fill="#23424f"/><rect x="12" y="12" width="226" height="35" fill="#eee9dc"/><text x="22" y="35" font-size="19">Counterspell</text><rect x="12" y="58" width="226" height="147" fill="#62aeb9"/><path d="M20 190L90 80L150 160L210 90L235 190" fill="#264e74"/><rect x="12" y="215" width="226" height="120" fill="#eee9dc"/><text x="22" y="243" font-size="14">Counter target spell.</text><text x="22" y="320" font-size="12">Synthetic scan - DMR 2 EN</text></svg>',
      ),
    )
      .png()
      .toBuffer();
    const preview = await sharp(bytes).jpeg().toBuffer();
    for (const batch of [current, older, humanBatch])
      for (const row of batch.photos) {
        await writeAcquisitionPhotoBytes(
          row.photo.id,
          bytes,
          "raw",
          photoDigest(bytes),
        );
        await writeAcquisitionPhotoBytes(
          row.photo.id,
          preview,
          "preview",
          photoDigest(preview),
        );
        await db.acquisitionPhoto.update({
          where: { id: row.photo.id },
          data: { bytes: bytes.length, digest: photoDigest(bytes) },
        });
      }
    console.log(
      JSON.stringify({
        browse,
        actions,
        bulk,
        partial,
        scans,
        current,
        older,
        review: {
          username: "review",
          password: "local-review-only",
          deckId: review.reviewDeck.id,
          batchId: humanBatch.id,
          owner: review.owner,
        },
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
