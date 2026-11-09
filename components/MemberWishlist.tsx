import { TradeWishlistStatus } from "@prisma/client";
import Link from "next/link";
import { filterButtonClass } from "@/components/filterStyles";
import { prisma } from "@/lib/prisma";

const membersHref = "/wishlist?reason=members";

export async function MemberWishlist({
  ownerUserId,
  page,
  preview = false,
}: {
  ownerUserId: string;
  page?: string;
  preview?: boolean;
}) {
  const pageSize = preview ? 5 : 25;
  const where = { ownerUserId, status: TradeWishlistStatus.OPEN };
  const total = preview ? 0 : await prisma.tradeWishlistItem.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Number(page);
  const currentPage = Number.isSafeInteger(requestedPage)
    ? Math.min(pageCount, Math.max(1, requestedPage))
    : 1;
  const wishes = await prisma.tradeWishlistItem.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      quantity: true,
      card: { select: { name: true, setCode: true, collectorNumber: true } },
      targetOwnerPlayer: { select: { displayName: true } },
    },
  });
  return (
    <section aria-labelledby="member-wishlist-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="member-wishlist-heading" className="text-xl font-semibold">
          From members
        </h2>
        <Link
          href={preview ? membersHref : "/trades?view=wishlist"}
          className={filterButtonClass}
        >
          {preview ? "View all member wishes" : "Manage in Trades"}
        </Link>
      </div>
      <p className="text-sm text-zinc-400">
        {preview
          ? "Recent open member wishes. Quantities are tracked separately from manual wishes and deck needs."
          : "Open wishes for cards from specific members."}
      </p>
      {wishes.length ? (
        <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {wishes.map(({ id, card, targetOwnerPlayer, quantity }) => (
            <li key={id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3">
              <div className="min-w-0 break-words">
                <p className="font-medium">{card.name}</p>
                <p className="text-sm text-zinc-400">
                  {card.setCode.toUpperCase()} #{card.collectorNumber} · {targetOwnerPlayer.displayName}
                </p>
              </div>
              <p className="shrink-0 text-sm text-zinc-200">Wanted {quantity}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded border border-zinc-800 p-3 text-sm text-zinc-400">
          No open member wishes.
        </p>
      )}
      {pageCount > 1 && (
        <nav aria-label="Member wish pages" className="flex flex-wrap items-center gap-3">
          {currentPage > 1 && (
            <Link href={`${membersHref}&memberPage=${currentPage - 1}`} className={filterButtonClass}>
              Previous
            </Link>
          )}
          <span className="text-sm text-zinc-400">Page {currentPage} of {pageCount}</span>
          {currentPage < pageCount && (
            <Link href={`${membersHref}&memberPage=${currentPage + 1}`} className={filterButtonClass}>
              Next
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
