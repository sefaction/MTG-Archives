import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";

// Session credentials must not be recorded in traces, screenshots or videos.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(({ baseURL }) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires local snapshot opt-in",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
});
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Synthetic session fixture operation failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}
async function account(
  run: (user: {
    id: string;
    username: string;
    password: string;
  }) => Promise<void>,
) {
  const username = `ui-session-${randomUUID()}`,
    password = randomUUID();
  try {
    const id = database<string>(
      `const passwordHash=await require('bcryptjs').hash(${JSON.stringify(password)},10);return (await p.user.create({data:{username:${JSON.stringify(username)},displayName:'Session fixture',passwordHash}})).id;`,
    );
    await run({ id, username, password });
  } finally {
    database(
      `const user=await p.user.findUnique({where:{username:${JSON.stringify(username)}},select:{playerId:true}});await p.user.deleteMany({where:{username:${JSON.stringify(username)}}});if(user?.playerId)await p.player.delete({where:{id:user.playerId}});return true;`,
    );
  }
}
async function login(page: Page, user: { username: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(user.username);
  await page.getByLabel(/^password$/i).fill(user.password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/);
}
async function status(context: BrowserContext) {
  return (await context.request.get("/api/notifications/summary")).status();
}

test("identity-only cookies cannot authenticate either current or legacy sessions", async ({
  browser,
  baseURL,
}) => {
  await account(async (user) => {
    const context = await browser.newContext({ baseURL });
    try {
      for (const name of ["mtg_inventory_session", "boxleague_session"]) {
        await context.clearCookies();
        await context.addCookies([{ name, value: user.id, url: baseURL! }]);
        expect(await status(context)).toBe(401);
      }
    } finally {
      await context.close();
    }
  });
});

test("admin reset and account edits revoke sessions; temporary passwords require rotation", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await account(async (admin) =>
    account(async (user) => {
      database(
        `await p.user.update({where:{id:${JSON.stringify(admin.id)}},data:{role:'ADMIN'}});return true;`,
      );
      const contexts = await Promise.all(
        [0, 1].map(() => browser.newContext({ baseURL })),
      );
      try {
        const [management, member] = contexts;
        const adminPage = await management.newPage(),
          memberPage = await member.newPage();
        await login(adminPage, admin);
        await login(memberPage, user);
        await adminPage
          .getByRole("button", { name: /enter admin mode/i })
          .click();
        await expect(
          adminPage.getByRole("button", { name: /exit admin mode/i }),
        ).toBeVisible();
        await adminPage.goto("/admin");
        const reset = adminPage
          .locator("form")
          .filter({ hasText: `Reset password for ${user.username}` });
        await reset.locator("..").locator("summary").click();
        const temporary = randomUUID();
        await reset.getByPlaceholder("New temporary password").fill(temporary);
        await reset.getByPlaceholder("Confirm password").fill(temporary);
        await reset
          .getByRole("button", { name: "Reset Password", exact: true })
          .click();
        await expect.poll(() => status(member)).toBe(401);
        await memberPage.goto("/login");
        await memberPage.getByLabel(/username or email/i).fill(user.username);
        await memberPage.getByLabel(/^password$/i).fill(temporary);
        await memberPage.getByRole("button", { name: /^log in$/i }).click();
        await memberPage.waitForURL(/\/change-password/);
        await expect(
          memberPage.getByText(
            "You must change your temporary password before continuing.",
          ),
        ).toBeVisible();
        const newPassword = randomUUID();
        await memberPage.getByLabel(/current password/i).fill(temporary);
        await memberPage.getByLabel(/^new password$/i).fill(newPassword);
        await memberPage.getByLabel(/confirm new password/i).fill(newPassword);
        await memberPage
          .getByRole("button", { name: /change password/i })
          .click();
        await memberPage.waitForURL(/\/dashboard/);
        expect(await status(member)).toBe(200);
        // Saving a disable then re-enable must not revive the old session.
        await adminPage.reload();
        const form = adminPage
          .locator("form")
          .filter({
            has: adminPage.locator(
              `input[name="username"][value="${user.username}"]`,
            ),
          });
        await form.locator("..").locator("summary").click();
        await form.getByLabel("active", { exact: true }).uncheck();
        await form
          .getByRole("button", { name: "Save User", exact: true })
          .click();
        await expect.poll(() => status(member)).toBe(401);
        await adminPage.reload();
        await form.locator("..").locator("summary").click();
        await form.getByLabel("active", { exact: true }).check();
        await form
          .getByRole("button", { name: "Save User", exact: true })
          .click();
        await expect
          .poll(() =>
            database<boolean>(
              `return (await p.user.findUniqueOrThrow({where:{id:${JSON.stringify(user.id)}},select:{isActive:true}})).isActive;`,
            ),
          )
          .toBe(true);
        expect(await status(member)).toBe(401);
        await member.clearCookies();
        await login(memberPage, { ...user, password: newPassword });
        expect(await status(member)).toBe(200);
        // A non-admin cannot gain privileges by setting the UI mode cookie.
        await member.addCookies([
          { name: "mtg_admin_mode", value: "1", url: baseURL! },
        ]);
        await memberPage.goto("/admin");
        await expect(memberPage).toHaveURL(/\/dashboard\?auth=denied/);
      } finally {
        await Promise.allSettled(contexts.map((context) => context.close()));
      }
    }),
  );
});

