import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}
async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/dashboard/);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    page.url(),
  ).toBe(true);
}

test("Administration retains maintenance capabilities with task navigation, bounded histories and nonblocking exact pricing totals", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(240_000);
  const tag = `ui-admin-${randomUUID()}`,
    password = randomUUID();
  const anonymous = await browser.newContext({ baseURL });
  const member = await browser.newContext({ baseURL });
  const endpoint = "/api/admin/pricing/history-totals";
  try {
    database(`const tag=${quote(tag)};const passwordHash=await require('bcryptjs').hash(${quote(password)},10);
      for(const [suffix,role] of [['admin','ADMIN'],['member','PLAYER'],['edit','PLAYER']]) {
        const player=await p.player.create({data:{name:tag+'-'+suffix,displayName:tag+' '+suffix}});
        const user=await p.user.create({data:{username:tag+'-'+suffix,displayName:tag+' '+suffix,role,passwordHash,playerId:player.id}});
        if(suffix==='admin') for(let index=0;index<55;index++) await p.notification.create({data:{recipientUserId:user.id,type:'system.delivery_diagnostic',category:'system',title:tag+' job '+index,sourceType:'delivery_diagnostic',sourceId:tag+'-'+index,deliveryJobs:{create:{sourceType:'delivery_diagnostic',sourceId:tag+'-'+index,transport:'diagnostic',destinationKey:'admin:'+user.id,payloadJson:{mode:'success'},status:'FAILED',attemptCount:5,maxAttempts:5,nextAttemptAt:null}}}});
      }return true;`);
    expect((await anonymous.request.get(endpoint)).status()).toBe(401);
    const memberPage = await member.newPage();
    await login(memberPage, tag + "-member", password);
    expect((await member.request.get(endpoint)).status()).toBe(403);
    await memberPage.goto("/admin");
    await expect(memberPage).toHaveURL(/dashboard/);
    await login(page, tag + "-admin", password);
    expect((await page.request.get(endpoint)).status()).toBe(403);
    await page
      .getByRole("button", { name: "Enter Admin Mode", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Exit Admin Mode", exact: true }),
    ).toBeVisible();
    await page.goto("/admin");
    const nav = page.getByRole("navigation", {
      name: "Administration",
      exact: true,
    });
    await expect(
      nav.getByRole("link", { name: "Overview", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("region", { name: "User accounts" }),
    ).toHaveCount(0);
    await page
      .locator("summary")
      .filter({ hasText: "Connection diagnostics" })
      .click();
    await expect(page.getByText("API base URL", { exact: true })).toBeVisible();
    await nav.getByRole("link", { name: "Users", exact: true }).click();
    await expect(
      nav.getByRole("link", { name: "Users", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByLabel("Find a user", { exact: true }).fill(tag + "-edit");
    await page
      .getByRole("button", { name: "Search users", exact: true })
      .click();
    const accounts = page.getByRole("region", { name: "User accounts" });
    await expect(accounts.getByRole("heading", { level: 3 })).toHaveCount(1);
    await accounts
      .locator("summary")
      .filter({ hasText: /^Account$/ })
      .click();
    await accounts
      .getByLabel("Display name", { exact: true })
      .fill(tag + " renamed");
    await accounts
      .getByRole("button", { name: "Save User", exact: true })
      .click();
    await expect(accounts.getByRole("heading", { level: 3 })).toHaveText(
      tag + " renamed",
    );
    expect(
      database<string>(
        `return (await p.user.findUniqueOrThrow({where:{username:${quote(tag + "-edit")}}})).displayName;`,
      ),
    ).toBe(tag + " renamed");
    await accounts
      .locator("summary")
      .filter({ hasText: /^Reset Password$/ })
      .click();
    await expect(
      accounts.getByRole("button", { name: "Reset Password", exact: true }),
    ).toBeVisible();
    await page.goto("/admin/notifications");
    await page.getByLabel("Find a recent job", { exact: true }).fill(tag);
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("FAILED");
    await page
      .getByRole("button", { name: "Filter jobs", exact: true })
      .click();
    const jobs = page.getByRole("region", { name: "Recent delivery jobs" });
    await expect(jobs.locator("article")).toHaveCount(30);
    expect(
      await jobs.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await jobs
      .getByRole("button", { name: "Retry now", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("Failed delivery released back to the queue."),
    ).toBeVisible();
    expect(
      database<number>(
        `return p.notificationDeliveryJob.count({where:{sourceId:{startsWith:${quote(tag)}},maxAttempts:6}});`,
      ),
    ).toBe(1);
    await page
      .locator("summary")
      .filter({ hasText: /^Queue diagnostics$/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Queue success test" }),
    ).toBeVisible();
    await page.goto("/admin/backups");
    await expect(
      page.getByRole("button", { name: "Upload Backup", exact: true }),
    ).toBeHidden();
    await page
      .locator("summary")
      .filter({ hasText: /^Upload backup$/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Upload Backup", exact: true }),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Storage and restore guidance" })
      .click();
    await expect(
      page.getByText("Restore command", { exact: true }),
    ).toBeVisible();
    if (
      await page
        .locator("summary")
        .filter({ hasText: "Restore options" })
        .count()
    ) {
      await page
        .locator("summary")
        .filter({ hasText: "Restore options" })
        .first()
        .click();
      await expect(
        page.getByPlaceholder("RESTORE", { exact: true }).first(),
      ).toBeVisible();
      await page
        .locator("summary")
        .filter({ hasText: "Delete options" })
        .first()
        .click();
      await expect(
        page.getByPlaceholder("DELETE", { exact: true }).first(),
      ).toBeVisible();
    }
    let totalRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith(endpoint)) totalRequests++;
    });
    const initialStart = Date.now();
    await page.goto("/admin/prices");
    await expect(
      page.getByRole("heading", { name: "Pricing worker", exact: true }),
    ).toBeVisible();
    const initialMs = Date.now() - initialStart;
    expect(initialMs).toBeLessThan(10_000);
    expect(totalRequests).toBe(0);
    await expect(
      page.getByText("History totals have not been loaded."),
    ).toBeVisible();
    const totalsResponse = page.waitForResponse(
      (response) => response.url().endsWith(endpoint),
      { timeout: 70_000 },
    );
    await page
      .getByRole("button", { name: "Load history totals", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Calculating" }),
    ).toBeVisible();
    const concurrentStart = Date.now();
    expect(
      (await page.request.get("/dashboard", { timeout: 10_000 })).status(),
    ).toBe(200);
    const concurrentMs = Date.now() - concurrentStart;
    expect(concurrentMs).toBeLessThan(5000);
    const response = await totalsResponse;
    expect(response.status()).toBe(200);
    const totals = await response.json();
    expect(totals.snapshotCount).toBeGreaterThan(0);
    await expect(
      page.getByRole("region", { name: "Historical price coverage" }),
    ).toContainText(totals.snapshotCount.toLocaleString());
    console.log(
      JSON.stringify({
        pricingHealthMs: initialMs,
        concurrentDashboardMs: concurrentMs,
        snapshots: totals.snapshotCount,
      }),
    );
    // Error and retry remain truthful; never replace missing totals with zero.
    await page.goto("/admin/prices");
    await page.route("**" + endpoint, (route) =>
      route.fulfill({
        status: 503,
        body: "{}",
        contentType: "application/json",
      }),
    );
    await page
      .getByRole("button", { name: "Load history totals", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Unable to load history totals" }),
    ).toBeVisible();
    await expect(
      page.getByText("Historical snapshots", { exact: true }),
    ).toHaveCount(0);
    await page.unroute("**" + endpoint);
    await page
      .getByRole("button", { name: "Load history totals", exact: true })
      .click();
    await expect(
      page.getByText("Historical snapshots", { exact: true }),
    ).toBeVisible();

    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
      for (const [name, path] of [
        ["overview", "/admin"],
        ["users", "/admin?view=users&q=" + tag],
        ["backups", "/admin/backups"],
        ["metadata", "/admin/metadata"],
        ["prices", "/admin/prices"],
        ["notifications", "/admin/notifications"],
        ["announcements", "/admin/notifications/trade-announcements"],
      ]) {
        await page.goto(path);
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
        await noOverflow(page);
        if (name === "prices") {
          await page
            .locator("summary")
            .filter({ hasText: "Run history and detailed logs" })
            .click();
          await noOverflow(page);
          await expect(
            page.getByRole("heading", { name: "Worker logs", exact: true }),
          ).toBeVisible();
        }
        if (width !== 320)
          await page.screenshot({
            path: `test-results/admin-${name}-${width}.png`,
            fullPage: true,
          });
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/admin?view=users&q=" + tag);
    for (const theme of [
      "golgari",
      "azorius",
      "rakdos",
      "lotus",
      "selesnya",
      "izzet",
    ]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await noOverflow(page);
      await expect(
        nav.getByRole("link", { name: "Users", exact: true }),
      ).toHaveCSS(
        "color",
        await page.evaluate(() => getComputedStyle(document.body).color),
      );
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await noOverflow(page);
    await accounts.focus();
    await expect(accounts).toBeFocused();
  } catch (error) {
    console.error("Administration workflow failure:", error);
    throw error;
  } finally {
    // Clean database fixtures even if Playwright context teardown stalls.
    // The browser fixture owns and closes both additional contexts.
    database(
      `await p.user.deleteMany({where:{username:{startsWith:${quote(tag)}}}});await p.player.deleteMany({where:{name:{startsWith:${quote(tag)}}}});return true;`,
    );
  }
});
