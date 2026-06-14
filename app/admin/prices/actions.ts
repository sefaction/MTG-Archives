"use server";

import { requireAdminMode } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mapMtgjsonCards } from "@/lib/mtgjson-prices";
import { revalidatePath } from "next/cache";

export async function mapMtgjsonCardsAction() {
  await requireAdminMode();
  const report = await mapMtgjsonCards(prisma);
  console.info("[mtgjson-prices] card mapping", report);
  revalidatePath("/admin/prices");
}

export async function importMtgjsonTodayAction() {
  await requireAdminMode();
  throw new Error(
    "Large MTGJSON price imports must be run from the app container with npm run prices:import:today.",
  );
}

export async function backfillMtgjsonHistoryAction() {
  await requireAdminMode();
  throw new Error(
    "Large MTGJSON history imports must be run from the app container with npm run prices:import:history.",
  );
}
