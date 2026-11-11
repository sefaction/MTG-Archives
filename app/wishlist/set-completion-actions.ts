"use server";

import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function updateSetCompletionPreferences(form: FormData) {
  const user = await requireLogin();
  const id = String(form.get("wishId") ?? "");
  await prisma.collectorWishlistItem.updateMany({
    where: {id, ownerUserId: user.id},
    data: {
      allowOtherSets: form.get("allowOtherSets") === "on",
      allowOtherFinishes: form.get("allowOtherFinishes") === "on",
    },
  });
  revalidatePath("/wishlist");
}

export async function removeSetCompletionWish(form: FormData) {
  const user = await requireLogin();
  const id = String(form.get("wishId") ?? "");
  await prisma.collectorWishlistItem.deleteMany({where: {id, ownerUserId: user.id}});
  revalidatePath("/wishlist");
  revalidatePath("/collector");
}
