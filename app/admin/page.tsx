export const dynamic = "force-dynamic";
import { hashPassword, requireAdminMode } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Nav } from "@/components/Nav";
import { Prisma, UserRole } from "@prisma/client";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  getScryfallRuntimeStatus,
  getExactCardByNameResult,
  formatScryfallError,
} from "@/lib/scryfall";

const panelClass =
  "rounded-lg border border-[#2a332d] bg-[#101614] shadow-sm shadow-black/20";
const panelHeaderClass = "border-b border-[#2a332d] bg-[#121915] px-4 py-3";
const inputClass =
  "rounded-md border border-[#364139] bg-[#0d1210] px-3 py-2 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25";
const selectClass = `${inputClass} pr-8`;
const buttonClass =
  "rounded-md border border-[#364139] bg-[#111715] px-3 py-2 text-sm text-stone-100 transition-colors hover:border-[#4a584d] hover:bg-[#17201b] focus:outline-none focus:ring-2 focus:ring-cyan-500/25";
const primaryButtonClass =
  "rounded-md border border-cyan-700 bg-cyan-950/40 px-3 py-2 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-500 hover:bg-cyan-900/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/35";

async function refresh() {
  "use server";
  await requireAdminMode();
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
  await requireAdminMode();
  const scryfallStatus = getScryfallRuntimeStatus();
  const [users, inventoryCount, openTrades, cachedPrintings, dueForRefresh] =
    await Promise.all([
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
            in: [
              "PROPOSED",
              "ACCEPTED_PENDING_EXCHANGE",
              "PARTIALLY_COMMITTED",
            ],
          },
        },
      }),
      prisma.card.count(),
      prisma.card.count({ where: { lastCheckedAt: null } }),
    ]);

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
            System console
          </p>
          <h1 className="text-3xl font-bold text-stone-50">Admin</h1>
          <p className="text-sm text-stone-400">
            Manage accounts, service health, backups, and card metadata.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Admin tools">
          {[
            ["Backups", "/admin/backups"],
            ["Metadata", "/admin/metadata"],
            ["Pricing", "/admin/prices"],
          ].map(([label, href]) => (
            <a key={href} className={buttonClass} href={href}>
              {label}
            </a>
          ))}
        </nav>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        {[
          ["Users", users.length, "Local accounts"],
          ["Inventory rows", inventoryCount._count, "Active stack records"],
          [
            "Physical cards",
            inventoryCount._sum.quantity ?? 0,
            "Tracked quantity",
          ],
          ["Open trades", openTrades, "Needs attention"],
        ].map(([label, value, note]) => (
          <div key={String(label)} className={`${panelClass} p-4`}>
            <p className="text-xs uppercase tracking-wide text-stone-500">
              {label}
            </p>
            <p className="mt-1 text-2xl font-semibold text-stone-50">
              {String(value)}
            </p>
            <p className="text-xs text-stone-500">{note}</p>
          </div>
        ))}
      </section>

      <section className={panelClass}>
        <div className={panelHeaderClass}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-100">
                Scryfall service
              </h2>
              <p className="text-sm text-stone-400">
                Live lookups use the shared throttled server-side client.
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                await requireAdminMode();
                const result = await getExactCardByNameResult("Sol Ring");
                if (!result.ok)
                  throw new Error(formatScryfallError(result.error));
                revalidatePath("/admin");
              }}
            >
              <SubmitButton
                pendingLabel="Testing Scryfall..."
                className={primaryButtonClass}
              >
                Test Connection
              </SubmitButton>
            </form>
          </div>
        </div>
        <dl className="grid gap-3 p-4 text-sm md:grid-cols-3">
          {[
            ["API base URL", scryfallStatus.apiBaseUrl],
            [
              "Throttle interval",
              `${scryfallStatus.minRequestIntervalMs} ms/request/process`,
            ],
            ["Cached printings", cachedPrintings],
            ["Never checked", dueForRefresh],
            [
              "Last successful request",
              scryfallStatus.lastSuccessfulRequestAt?.toISOString() ??
                "None in this process",
            ],
            [
              "Recent error",
              scryfallStatus.recentErrorKind ?? "None in this process",
            ],
            ["Bulk data path", scryfallStatus.bulkDataPath],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-md border border-[#2a332d] bg-[#0d1210] p-3"
            >
              <dt className="text-xs uppercase tracking-wide text-stone-500">
                {label}
              </dt>
              <dd className="mt-1 break-words text-stone-100">
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={panelClass}>
        <details>
          <summary className={`${panelHeaderClass} cursor-pointer list-none`}>
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="block text-lg font-semibold text-stone-100">
                  Create user
                </span>
                <span className="block text-sm text-stone-400">
                  Add a local login and automatically link an inventory owner.
                </span>
              </span>
              <span className={buttonClass}>New User</span>
            </span>
          </summary>
          <form
            action={async (fd) => {
              "use server";
              await requireAdminMode();
              const password = String(fd.get("password") || "");
              const confirm = String(fd.get("confirmPassword") || "");
              if (password !== confirm)
                throw new Error("Temporary passwords must match.");
              const username = String(fd.get("username")).trim();
              if (!username) throw new Error("Username is required.");
              const email =
                String(fd.get("email") || "")
                  .trim()
                  .toLowerCase() || null;
              const duplicateFilters: Prisma.UserWhereInput[] = [
                { username: { equals: username, mode: "insensitive" } },
              ];
              if (email) {
                duplicateFilters.push({
                  email: { equals: email, mode: "insensitive" },
                });
              }
              const duplicateUser = await prisma.user.findFirst({
                where: {
                  OR: duplicateFilters,
                },
              });
              if (duplicateUser) {
                throw new Error(
                  "A user with that username or email already exists.",
                );
              }
              const displayName = String(
                fd.get("displayName") || username,
              ).trim();
              const passwordHash = await hashPassword(password);
              const playerId = await ensureOwnerForUser(displayName);
              await prisma.user.create({
                data: {
                  username,
                  email,
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
            className="grid gap-3 p-4 md:grid-cols-4"
          >
            <input
              name="username"
              required
              placeholder="Username"
              className={inputClass}
            />
            <input
              name="email"
              placeholder="Email optional"
              className={inputClass}
            />
            <input
              name="displayName"
              placeholder="Display name"
              className={inputClass}
            />
            <select name="role" defaultValue="PLAYER" className={selectClass}>
              <option value="PLAYER">User</option>
              <option value="ADMIN">Admin</option>
            </select>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="Temporary password"
              className={inputClass}
            />
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              placeholder="Confirm password"
              className={inputClass}
            />
            <label className="flex items-center gap-2 rounded-md border border-[#2a332d] bg-[#0d1210] px-3 py-2 text-sm text-stone-300">
              <input
                type="checkbox"
                name="forcePasswordChange"
                defaultChecked
              />{" "}
              force password change
            </label>
            <label className="flex items-center gap-2 rounded-md border border-[#2a332d] bg-[#0d1210] px-3 py-2 text-sm text-stone-300">
              <input type="checkbox" name="isActive" defaultChecked /> active
            </label>
            <SubmitButton
              pendingLabel="Creating user…"
              className={`${primaryButtonClass} md:col-span-4`}
            >
              Create User
            </SubmitButton>
          </form>
        </details>
      </section>

      <section className={panelClass}>
        <div className={panelHeaderClass}>
          <h2 className="text-lg font-semibold text-stone-100">Users</h2>
          <p className="text-sm text-stone-400">
            Review account status, ownership links, and password actions.
          </p>
        </div>
        <div className="divide-y divide-[#2a332d]">
          {users.length ? (
            users.map((u) => (
              <div key={u.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-stone-100">
                        {u.displayName}
                      </h3>
                      <span className="rounded-full border border-[#364139] px-2 py-0.5 text-xs text-stone-300">
                        @{u.username}
                      </span>
                      <span className="rounded-full border border-cyan-900 bg-cyan-950/25 px-2 py-0.5 text-xs text-cyan-100">
                        {u.role === UserRole.ADMIN ? "Admin" : "User"}
                      </span>
                      <span
                        className={
                          u.isActive
                            ? "rounded-full border border-emerald-900 bg-emerald-950/25 px-2 py-0.5 text-xs text-emerald-100"
                            : "rounded-full border border-red-900 bg-red-950/25 px-2 py-0.5 text-xs text-red-100"
                        }
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                      {u.forcePasswordChange ? (
                        <span className="rounded-full border border-amber-900 bg-amber-950/25 px-2 py-0.5 text-xs text-amber-100">
                          Password reset required
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-stone-500">
                      {u.email ?? "No email"} · Owner:{" "}
                      {u.player?.displayName ?? "created on save"}
                    </p>
                  </div>
                </div>
                <details>
                  <summary
                    className={`${buttonClass} inline-flex cursor-pointer list-none`}
                  >
                    Account
                  </summary>
                  <form
                    action={async (fd) => {
                      "use server";
                      await requireAdminMode();
                      const displayName = String(
                        fd.get("displayName") || fd.get("username"),
                      ).trim();
                      const username = String(fd.get("username")).trim();
                      if (!username) throw new Error("Username is required.");
                      const email =
                        String(fd.get("email") || "")
                          .trim()
                          .toLowerCase() || null;
                      const duplicateFilters: Prisma.UserWhereInput[] = [
                        { username: { equals: username, mode: "insensitive" } },
                      ];
                      if (email) {
                        duplicateFilters.push({
                          email: { equals: email, mode: "insensitive" },
                        });
                      }
                      const duplicateUser = await prisma.user.findFirst({
                        where: {
                          id: { not: u.id },
                          OR: duplicateFilters,
                        },
                      });
                      if (duplicateUser) {
                        throw new Error(
                          "A user with that username or email already exists.",
                        );
                      }
                      const playerId = await ensureOwnerForUser(
                        displayName,
                        u.playerId,
                      );
                      await prisma.user.update({
                        where: { id: u.id },
                        data: {
                          username,
                          email,
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
                        data: {
                          displayName,
                          active: fd.get("isActive") === "on",
                        },
                      });
                      await refresh();
                    }}
                    className="mt-3 grid gap-3 md:grid-cols-6"
                  >
                    <input
                      name="username"
                      defaultValue={u.username}
                      className={inputClass}
                    />
                    <input
                      name="email"
                      defaultValue={u.email ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="displayName"
                      defaultValue={u.displayName}
                      className={inputClass}
                    />
                    <select
                      name="role"
                      defaultValue={u.role}
                      className={selectClass}
                    >
                      <option value="PLAYER">User</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                    <div className="flex gap-3 rounded-md border border-[#2a332d] bg-[#0d1210] px-3 py-2 text-sm text-stone-300">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          name="isActive"
                          defaultChecked={u.isActive}
                        />{" "}
                        active
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          name="forcePasswordChange"
                          defaultChecked={u.forcePasswordChange}
                        />{" "}
                        force
                      </label>
                    </div>
                    <div className="rounded-md border border-[#2a332d] bg-[#0d1210] px-3 py-2 text-xs text-stone-500">
                      Owner:{" "}
                      {u.player?.displayName ?? "will be created on save"}
                    </div>
                    <SubmitButton
                      pendingLabel="Saving user…"
                      className={`${primaryButtonClass} md:col-span-6`}
                    >
                      Save User
                    </SubmitButton>
                  </form>
                </details>
                <details>
                  <summary
                    className={`${buttonClass} inline-flex cursor-pointer list-none`}
                  >
                    Reset Password
                  </summary>
                  <form
                    action={async (fd) => {
                      "use server";
                      await requireAdminMode();
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
                    className="mt-3 flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="text-stone-400">
                      Reset password for {u.username}
                    </span>
                    <input
                      name="password"
                      type="password"
                      minLength={8}
                      required
                      placeholder="New temporary password"
                      className={inputClass}
                    />
                    <input
                      name="confirmPassword"
                      type="password"
                      minLength={8}
                      required
                      placeholder="Confirm password"
                      className={inputClass}
                    />
                    <label className="flex items-center gap-1 rounded-md border border-[#2a332d] bg-[#0d1210] px-3 py-2 text-stone-300">
                      <input
                        type="checkbox"
                        name="forcePasswordChange"
                        defaultChecked
                      />{" "}
                      force change
                    </label>
                    <SubmitButton
                      pendingLabel="Resetting…"
                      className={primaryButtonClass}
                    >
                      Reset Password
                    </SubmitButton>
                  </form>
                </details>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-400">No users yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}
