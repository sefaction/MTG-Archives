export const dynamic = "force-dynamic";
import { login } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  async function doLogin(formData: FormData) {
    "use server";
    const result = await login(
      String(formData.get("identifier") || ""),
      String(formData.get("password") || ""),
    );
    if (result.ok)
      redirect(
        result.forcePasswordChange
          ? "/change-password"
          : String(formData.get("returnTo") || "/dashboard"),
      );
    redirect("/login?error=1");
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <Nav />
      <div className="mb-4">
        <h1 className="text-3xl font-bold">Log in to MTG Inventory</h1>
        <p className="text-sm text-zinc-400">
          Use your local account to manage inventory, imports, and trades.
        </p>
      </div>
      {params.error ? (
        <p className="mb-3 rounded border border-red-800 bg-red-950/40 p-3 text-red-100">
          Invalid username/email or password, or the account is inactive.
        </p>
      ) : null}
      <form
        action={doLogin}
        className="space-y-4 rounded border border-zinc-800 p-6"
      >
        <input
          type="hidden"
          name="returnTo"
          value={params.returnTo || "/dashboard"}
        />
        <label className="block text-sm">
          Username or email
          <input
            name="identifier"
            required
            className="mt-1 w-full rounded bg-zinc-900 p-2"
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            className="mt-1 w-full rounded bg-zinc-900 p-2"
          />
        </label>
        <button className="w-full rounded bg-sky-600 p-2 font-semibold">
          Log in
        </button>
      </form>
    </main>
  );
}
