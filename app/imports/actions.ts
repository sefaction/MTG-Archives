"use server";

import { FoilStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  addInventoryCardToLocation,
  normalizeManualInventoryQuantity,
} from "@/lib/inventory-manual";

function formString(fd: FormData, name: string) {
  return String(fd.get(name) || "").trim();
}

export async function addSingleCardToInventory(fd: FormData) {
  const user = await requireLogin();
  if (!user.playerId)
    throw new Error("Your account is not linked to inventory.");
  const cardId = formString(fd, "cardId");
  const locationId = formString(fd, "locationId");
  if (!cardId) throw new Error("Select a printing before adding inventory.");
  if (!locationId) throw new Error("Choose a destination location.");
  const quantity = normalizeManualInventoryQuantity(fd.get("quantity"));
  await prisma.$transaction(async (tx) => {
    await addInventoryCardToLocation(tx, {
      ownerPlayerId: user.playerId!,
      cardId,
      locationId,
      locationSection: formString(fd, "locationSection"),
      quantity,
      foilStatus: formString(fd, "foilStatus") || FoilStatus.NONFOIL,
      condition: formString(fd, "condition") || "NM",
      language: formString(fd, "language") || "EN",
      notes: formString(fd, "notes") || null,
      actingUserId: user.id,
      reason: "Manual single-card inventory add.",
    });
  });
  revalidatePath("/imports");
  revalidatePath("/inventory");
  revalidatePath("/locations");
  redirect("/imports?singleCardAdded=1");
}
