"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { collectorCatalog } from "@/lib/collector-catalog";
import { saveCollectorWishes } from "@/lib/collector-service";
import { prisma } from "@/lib/prisma";

const setRequest = z.object({
  set: z.string().regex(/^[a-z0-9]{2,8}$/),
  mode: z.enum(["grouped", "variants"]),
});
const addRequest = z.discriminatedUnion("scope", [
  setRequest.extend({scope: z.literal("all")}).strict(),
  setRequest.extend({scope: z.literal("one"), targetId: z.string().min(1).max(1024)}).strict(),
]);

export async function addCollectorWishes(input: unknown) {
  const user = await getCurrentUser();
  if (!user?.playerId) return {ok: false, error: "Sign in with a linked inventory owner to add wishes."} as const;
  const request = addRequest.safeParse(input);
  if (!request.success) return {ok: false, error: "Invalid Collector wishlist request."} as const;

  const {set, mode} = request.data;
  const catalog = await collectorCatalog(set).catch(() => null);
  if (!catalog) return {ok: false, error: "Complete set catalog unavailable. Retry before adding wishes."} as const;

  const owner = {userId: user.id, playerId: user.playerId};
  const result = await prisma.$transaction(
    tx => saveCollectorWishes(tx, owner, set, catalog.cards, mode, request.data),
    {timeout: 30_000},
  );
  if (!result.valid) return {ok: false, error: "This target is no longer in the set catalog."} as const;
  revalidatePath("/wishlist");
  return {ok: true, added: result.added, alreadySaved: result.alreadySaved} as const;
}
