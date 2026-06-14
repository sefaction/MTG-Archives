export const dynamic = "force-dynamic";

import { Nav } from "@/components/Nav";
import { requireLogin } from "@/lib/auth";

export default async function PricingPage() {
  await requireLogin();

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="space-y-3 rounded border border-zinc-800 p-4">
        <h1 className="text-3xl font-bold">Pricing analytics disabled</h1>
        <p className="text-zinc-300">
          Historical MTGJSON pricing analytics are disabled for now so inventory,
          deck, import, and admin pages stay fast and stable.
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
