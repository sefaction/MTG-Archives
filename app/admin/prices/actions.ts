"use server";

import { requireAdminMode } from "@/lib/auth";
import { createPriceImportJob } from "@/lib/price-import-jobs";
import { revalidatePath } from "next/cache";

export async function mapMtgjsonCardsAction() {
  const user = await requireAdminMode();
  await createPriceImportJob("map_mtgjson_cards", user.id);
  revalidatePath("/admin/prices");
}

export async function importMtgjsonTodayAction() {
  const user = await requireAdminMode();
  await createPriceImportJob("import_prices_today", user.id);
  revalidatePath("/admin/prices");
}

export async function backfillMtgjsonHistoryAction() {
  const user = await requireAdminMode();
  await createPriceImportJob("import_prices_history", user.id);
  revalidatePath("/admin/prices");
}
