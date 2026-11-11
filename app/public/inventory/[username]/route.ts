import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildPublicInventoryWhere } from "@/lib/public-collection";
import {
  publicInventoryOwnerLink,
  publicInventoryUsername,
} from "@/lib/public-inventory-link";

export const dynamic = "force-dynamic";

const cacheHeaders = { "Cache-Control": "no-store" };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const member = await prisma.user.findUnique({
    where: {
      username: publicInventoryUsername(username),
      isActive: true,
      player: { inventoryOwned: { some: buildPublicInventoryWhere({}) } },
    },
    select: { playerId: true },
  });
  if (!member?.playerId) {
    return new NextResponse("Public inventory not found.", {
      status: 404,
      headers: cacheHeaders,
    });
  }

  return new NextResponse(null, {
    status: 307,
    headers: {
      ...cacheHeaders,
      Location: publicInventoryOwnerLink(
        member.playerId,
        request.nextUrl.searchParams,
      ),
    },
  });
}