test("sessions rotate, expire and revoke across password changes and logout", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await account(async (user) => {
    const contexts = await Promise.all(
      [0, 1, 2].map(() => browser.newContext({ baseURL })),
    );
    try {
      const [a, b, replay] = contexts;
      const page = await a.newPage(),
        other = await b.newPage();
      await login(page, user);
      await login(other, user);
      const cookie = (await a.cookies()).find(
        (c) => c.name === "mtg_inventory_session",
      )!;
      expect(
        Boolean(
          cookie &&
          /^[A-Za-z0-9_-]{43}$/.test(cookie.value) &&
          cookie.value !== user.id,
        ),
      ).toBe(true);
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe("Lax");
      const stored = database<{ tokenHash: string }[]>(
        `return p.authSession.findMany({where:{userId:${JSON.stringify(user.id)}},select:{tokenHash:true}});`,
      );
      expect(stored.length).toBe(2);
      expect(
        stored.some(
          (s) =>
            s.tokenHash ===
            createHash("sha256").update(cookie.value).digest("hex"),
        ),
      ).toBe(true);
      expect(stored.some((s) => s.tokenHash === cookie.value)).toBe(false);
      await replay.addCookies([
        {
          ...cookie,
          value: (cookie.value[0] === "a" ? "b" : "a") + cookie.value.slice(1),
        },
      ]);
      expect(await status(replay)).toBe(401);
      await page.goto("/change-password");
      const changedPassword = randomUUID();
      await page.getByLabel(/current password/i).fill(user.password);
      await page.getByLabel(/^new password$/i).fill(changedPassword);
      await page.getByLabel(/confirm new password/i).fill(changedPassword);
      await page.getByRole("button", { name: /change password/i }).click();
      await page.waitForURL(/\/dashboard/);
      expect(await status(a)).toBe(200);
      expect(await status(b)).toBe(401);
      await replay.clearCookies();
      await replay.addCookies([cookie]);
      expect(await status(replay)).toBe(401);
      const rotated = (await a.cookies()).find(
        (c) => c.name === "mtg_inventory_session",
      )!;
      expect(rotated.value !== cookie.value).toBe(true);
      await page.getByRole("button", { name: "Log out", exact: true }).click();
      await expect.poll(() => status(a)).toBe(401);
      await replay.clearCookies();
      await replay.addCookies([rotated]);
      expect(await status(replay)).toBe(401);
      await login(page, { ...user, password: changedPassword });
      database(
        `await p.authSession.updateMany({where:{userId:${JSON.stringify(user.id)}},data:{expiresAt:new Date(0)}});return true;`,
      );
      expect(await status(a)).toBe(401);
      await a.clearCookies();
      await login(page, { ...user, password: changedPassword });
      database(
        `await p.user.update({where:{id:${JSON.stringify(user.id)}},data:{isActive:false}});return true;`,
      );
      expect(await status(a)).toBe(401);
    } finally {
      await Promise.allSettled(contexts.map((c) => c.close()));
    }
  });
});
