export const dynamic = "force-dynamic";
import { Nav } from "@/components/Nav";
import Link from "next/link";

export default function HomePage() {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";
  return (
    <main className="p-8 space-y-6">
      <Nav />
      <section className="rounded border border-zinc-800 p-6 space-y-3">
        <h1 className="text-3xl font-bold">{appName}</h1>
        <p className="text-zinc-300">
          Track personal Magic: The Gathering inventories, import CSV
          collections, and coordinate direct card trades between users.
        </p>
        <div className="flex gap-3">
          <Link href="/dashboard" className="border px-3 py-2">
            Open Dashboard
          </Link>
          <Link href="/inventory" className="border px-3 py-2">
            Browse Inventory
          </Link>
          <Link href="/login" className="border px-3 py-2">
            Log in
          </Link>
        </div>
      </section>
    </main>
  );
}
