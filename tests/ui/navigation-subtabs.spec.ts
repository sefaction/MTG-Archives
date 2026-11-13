import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test("horizontal sections share one preview row while vertical and phone navigation retain disclosures", async ({ page, browser, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires an owned disposable review database");
  const container = process.env.MTG_NAVIGATION_TEST_CONTAINER ?? "";
  expect(container).toMatch(/^mtg-(navigation-hover|compact-navigation|horizontal-subtabs)-review$/);
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  test.setTimeout(120_000);
  const username = `navigation-${randomUUID()}`;
  const password = randomUUID();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  function database(body: string) {
    return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8", timeout: 30_000,
    }));
  }
  const userId: string = database(`return (await p.user.create({data:{username:${JSON.stringify(username)},displayName:'Navigation reviewer',passwordHash:await require('bcryptjs').hash(${JSON.stringify(password)},10),navigationLayout:'topbar',player:{create:{name:${JSON.stringify(username)},displayName:${JSON.stringify(username)}}}}})).id;`);
  try {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(username);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    const shell = page.locator(".archive-shell");
    const rail = shell.locator(".archive-rail");
    const inventory = rail.getByRole("link", { name: "Inventory", exact: true });
    await inventory.hover();
    await page.screenshot({ path: test.info().outputPath("navigation-subtabs-hover.png") });
    const row = shell.locator(".archive-section-row");
    await expect(row).toBeVisible();
    await expect(row.getByRole("navigation", { name: "Inventory sections" })).toBeVisible();
    await expect(shell.locator(".archive-submenu:visible")).toHaveCount(0);
    await expect(rail.getByRole("button", { name: /sections$/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard/);
    await row.getByRole("link", { name: "Locations", exact: true }).click();
    await expect(page).toHaveURL(/\/locations/);
    await page.mouse.move(1000, 600);
    await expect(row.getByRole("link", { name: "Locations", exact: true })).toHaveAttribute("aria-current", "page");
    const bounds = (await row.boundingBox())!;
    const headerBounds = (await shell.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThan(headerBounds.y + headerBounds.height);
    expect(headerBounds.height).toBeLessThanOrEqual(100);
    const mainLinkBounds = (await inventory.boundingBox())!;
    const accountBounds = (await shell.locator(".archive-account > summary").boundingBox())!;
    expect(Math.abs(mainLinkBounds.y - accountBounds.y)).toBeLessThanOrEqual(8);

    for (const width of [1100, 1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const original = (await row.boundingBox())!;
      for (const name of ["Inventory", "Wishlist", "Trades", "Public"]) {
        await rail.getByRole("link", { name, exact: true }).hover();
        await expect(row.getByRole("navigation")).toHaveCount(1);
        await expect(shell.locator(".archive-submenu:visible")).toHaveCount(0);
        const current = (await row.boundingBox())!;
        expect(current.y).toBe(original.y);
        expect(current.height).toBe(original.height);
        expect(current.x).toBeGreaterThanOrEqual(0);
        expect(current.x + current.width).toBeLessThanOrEqual(width);
        await expect(inventory).toHaveAttribute("aria-current", "location");
      }
      await page.mouse.move(width - 50, 600);
      await expect(row.getByRole("navigation", { name: "Inventory sections" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }

    await rail.getByRole("link", { name: "Wishlist", exact: true }).hover();
    await page.setViewportSize({ width: 960, height: 900 });
    await page.mouse.move(900, 600);
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(row.getByRole("navigation", { name: "Inventory sections" })).toBeVisible();
    const wishlist = rail.getByRole("link", { name: "Wishlist", exact: true });
    await wishlist.focus();
    await page.keyboard.press("ArrowDown");
    await expect(row.getByRole("link", { name: "Combined", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(wishlist).toBeFocused();
    await expect(row.getByRole("navigation", { name: "Inventory sections" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await expect(row.getByRole("link", { name: "Deck needs", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/wishlist\?reason=decks$/);
    await page.mouse.move(1000, 600);
    await expect(row.getByRole("link", { name: "Deck needs", exact: true })).toHaveAttribute("aria-current", "page");
    await inventory.hover();
    await expect(row.getByRole("link", { name: "Deck needs", exact: true })).toHaveCount(0);
    await page.mouse.move(1000, 600);
    await expect(row.getByRole("link", { name: "Deck needs", exact: true })).toHaveAttribute("aria-current", "page");
    await page.screenshot({ path: test.info().outputPath("navigation-subtabs-wishlist.png") });

    for (const [url, label] of [["/wishlist?reason=sets", "Wishlist reason"], ["/trades?view=history", "Trade view"], ["/public/decks", "Public browsing"]]) {
      await page.goto(url);
      await page.mouse.move(1000, 600);
      await expect(row.getByRole("navigation", { name: label, exact: true })).toBeVisible();
      const originalText = await row.innerText();
      await inventory.hover();
      await expect(row.getByRole("navigation", { name: "Inventory sections" })).toBeVisible();
      await page.mouse.move(1000, 600);
      await expect(row.getByRole("navigation", { name: label, exact: true })).toBeVisible();
      expect(await row.innerText()).toBe(originalText);
    }
    await expect(row).toContainText("Public browsing");
    await expect(row.getByRole("link", { name: "Back to my dashboard" })).toHaveAttribute("href", "/dashboard");
    await page.goto("/wishlist?reason=decks");
    await page.mouse.move(1000, 600);
    for (const theme of ["golgari", "azorius", "izzet", "rakdos", "lotus", "selesnya"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const link = row.getByRole("link", { name: "Deck needs", exact: true });
      expect(await link.evaluate(node => getComputedStyle(node).borderTopStyle)).toBe("solid");
      expect(await link.evaluate(node => getComputedStyle(node).fontSize)).toBe("14px");
      await page.screenshot({ path: test.info().outputPath(`navigation-subtabs-${theme}.png`) });
    }

    database(`await p.user.update({where:{id:${JSON.stringify(userId)}},data:{navigationLayout:'sidebar'}});return true;`);
    await page.goto("/dashboard");
    const toggle = rail.getByRole("button", { name: "Inventory sections", exact: true });
    await toggle.focus();
    await page.keyboard.press("Enter");
    const submenu = page.locator("#archive-submenu-inventory");
    await expect(submenu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(submenu).toBeHidden();
    await page.keyboard.press("Enter");
    await submenu.getByRole("link", { name: "Collector", exact: true }).click();
    await expect(page).toHaveURL(/\/collector/);
    await page.screenshot({ path: test.info().outputPath("navigation-subtabs-sidebar.png") });

    database(`await p.user.update({where:{id:${JSON.stringify(userId)}},data:{navigationLayout:'topbar'}});return true;`);
    for (const width of [390, 320]) {
      const touch = await browser.newContext({ baseURL, hasTouch: true, viewport: { width, height: 844 }, storageState: await page.context().storageState() });
      try {
        const phone = await touch.newPage();
        phone.on("pageerror", error => pageErrors.push(error.message));
        await phone.goto("/inventory");
        await phone.locator(".archive-navigation > summary").tap();
        await phone.getByRole("button", { name: "Inventory sections", exact: true }).tap();
        await phone.locator("#archive-submenu-inventory").getByRole("link", { name: "Locations", exact: true }).tap();
        await expect(phone).toHaveURL(/\/locations/);
        await expect(phone.locator(".archive-navigation")).not.toHaveAttribute("open");
        await expect(phone.locator(".archive-section-row").getByRole("navigation", { name: "Inventory sections" })).toBeVisible();
        expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await phone.screenshot({ path: test.info().outputPath(`navigation-subtabs-phone-${width}.png`) });
      } finally { await touch.close(); }
    }
    expect(pageErrors).toEqual([]);
  } finally {
    database(`return p.$transaction(async tx=>{const u=await tx.user.findUniqueOrThrow({where:{id:${JSON.stringify(userId)}},select:{playerId:true}});await tx.inventoryAuditLog.deleteMany({where:{changedByUserId:${JSON.stringify(userId)}}});if(u.playerId)await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:u.playerId}});await tx.user.delete({where:{id:${JSON.stringify(userId)}}});if(u.playerId)await tx.player.delete({where:{id:u.playerId}});return true;});`);
  }
});

test("compact account options preserve Settings, explicit Admin Mode and logout", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires an owned disposable review database");
  const container = process.env.MTG_NAVIGATION_TEST_CONTAINER ?? "";
  expect(container).toMatch(/^mtg-(navigation-hover|compact-navigation|horizontal-subtabs)-review$/);
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const username = `account-${randomUUID()}`;
  const password = randomUUID();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  function database(body: string) {
    execFileSync("docker", ["exec", "-i", container, "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8", timeout: 30_000,
    });
  }
  database(`await p.user.create({data:{username:${JSON.stringify(username)},displayName:'A very long account display name',passwordHash:await require('bcryptjs').hash(${JSON.stringify(password)},10),role:'ADMIN',navigationLayout:'topbar'}});`);
  try {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(username);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    const account = page.locator(".archive-account > summary");
    await expect(account).toHaveAccessibleName("A very long account display name account options");
    const settings = page.locator(".archive-account").getByRole("link", { name: "Settings", exact: true });
    await account.click();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Enter Admin Mode", exact: true })).toBeFocused();
    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(settings).toBeHidden();
    await account.click();
    await page.getByRole("button", { name: "Enter Admin Mode", exact: true }).click();
    await expect(page.getByText("Admin mode is active.", { exact: false })).toBeVisible();
    await expect(account).toContainText("Admin");
    if ((await page.locator(".archive-account").getAttribute("open")) === null) await account.click();
    await expect(page.locator(".archive-account").getByRole("link", { name: "Admin", exact: true })).toHaveAttribute("href", "/admin");
    await page.getByRole("button", { name: "Exit Admin Mode", exact: true }).click();
    await expect(page.getByText("Admin mode is active.", { exact: false })).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    if ((await page.locator(".archive-account").getAttribute("open")) === null) await account.click();
    const panel = (await page.locator(".archive-account-panel").boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath("navigation-account-phone.png") });
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page.locator(".archive-account")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
  } finally {
    database(`await p.user.deleteMany({where:{username:${JSON.stringify(username)}}});`);
  }
});
