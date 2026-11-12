import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test("section shortcuts support hover, keyboard, touch and persistent header tabs", async ({ page, browser, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires an owned disposable review database");
  const container = process.env.MTG_NAVIGATION_TEST_CONTAINER ?? "";
  expect(container).toMatch(/^mtg-(navigation-hover|compact-navigation)-review$/);
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  test.setTimeout(120_000);
  const username = `navigation-${randomUUID()}`;
  const password = randomUUID();
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
    const rail = page.locator(".archive-rail");
    const inventory = rail.getByRole("link", { name: "Inventory", exact: true });
    await inventory.hover();
    const submenu = page.locator("#archive-submenu-inventory");
    await expect(submenu).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.screenshot({ path: "test-results/navigation-subtabs-hover.png" });
    await page.keyboard.press("Escape");
    await expect(submenu).toBeHidden();
    await page.mouse.move(1000, 700);
    await inventory.hover();
    await submenu.getByRole("link", { name: "Locations", exact: true }).click();
    await expect(page).toHaveURL(/\/locations/);
    const tabs = page.getByRole("navigation", { name: "Inventory sections" });
    await expect(tabs.getByRole("link", { name: "Locations", exact: true })).toHaveAttribute("aria-current", "page");
    expect(await tabs.evaluate(node => node.closest(".archive-shell") !== null)).toBe(true);
    const tabBounds = (await tabs.boundingBox())!;
    const headerBounds = (await page.locator(".archive-shell").boundingBox())!;
    expect(tabBounds.y + tabBounds.height).toBeLessThan(headerBounds.y + headerBounds.height);
    expect(headerBounds.height).toBeLessThanOrEqual(90);
    const mainLinkBounds=(await inventory.boundingBox())!;
    const account=page.locator('.archive-account > summary');
    const accountBounds=(await account.boundingBox())!;
    expect(Math.abs(mainLinkBounds.y-accountBounds.y)).toBeLessThanOrEqual(8);
    await expect(page.getByRole('link',{name:'Settings',exact:true})).toBeHidden();
    await account.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link',{name:'Settings',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Log out',exact:true})).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter Admin Mode", exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(account).toBeFocused();
    await expect(page.getByRole('link',{name:'Settings',exact:true})).toBeHidden();
    await page.screenshot({ path: "test-results/navigation-subtabs-inventory.png" });
    for (const width of [1100, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ["Inventory", "Wishlist", "Trades", "Public"]) {
        await rail.getByRole("link", { name, exact: true }).hover();
        const panel = page.locator(".archive-submenu:visible");
        await expect(panel).toHaveCount(1);
        const bounds = (await panel.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
    }

    const toggle = rail.getByRole("button", { name: "Inventory sections", exact: true });
    await page.mouse.move(1000, 700);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(submenu.getByRole("link", { name: "Cards", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(submenu).toBeHidden();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await rail.getByRole("link", { name: "Decks", exact: true }).focus();
    await expect(submenu).toBeHidden();
    await inventory.hover();
    await rail.getByRole("link", { name: "Wishlist", exact: true }).hover();
    await expect(submenu).toBeHidden();
    await expect(page.locator("#archive-submenu-wishlist")).toBeVisible();
    await page.mouse.move(1000, 700);
    await expect(page.locator("#archive-submenu-wishlist")).toBeHidden();

    for (const [url, label] of [["/wishlist?reason=sets", "Wishlist reason"], ["/trades?view=history", "Trade view"], ["/public/decks", "Public browsing"]]) {
      await page.goto(url);
      await expect(page.locator(".archive-shell").getByRole("navigation", { name: label, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: "test-results/navigation-subtabs-desktop.png" });
    database(`await p.user.update({where:{id:${JSON.stringify(userId)}},data:{navigationLayout:'sidebar'}});return true;`);
    await page.goto("/dashboard");
    await rail.getByRole("button", { name: "Inventory sections", exact: true }).focus();
    await page.keyboard.press("Enter");
    await submenu.getByRole("link", { name: "Collector", exact: true }).click();
    await expect(page).toHaveURL(/\/collector/);
    await expect(page.locator(".archive-shell").getByRole("navigation", { name: "Inventory sections" })).toBeVisible();

    const touch = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 320, height: 844 }, storageState: await page.context().storageState() });
    try {
      const phone = await touch.newPage();
      await phone.goto("/inventory");
      const menu = phone.locator(".archive-navigation > summary");
      await menu.tap();
      await phone.getByRole("button", { name: "Inventory sections", exact: true }).tap();
      await phone.locator("#archive-submenu-inventory").getByRole("link", { name: "Locations", exact: true }).tap();
      await expect(phone).toHaveURL(/\/locations/);
      await expect(phone.locator(".archive-navigation")).not.toHaveAttribute("open");
      await expect(phone.locator(".archive-shell").getByRole("navigation", { name: "Inventory sections" })).toBeVisible();
      await phone.locator('.archive-account > summary').tap();
      await expect(phone.getByRole('link',{name:'Settings',exact:true})).toBeVisible();
      await phone.getByRole('heading',{name:'Locations',exact:true}).tap();
      await expect(phone.getByRole('link',{name:'Settings',exact:true})).toBeHidden();
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await phone.screenshot({ path: "test-results/navigation-subtabs-phone.png" });
    } finally { await touch.close(); }
  } finally {
    database(`return p.$transaction(async tx=>{const u=await tx.user.findUniqueOrThrow({where:{id:${JSON.stringify(userId)}},select:{playerId:true}});await tx.inventoryAuditLog.deleteMany({where:{changedByUserId:${JSON.stringify(userId)}}});if(u.playerId)await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:u.playerId}});await tx.user.delete({where:{id:${JSON.stringify(userId)}}});if(u.playerId)await tx.player.delete({where:{id:u.playerId}});return true;});`);
  }
});


test("compact account options preserve Settings, explicit Admin Mode and logout", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires an owned disposable review database");
  const container = process.env.MTG_NAVIGATION_TEST_CONTAINER ?? "";
  expect(container).toMatch(/^mtg-(navigation-hover|compact-navigation)-review$/);
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const username = `account-${randomUUID()}`;
  const password = randomUUID();
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
    await page.screenshot({ path: "test-results/navigation-account-phone.png" });
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page.locator(".archive-account")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
  } finally {
    database(`await p.user.deleteMany({where:{username:${JSON.stringify(username)}}});`);
  }
});
