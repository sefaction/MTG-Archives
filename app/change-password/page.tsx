export const dynamic = "force-dynamic";
import bcrypt from "bcryptjs";
import { Nav } from "@/components/Nav";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/feedback/SubmitButton";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  async function changePassword(fd: FormData) {
    "use server";
    const currentUser = await getCurrentUser();
    if (!currentUser) redirect("/login");
    const current = String(fd.get("currentPassword") || "");
    const next = String(fd.get("newPassword") || "");
    const confirm = String(fd.get("confirmPassword") || "");
    if (next !== confirm) redirect("/change-password?error=mismatch");
    const ok = await bcrypt.compare(current, currentUser.passwordHash);
    if (!ok) redirect("/change-password?error=current");
    const passwordHash = await hashPassword(next);
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { passwordHash, forcePasswordChange: false },
    });
    redirect("/dashboard");
  }
  return (
    <main className="mx-auto max-w-lg p-8">
      <Nav />
      <h1 className="mb-4 text-3xl font-bold">Change Password</h1>
      {user.forcePasswordChange ? (
        <p className="mb-3 rounded border border-amber-800 bg-amber-950/40 p-3">
          You must change your temporary password before continuing.
        </p>
      ) : null}
      {params.error ? (
        <p className="mb-3 rounded border border-red-800 bg-red-950/40 p-3">
          Password change failed. Check your current password and matching
          confirmation.
        </p>
      ) : null}
      <form
        action={changePassword}
        className="space-y-4 rounded border border-zinc-800 p-6"
      >
        <label className="block text-sm">
          Current password
          <input
            name="currentPassword"
            type="password"
            required
            className="mt-1 w-full rounded bg-zinc-900 p-2"
          />
        </label>
        <label className="block text-sm">
          New password
          <input
            name="newPassword"
            type="password"
            minLength={8}
            required
            className="mt-1 w-full rounded bg-zinc-900 p-2"
          />
        </label>
        <label className="block text-sm">
          Confirm new password
          <input
            name="confirmPassword"
            type="password"
            minLength={8}
            required
            className="mt-1 w-full rounded bg-zinc-900 p-2"
          />
        </label>
        <SubmitButton
          pendingLabel="Changing password…"
          className="w-full rounded bg-sky-600 p-2 font-semibold"
        >
          Change password
        </SubmitButton>
      </form>
    </main>
  );
}
