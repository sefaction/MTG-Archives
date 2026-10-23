import { GET as inventorySuggestions } from "@/app/api/inventory/filter-suggestions/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // The public namespace always uses public visibility, even if the caller
  // supplies a different flag or an authenticated session.
  url.searchParams.set("public", "1");
  return inventorySuggestions(new Request(url, { headers: request.headers }));
}
