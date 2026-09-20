import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(({ baseURL }) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires local snapshot opt-in",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
});

function database(body: string) {
  execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(()=>{console.error('Synthetic login fixture operation failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8",
    timeout: 30_000,
  });
}

async function account(
  run: (user: { username: string; password: string }) => Promise<void>,
) {
  const username = `ui-login-return-${randomUUID()}`,
    password = randomUUID();
  try {
    database(
      `const passwordHash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.user.create({data:{username:${JSON.stringify(username)},displayName:'Login return fixture',passwordHash,role:'ADMIN'}});`,
    );
    await run({ username, password });
  } finally {
    database(
      `await p.user.deleteMany({where:{username:${JSON.stringify(username)}}});`,
    );
  }
}
async function submitLogin(
  page: Page,
  user: { username: string; password: string },
) {
  await page.getByLabel(/username or email/i).fill(user.username);
  await page.getByLabel(/^password$/i).fill(user.password);
  await page.getByRole("button", { name: /^log in$/i }).click();
}

test("login and admin-mode actions reject tampered external return destinations", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const externalNavigations: string[] = [];
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== baseURL) {
      if (route.request().isNavigationRequest())
        externalNavigations.push("blocked");
      await route.abort();
    } else await route.continue();
  });
  await account(async (user) => {
    await page.goto(
      `/login?returnTo=${encodeURIComponent("https://example.invalid/outside")}`,
    );
    const hidden = page.locator('input[name="returnTo"]');
    await expect(hidden).toHaveValue("/dashboard");
    // Rendering a safe default is insufficient: validate the submitted field too.
    await hidden.evaluate((node: HTMLInputElement) => {
      node.value = "https://example.invalid/outside";
    });
    await submitLogin(page, user);
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    const enter = page.getByRole("button", { name: /enter admin mode/i });
    await enter
      .locator("..")
      .locator('input[name="returnTo"]')
      .evaluate((node: HTMLInputElement) => {
        node.value = "/\\example.invalid/outside";
      });
    await enter.click();
    await expect(
      page.getByRole("button", { name: /exit admin mode/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}/dashboard`);
    expect(externalNavigations).toEqual([]);
  });
});

test("protected-route login and admin-mode toggles preserve the local path and query", async ({
  page,
  baseURL,
}) => {
  await account(async (user) => {
    const destination = "/settings?tab=profile&view=compact";
    await page.goto(destination);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/login" &&
        url.searchParams.get("next") === destination,
    );
    await expect(page.locator('input[name="returnTo"]')).toHaveValue(
      destination,
    );
    await submitLogin(page, { ...user, password: randomUUID() });
    await expect(page).toHaveURL(/\/login\?error=1&next=/);
    await expect(page.locator('input[name="returnTo"]')).toHaveValue(
      destination,
    );
    await submitLogin(page, user);
    await expect(page).toHaveURL(`${baseURL}${destination}`);
    await page.getByRole("button", { name: /enter admin mode/i }).click();
    await expect(
      page.getByRole("button", { name: /exit admin mode/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}${destination}`);
    await page.getByRole("button", { name: /exit admin mode/i }).click();
    await expect(
      page.getByRole("button", { name: /enter admin mode/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}${destination}`);
  });
});
