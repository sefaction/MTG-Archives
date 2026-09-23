import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });
const quote = JSON.stringify;
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Navigation fixture operation failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

test("account navigation preference persists across sessions, isolates users and preserves desktop/phone routes", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(120_000);
  const tag = `ui-navigation-${randomUUID()}`,
    password = randomUUID();
  const login = async (target: Page, username: string) => {
    await target.goto(`${baseURL}/login`);
    await target.getByLabel(/username or email/i).fill(username);
    await target.getByLabel(/^password$/i).fill(password);
    await target.getByRole("button", { name: /^log in$/i }).click();
    await target.waitForURL(/\/dashboard/);
  };
  try {
    database(
      `return p.$transaction(async tx=>{for(const username of [${quote(tag)},${quote(tag + "-other")}]) {const owner=await tx.player.create({data:{name:username,displayName:username}});await tx.user.create({data:{username,displayName:'Navigation reviewer',passwordHash:await require('bcryptjs').hash(${quote(password)},10),playerId:owner.id}});}return true;});`,
    );
    await page.setViewportSize({ width: 1366, height: 768 });
    await login(page, tag);
    const shell = page.locator(".archive-shell");
    await expect(shell).toHaveAttribute("data-navigation-layout", "sidebar");
    const rail = page.locator(".archive-rail");
    await expect(
      rail.getByText("Account & settings", { exact: true }),
    ).toBeVisible();
    await expect(
      rail.getByRole("link", { name: "Password", exact: true }),
    ).toHaveAttribute("href", "/change-password");
    await expect(
      rail.getByRole("link", { name: "Email delivery", exact: true }),
    ).toHaveAttribute("href", "/settings/email");
    await expect(
      rail.getByRole("link", { name: "Webhooks", exact: true }),
    ).toHaveAttribute("href", "/settings/webhooks");
    await page.goto("/settings");
    await expect(
      page.getByRole("radio", { name: "Sidebar", exact: true }),
    ).toBeChecked();
    await page.getByRole("radio", { name: "Topbar", exact: true }).check();
    // Unsaved choices must not mutate account preferences or the current shell.
    await expect(shell).toHaveAttribute("data-navigation-layout", "sidebar");
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(shell).toHaveAttribute("data-navigation-layout", "topbar");
    const saved = database<{ navigationLayout: string }>(
      `return p.user.findUniqueOrThrow({where:{username:${quote(tag)}},select:{navigationLayout:true}});`,
    );
    expect(saved.navigationLayout).toBe("topbar");
    await page
      .locator(".archive-rail")
      .getByRole("link", { name: "Inventory", exact: true })
      .click();
    await expect(page).toHaveURL(/\/inventory/);
    await expect(shell).toHaveAttribute("data-navigation-layout", "topbar");
    await expect(
      page
        .locator(".archive-rail")
        .getByRole("link", { name: "Inventory", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const filters = page.getByRole("button", {
      name: /advanced inventory search/i,
    });
    const closedFilters = (await filters.boundingBox())!;
    expect(closedFilters.x).toBe(
      (await page.locator(".inventory-workspace").boundingBox())!.x,
    );
    await filters.click();
    await expect(
      page.getByRole("dialog", { name: "Filter inventory" }),
    ).toBeVisible();
    expect((await filters.boundingBox())!.x).toBe(closedFilters.x);
    expect((await filters.boundingBox())!.y).toBe(closedFilters.y);
    await filters.click();
    await expect(
      page.getByRole("dialog", { name: "Filter inventory" }),
    ).not.toBeVisible();
    for (const width of [1440, 1366, 900]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page
          .locator("main")
          .evaluate((node) => getComputedStyle(node).marginLeft),
      ).toBe("0px");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      for (const name of [
        "Inventory",
        "Locations",
        "Decks",
        "Settings",
        "Commander League",
      ]) {
        await expect(
          page
            .locator(".archive-rail")
            .getByRole("link", { name, exact: true }),
        ).toBeVisible();
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const theme of [
      "golgari",
      "azorius",
      "izzet",
      "rakdos",
      "lotus",
      "selesnya",
    ]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.screenshot({
        path: `test-results/navigation-topbar-${theme}.png`,
        animations: "disabled",
      });
    }
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const menu = page.locator(".archive-navigation > summary");
      await expect(menu).toBeVisible();
      await expect(page.locator(".archive-rail")).not.toBeVisible();
      await menu.focus();
      await page.keyboard.press("Enter");
      await expect(
        page
          .locator(".archive-rail")
          .getByRole("link", { name: "Locations", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/navigation-phone-${width}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
    }
    // A fresh browser context has no shared cookies or local storage.
    const fresh = await browser.newContext();
    try {
      const other = await fresh.newPage();
      await login(other, tag);
      await expect(other.locator(".archive-shell")).toHaveAttribute(
        "data-navigation-layout",
        "topbar",
      );
      await other.goto(`${baseURL}/settings`);
      await expect(
        other.getByRole("radio", { name: "Topbar", exact: true }),
      ).toBeChecked();
      await other.getByRole("button", { name: "Log out", exact: true }).click();
      await login(other, tag + "-other");
      await expect(other.locator(".archive-shell")).toHaveAttribute(
        "data-navigation-layout",
        "sidebar",
      );
    } finally {
      await fresh.close();
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/settings");
    await page.getByRole("radio", { name: "Sidebar", exact: true }).check();
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(shell).toHaveAttribute("data-navigation-layout", "sidebar");
    await page.goto("/change-password");
    expect(
      await page
        .locator("main")
        .evaluate((node) => getComputedStyle(node).marginLeft),
    ).toBe("196px");
    await expect(
      page.getByRole("link", { name: "Account", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(shell).toHaveCount(0);
  } finally {
    database(
      `const users=await p.user.findMany({where:{username:{in:[${quote(tag)},${quote(tag + "-other")}] }},select:{id:true,playerId:true}});const ids=users.map(u=>u.id),owners=users.map(u=>u.playerId).filter(Boolean);await p.$transaction(async tx=>{await tx.inventoryAuditLog.deleteMany({where:{changedByUserId:{in:ids}}});await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});await tx.user.deleteMany({where:{id:{in:ids}}});await tx.player.deleteMany({where:{id:{in:owners}}});});return true;`,
    );
  }
});
