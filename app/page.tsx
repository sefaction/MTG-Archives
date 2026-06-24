export const dynamic = "force-dynamic";
import { Nav } from "@/components/Nav";
import Link from "next/link";

export default function HomePage() {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";
  return (
    <main className="p-8 space-y-6">
      <Nav />
      <section className="app-panel space-y-5 p-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
            Collection manager
          </p>
          <h1 className="text-3xl font-bold text-stone-50">{appName}</h1>
        </div>
        <p className="max-w-3xl text-stone-300">
          Track personal Magic: The Gathering inventories, import CSV
          collections, and coordinate direct card trades between users.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-md border border-cyan-700 bg-cyan-950/40 px-3 py-2 text-sm font-medium text-cyan-100 hover:border-cyan-500 hover:bg-cyan-900/40"
          >
            Open Dashboard
          </Link>
          <Link
            href="/public/inventory"
            className="rounded-md border border-[#364139] bg-[#111715] px-3 py-2 text-sm font-medium text-stone-100 hover:border-[#4a584d] hover:bg-[#17201b]"
          >
            Browse Public Inventory
          </Link>
          <Link
            href="/inventory"
            className="rounded-md border border-[#364139] bg-[#111715] px-3 py-2 text-sm font-medium text-stone-100 hover:border-[#4a584d] hover:bg-[#17201b]"
          >
            Browse My Inventory
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-amber-700/70 bg-amber-950/30 px-3 py-2 text-sm font-medium text-amber-100 hover:border-amber-500 hover:bg-amber-900/30"
          >
            Log in
          </Link>
        </div>
      </section>
    </main>
  );
}
