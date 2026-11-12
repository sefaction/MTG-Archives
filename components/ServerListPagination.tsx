import { cn, filterButtonClass } from "./filterStyles";

export function ServerListPagination({
  label,
  path,
  query,
  page,
}: {
  label: string;
  path: string;
  query: Record<string, string | undefined>;
  page: {
    page: number;
    totalPages: number;
    total: number;
    from: number;
    to: number;
  };
}) {
  function href(nextPage: number) {
    const params = new URLSearchParams(
      Object.entries(query).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    return path + (params.size ? `?${params}` : "");
  }
  const button = cn(filterButtonClass, "shrink-0 whitespace-nowrap");
  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex flex-wrap items-center gap-2 py-2 text-sm"
    >
      <span className="app-muted mr-auto" role="status">
        {page.from}–{page.to} of {page.total}
      </span>
      {page.page > 1 ? (
        <a className={button} href={href(page.page - 1)}>
          Previous
        </a>
      ) : (
        <span aria-disabled="true" className={cn(button, "opacity-50")}>
          Previous
        </span>
      )}
      <span className="whitespace-nowrap">
        Page {page.page} of {page.totalPages}
      </span>
      {page.page < page.totalPages ? (
        <a className={button} href={href(page.page + 1)}>
          Next
        </a>
      ) : (
        <span aria-disabled="true" className={cn(button, "opacity-50")}>
          Next
        </span>
      )}
    </nav>
  );
}
