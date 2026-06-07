import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PublicOwnerInventoryRedirect({
  params,
}: {
  params: Promise<{ publicSlug: string }>;
}) {
  const { publicSlug } = await params;
  redirect(`/public/inventory?owner=${encodeURIComponent(publicSlug)}`);
}
