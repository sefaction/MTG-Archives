import { PrismaClient } from "@prisma/client";
import { seedHuntWorkspace } from "./verify-hunt-workspace";

// Credentials go to the caller's private fixture file, never checked-in data.
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.MTG_HUNT_WORKSPACE_UI !== "1" ||
    url.hostname !== "hunt-workspace-db" ||
    url.pathname !== "/hunt_workspace_review"
  )
    throw Error("Requires the isolated hunt workspace browser database.");
  const db = new PrismaClient();
  try {
    const tag = Date.now();
    const browse = await seedHuntWorkspace(db, `browser-browse-${tag}`);
    const actions = await seedHuntWorkspace(db, `browser-actions-${tag}`);
    const bulk = await seedHuntWorkspace(db, `browser-bulk-${tag}`);
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
    console.log(JSON.stringify({ browse, actions, bulk }));
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
