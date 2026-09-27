import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

test.use({ trace: "off", screenshot: "off", video: "off" });

function database(body: string) {
  execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30_000,
  });
}

function adminRoutes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return adminRoutes(path);
    if (entry.name !== "page.tsx") return [];
    return [`/${dirname(relative("app", path)).split(sep).join("/")}`];
  });
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test("every admin page requires an admin role and explicit admin mode", async ({ browser, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires a disposable local snapshot");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(180_000);
  const tag = `ui-admin-routes-${randomUUID()}`;
  const password = randomUUID();
  const routes = adminRoutes("app/admin");
  expect(routes).toHaveLength(6);
  const anonymous = await browser.newContext({ baseURL });
  const member = await browser.newContext({ baseURL });
  const admin = await browser.newContext({ baseURL });
  try {
    database(`const tag=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);for(const [suffix,role] of [['member','PLAYER'],['admin','ADMIN']]){const name=tag+'-'+suffix;const owner=await p.player.create({data:{name,displayName:name}});await p.user.create({data:{username:name,displayName:name,role,passwordHash:hash,playerId:owner.id}})}`);
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto(routes[0]);
    await expect(anonymousPage).toHaveURL(/\/login/);

    const memberPage = await member.newPage();
    await login(memberPage, `${tag}-member`, password);
    for (const route of routes) {
      await memberPage.goto(route);
      await expect(memberPage, `member access to ${route}`).toHaveURL(/\/dashboard/);
    }

    const adminPage = await admin.newPage();
    await login(adminPage, `${tag}-admin`, password);
    await adminPage.goto(routes[0]);
    await expect(adminPage).toHaveURL(/\/dashboard/);
    await adminPage.getByRole("button", { name: /enter admin mode/i }).click();
    await expect(adminPage.getByRole("button", { name: /exit admin mode/i })).toBeVisible();
    for (const route of routes) {
      const response = await adminPage.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${route} response`).toBeLessThan(500);
      await expect(adminPage, `active admin access to ${route}`).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[?#]|$)`));
      await expect(adminPage.locator("main").first()).toBeVisible();
    }
    await adminPage.getByRole("button", { name: /exit admin mode/i }).click();
    await expect(adminPage.getByRole("button", { name: /enter admin mode/i })).toBeVisible();
    await adminPage.goto(routes[0]);
    await expect(adminPage).toHaveURL(/\/dashboard/);
  } finally {
    await Promise.all([anonymous.close(), member.close(), admin.close()]);
    database(`await p.user.deleteMany({where:{username:{startsWith:${JSON.stringify(tag)}}}});await p.player.deleteMany({where:{name:{startsWith:${JSON.stringify(tag)}}}})`);
  }
});
