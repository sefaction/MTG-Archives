export const dynamic = "force-dynamic";

import { requireAdminMode } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export default async function AdminPricesPage() {
  await requireAdminMode();

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h1 className="text-3xl font-bold">Pricing history disabled</h1>
        <p className="text-zinc-300">
          MTGJSON pricing history, price import jobs, and the separate price
          worker are disabled for now so inventory, decks, imports, and admin
          pages stay fast and stable.
        </p>
        <p className="text-sm text-zinc-500">
          Existing Scryfall price fields stored on cards are still used anywhere
          the app shows lightweight card prices. Historical pricing can be
          revisited later as a separate service.
        </p>
      </section>
    </main>
  );
}
