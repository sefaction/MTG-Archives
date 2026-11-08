export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireLogin } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { CollectorView } from "@/components/CollectorView";
export default async function CollectorPage() {
  const user = await requireLogin();
  return <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
    <Nav />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Collector</h1>
      <Link href="/inventory" className="underline">Back to inventory</Link>
    </div>
    {user.playerId ? <CollectorView /> : <p>Link your account to an inventory owner in Settings to see collection progress.</p>}
  </main>;
}
