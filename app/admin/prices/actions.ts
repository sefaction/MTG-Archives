"use server";

import { requireAdminMode } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { importMtgjsonPrices } from "@/lib/mtgjson-prices";
import { revalidatePath } from "next/cache";

export async function importMtgjsonTodayAction() {
  await requireAdminMode();
  const report = await importMtgjsonPrices(prisma, "today");
  console.info("[mtgjson-prices] today import", report);
  revalidatePath("/admin/prices");
}

export async function backfillMtgjsonHistoryAction() {
  await requireAdminMode();
  const report = await importMtgjsonPrices(prisma, "history");
  console.info("[mtgjson-prices] history import", report);
  revalidatePath("/admin/prices");
}
