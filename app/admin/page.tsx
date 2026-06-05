export const dynamic = "force-dynamic";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Nav } from "@/components/Nav";
import { UserRole } from "@prisma/client";
import { SubmitButton } from "@/components/feedback/SubmitButton";

async function refresh() {
  "use server";
  await requireAdmin();
  revalidatePath("/admin");
}
function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "user"
  );
}

async function ensureOwnerForUser(
  displayName: string,
  existingPlayerId?: string | null,
) {
  if (existingPlayerId) return existingPlayerId;
  const base = slugify(displayName);
  let name = base;
  let suffix = 1;
  while (await prisma.player.findUnique({ where: { name } }))
    name = `${base}-${suffix++}`;
  const player = await prisma.player.create({
    data: { name, displayName, active: true },
  });
  return player.id;
}

export default async function Page() {
  await requireAdmin();
  const [users, inventoryCount, openTrades] = await Promise.all([
    prisma.user.findMany({
      include: { player: true },
      orderBy: { username: "asc" },
    }),
    prisma.inventoryItem.aggregate({
      where: { quantity: { gt: 0 } },
      _sum: { quantity: true },
      _count: true,
    }),
    prisma.trade.count({
      where: {
        status: {
          in: ["PROPOSED", "ACCEPTED_PENDING_EXCHANGE", "PARTIALLY_COMMITTED"],
        },
      },
    }),
  ]);

  return (
    <main className="p-8 space-y-8">
      <Nav />
      <div>
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="text-zinc-400">
          Manage local user accounts and monitor inventory/trade activity.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded border border-zinc-800 p-4">
          <p className="text-sm text-zinc-400">Users</p>
          <p className="text-2xl font-bold">{users.length}</p>
        </div>
        <div className="rounded border border-zinc-800 p-4">
          <p className="text-sm text-zinc-400">Inventory entries</p>
          <p className="text-2xl font-bold">{inventoryCount._count}</p>
        </div>
        <div className="rounded border border-zinc-800 p-4">
          <p className="text-sm text-zinc-400">Open trades</p>
          <p className="text-2xl font-bold">{openTrades}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Create user</h2>
        <p className="text-sm text-zinc-400">
          The current schema still links inventory ownership through an internal
          owner record. New users are automatically linked to one so inventory,
          imports, and trades continue to work.
        </p>
        <form
          action={async (fd) => {
            "use server";
            await requireAdmin();
            const password = String(fd.get("password") || "");
            const confirm = String(fd.get("confirmPassword") || "");
            if (password !== confirm)
              throw new Error("Temporary passwords must match.");
            const username = String(fd.get("username")).trim();
            const displayName = String(
              fd.get("displayName") || username,
            ).trim();
            const passwordHash = await hashPassword(password);
            const playerId = await ensureOwnerForUser(displayName);
            await prisma.user.create({
              data: {
                username,
                email:
                  String(fd.get("email") || "")
                    .trim()
                    .toLowerCase() || null,
                displayName,
                passwordHash,
                role:
                  String(fd.get("role")) === "ADMIN"
                    ? UserRole.ADMIN
                    : UserRole.PLAYER,
                playerId,
                forcePasswordChange: fd.get("forcePasswordChange") === "on",
                isActive: fd.get("isActive") === "on",
              },
            });
            await refresh();
          }}
          className="grid gap-2 rounded border border-zinc-800 p-3 md:grid-cols-4"
        >
          <input
            name="username"
            required
            placeholder="username"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="email"
            placeholder="email optional"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="displayName"
            placeholder="display name"
            className="border p-2 bg-zinc-900"
          />
          <select
            name="role"
            defaultValue="PLAYER"
            className="border p-2 bg-zinc-900"
          >
            <option value="PLAYER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="temporary password"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            placeholder="confirm password"
            className="border p-2 bg-zinc-900"
          />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="forcePasswordChange" defaultChecked />{" "}
            force password change
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isActive" defaultChecked /> active
          </label>
          <SubmitButton
            pendingLabel="Creating user…"
            className="border px-3 py-2 md:col-span-4"
          >
            Create User
          </SubmitButton>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Users</h2>
        {users.length ? (
          users.map((u) => (
            <div
              key={u.id}
              className="rounded border border-zinc-800 p-3 space-y-2"
            >
              <form
                action={async (fd) => {
                  "use server";
                  await requireAdmin();
                  const displayName = String(
                    fd.get("displayName") || fd.get("username"),
                  ).trim();
                  const playerId = await ensureOwnerForUser(
                    displayName,
                    u.playerId,
                  );
                  await prisma.user.update({
                    where: { id: u.id },
                    data: {
                      username: String(fd.get("username")).trim(),
                      email:
                        String(fd.get("email") || "")
                          .trim()
                          .toLowerCase() || null,
                      displayName,
                      role:
                        String(fd.get("role")) === "ADMIN"
                          ? UserRole.ADMIN
                          : UserRole.PLAYER,
                      playerId,
                      forcePasswordChange:
                        fd.get("forcePasswordChange") === "on",
                      isActive: fd.get("isActive") === "on",
                    },
                  });
                  await prisma.player.update({
                    where: { id: playerId },
                    data: { displayName, active: fd.get("isActive") === "on" },
                  });
                  await refresh();
                }}
                className="grid gap-2 md:grid-cols-6"
              >
                <input
                  name="username"
                  defaultValue={u.username}
                  className="border p-2 bg-zinc-900"
                />
                <input
                  name="email"
                  defaultValue={u.email ?? ""}
                  className="border p-2 bg-zinc-900"
                />
                <input
                  name="displayName"
                  defaultValue={u.displayName}
                  className="border p-2 bg-zinc-900"
                />
                <select
                  name="role"
                  defaultValue={u.role}
                  className="border p-2 bg-zinc-900"
                >
                  <option value="PLAYER">User</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <div className="flex gap-3">
                  <label>
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked={u.isActive}
                    />{" "}
                    active
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      name="forcePasswordChange"
                      defaultChecked={u.forcePasswordChange}
                    />{" "}
                    force
                  </label>
                </div>
                <div className="text-xs text-zinc-500">
                  Owner: {u.player?.displayName ?? "will be created on save"}
                </div>
                <SubmitButton
                  pendingLabel="Saving user…"
                  className="border px-3 py-2 md:col-span-6"
                >
                  Save User
                </SubmitButton>
              </form>
              <form
                action={async (fd) => {
                  "use server";
                  await requireAdmin();
                  const password = String(fd.get("password") || "");
                  const confirm = String(fd.get("confirmPassword") || "");
                  if (password !== confirm)
                    throw new Error("Passwords must match.");
                  const passwordHash = await hashPassword(password);
                  await prisma.user.update({
                    where: { id: u.id },
                    data: {
                      passwordHash,
                      forcePasswordChange:
                        fd.get("forcePasswordChange") === "on",
                    },
                  });
                  await refresh();
                }}
                className="flex flex-wrap gap-2 items-center text-sm"
              >
                <span className="text-zinc-400">
                  Reset password for {u.username}
                </span>
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  required
                  placeholder="new temporary password"
                  className="border p-2 bg-zinc-900"
                />
                <input
                  name="confirmPassword"
                  type="password"
                  minLength={8}
                  required
                  placeholder="confirm password"
                  className="border p-2 bg-zinc-900"
                />
                <label>
                  <input
                    type="checkbox"
                    name="forcePasswordChange"
                    defaultChecked
                  />{" "}
                  force change
                </label>
                <SubmitButton
                  pendingLabel="Resetting…"
                  className="border px-3 py-2"
                >
                  Reset Password
                </SubmitButton>
              </form>
            </div>
          ))
        ) : (
          <p className="text-sm text-zinc-400">No users yet.</p>
        )}
      </section>
    </main>
  );
}
