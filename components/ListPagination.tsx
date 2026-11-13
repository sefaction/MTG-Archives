"use client";

import { cn, filterButtonClass, filterSelectClass } from "./filterStyles";
import { listPageSizes } from "@/lib/list-browse";

export function ListPagination({
  label,
  page,
  onPage,
  onSize,
}: {
  label: string;
  page: {
    page: number;
    pageSize: number;
    totalPages: number;
    total: number;
    from: number;
    to: number;
  };
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex flex-wrap items-center gap-2 py-2 text-sm"
    >
      <span className="app-muted mr-auto" role="status">
        {page.from}–{page.to} of {page.total}
      </span>
      <label className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        Rows per page
        <select
          className={filterSelectClass}
          value={page.pageSize}
          onChange={(event) => onSize(Number(event.target.value))}
        >
          {listPageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={cn(filterButtonClass, "shrink-0 whitespace-nowrap")}
        disabled={page.page <= 1}
        onClick={() => onPage(page.page - 1)}
      >
        Previous
      </button>
      <span className="whitespace-nowrap">
        Page {page.page} of {page.totalPages}
      </span>
      <button
        type="button"
        className={cn(filterButtonClass, "shrink-0 whitespace-nowrap")}
        disabled={page.page >= page.totalPages}
        onClick={() => onPage(page.page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
