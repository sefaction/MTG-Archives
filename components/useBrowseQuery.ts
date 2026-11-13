"use client";

import { useSearchParams } from "next/navigation";

/** Native history updates the App Router search-param snapshot without fetching the page again. */
export function useBrowseQuery() {
  const params = useSearchParams();
  function change(update: (params: URLSearchParams) => void) {
    const url = new URL(window.location.href);
    update(url.searchParams);
    // Next copies its own history keys and updates useSearchParams for external
    // calls. Passing the existing __NA state would skip that synchronization.
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  return { params, change };
}

export function setBrowseParam(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue = "",
) {
  if (value === defaultValue) params.delete(key);
  else params.set(key, value);
}
