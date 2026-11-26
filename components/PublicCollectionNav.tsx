import Link from "next/link";

export function PublicCollectionNav() {
  return <nav aria-label="Collection navigation" className="flex items-center justify-between gap-3 text-sm">
    <span className="font-semibold">MTG Archives</span><Link href="/login" className="underline">Log in</Link>
  </nav>;
}
