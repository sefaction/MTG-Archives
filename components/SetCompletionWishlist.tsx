import Link from "next/link";
import { removeSetCompletionWish, updateSetCompletionPreferences } from "@/app/wishlist/set-completion-actions";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { filterButtonClass } from "@/components/filterStyles";
import { collectorFinishLabels } from "@/lib/collector";
import { prisma } from "@/lib/prisma";

const setCompletionHref = "/wishlist?reason=sets";

export async function SetCompletionWishlist({
  ownerUserId,
  page,
  preview = false,
}: {
  ownerUserId: string;
  page?: string;
  preview?: boolean;
}) {
  const pageSize = preview ? 5 : 25;
  const where = {ownerUserId};
  const total = preview ? 0 : await prisma.collectorWishlistItem.count({where});
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Number(page);
  const currentPage = Number.isSafeInteger(requestedPage)
    ? Math.min(pages, Math.max(1, requestedPage))
    : 1;
  const wishes = await prisma.collectorWishlistItem.findMany({
    where,
    orderBy: [{createdAt: "desc"}, {id: "desc"}],
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
  });
  return (
    <section aria-labelledby="set-completion-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="set-completion-heading" className="text-xl font-semibold">Set Completion</h2>
        <Link href={preview ? setCompletionHref : "/collector"} className={filterButtonClass}>
          {preview ? "View all Set Completion wishes" : "Open Collector"}
        </Link>
      </div>
      <p className="text-sm text-[var(--app-muted)]">
        {preview ? "Recent Collector wishes, tracked separately from other reasons."
          : "Each target requests one copy. You can allow alternatives and keep your preferred set and finish. Remove a wish when you no longer want it."}
      </p>
      {wishes.length === 0 ? <p className="rounded border border-[var(--app-border)] p-3 text-sm">
        No Set Completion wishes yet.
      </p> : (
        <ul className="divide-y divide-[var(--app-border)] rounded border border-[var(--app-border)]">
          {wishes.map(wish => {
            const finish = collectorFinishLabels[wish.preferredFinish as keyof typeof collectorFinishLabels];
            return (
              <li key={wish.id} className="space-y-2 break-words p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{wish.cardName}</p>
                    <p className="text-sm text-[var(--app-muted)]">
                      <Link className="underline" href={{pathname: "/collector", query: {set: wish.setCode, view: wish.mode}}}>
                        {wish.setCode.toUpperCase()}
                      </Link>
                      {wish.mode === "grouped" ? " · Grouped card"
                        : wish.collectorNumber ? ` · #${wish.collectorNumber}` : " · Printing variant"}
                      {" · "}{finish} preferred
                      {wish.allowOtherSets && " · Other sets accepted"}
                      {wish.allowOtherFinishes && " · Other finishes accepted"}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm">Wanted 1</span>
                </div>
                {!preview && (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium">Preferences for {wish.cardName}</summary>
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <form action={updateSetCompletionPreferences} className="space-y-2">
                        <input type="hidden" name="wishId" value={wish.id} />
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="allowOtherSets" defaultChecked={wish.allowOtherSets} />
                          Allow another set
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="allowOtherFinishes" defaultChecked={wish.allowOtherFinishes} />
                          Allow a different finish
                        </label>
                        <SubmitButton className={filterButtonClass} pendingLabel="Saving…">Save preferences</SubmitButton>
                      </form>
                      <form action={removeSetCompletionWish}>
                        <input type="hidden" name="wishId" value={wish.id} />
                        <SubmitButton className={filterButtonClass} pendingLabel="Removing…"
                          confirmMessage="Remove this Set Completion wish?">Remove wish</SubmitButton>
                      </form>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Set Completion wish pages" className="flex flex-wrap items-center gap-3">
          {currentPage > 1 && (
            <Link href={`${setCompletionHref}&setPage=${currentPage - 1}`} className={filterButtonClass}>Previous</Link>
          )}
          <span className="text-sm">Page {currentPage} of {pages}</span>
          {currentPage < pages && (
            <Link href={`${setCompletionHref}&setPage=${currentPage + 1}`} className={filterButtonClass}>Next</Link>
          )}
        </nav>
      )}
    </section>
  );
}
