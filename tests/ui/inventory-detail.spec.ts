import { expect, test as base, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 60_000,
    }),
  );
}

type Account = { username: string; password: string; disposable: boolean };
const test = base.extend<{ account: Account }>({
  account: async ({ baseURL }, use) => {
    if (process.env.MTG_LOCAL_PILOT_TEST !== "1") {
      await use({
        username: process.env.UI_ADMIN_USERNAME || "admin",
        password: process.env.UI_ADMIN_PASSWORD || "admin123",
        disposable: false,
      });
      return;
    }
    expect(baseURL).toBe("http://127.0.0.1:13001");
    const tag = `ui-detail-${randomUUID()}`;
    const password = randomUUID();
    try {
      database(`
        const card=await p.card.findUniqueOrThrow({where:{scryfallId:'a32261f2-164f-4433-bc4c-b5ac591e6a59'}});
        const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);
        await p.$transaction(async tx=>{
          const player=await tx.player.create({data:{name:${JSON.stringify(tag)},displayName:${JSON.stringify(tag)}}});
          await tx.user.create({data:{username:${JSON.stringify(tag)},displayName:'Detail fixture',passwordHash:hash,playerId:player.id}});
          await tx.inventoryItem.create({data:{currentOwnerId:player.id,originalOpenerId:player.id,cardId:card.id,quantity:2,condition:'NM'}});
        });return true;
      `);
      await use({ username: tag, password, disposable: true });
    } finally {
      database(`
        const player=await p.player.findUnique({where:{name:${JSON.stringify(tag)}}});
        if(player) await p.$transaction(async tx=>{
          await tx.inventoryItem.deleteMany({where:{currentOwnerId:player.id}});
          await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:player.id}});
          await tx.user.deleteMany({where:{username:${JSON.stringify(tag)}}});
          await tx.player.delete({where:{id:player.id}});
        });return true;
      `);
    }
  },
});

async function openDetails(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(account.username);
  await page.getByLabel(/^password$/i).fill(account.password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/(dashboard|change-password)/);
  if (page.url().includes("/change-password")) {
    await page.getByLabel(/current password/i).fill(account.password);
    await page.getByLabel(/^new password$/i).fill(account.password);
    await page.getByLabel(/confirm new password/i).fill(account.password);
    await page.getByRole("button", { name: /change password/i }).click();
    await page.waitForURL(/\/dashboard/);
  }
  await page.goto("/inventory?cardName=Hanweir");
  await expect(
    page.getByRole("heading", { level: 1, name: /inventory/i }),
  ).toBeVisible();
  const actions = page.getByLabel(/actions for/i).first();
  if (!account.disposable)
    test.skip(
      (await actions.count()) === 0,
      "Requires a Hanweir inventory row; run the local pilot fixture for deterministic coverage.",
    );
  await expect(actions).toBeVisible();
  await actions.click();
  await page.getByRole("button", { name: "View details" }).click();
  await expect(
    page.getByRole("button", { name: "Close", exact: true }),
  ).toBeVisible();
}

test("inventory detail drawer renders card information blocks", async ({
  page,
  account,
}) => {
  await openDetails(page, account);
  for (const label of [
    "Printing",
    "Treatment",
    "Legalities",
    "Inventory",
    "Price",
    "Copies by location",
  ]) {
    await expect(page.getByText(label, { exact: true }).last()).toBeVisible();
  }
  await expect(
    page.getByRole("link", { name: "View on Scryfall" }).last(),
  ).toBeVisible();
  await expect(page.getByText("Location Summary", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Scryfall fallback prices", { exact: true }),
  ).toHaveCount(0);
});

test("inventory detail drawer supports meld card flip and partner links", async ({
  page,
  account,
}) => {
  await openDetails(page, account);
  await page.getByRole("button", { name: "Show back face" }).click();
  await expect(
    page.getByRole("button", { name: "Show front face" }),
  ).toBeVisible();
  await expect(page.getByText("Meld partner", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Find in inventory" }),
  ).toBeVisible();
  expect(
    await page.getByRole("link", { name: "View on Scryfall" }).count(),
  ).toBeGreaterThanOrEqual(2);
});

test("inventory detail drawer contains focus, closes and restores focus on desktop and phone", async ({
  page,
  account,
}) => {
  await openDetails(page, account);
  const dialog = page.getByRole("dialog", { name: "Hanweir Battlements" });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await close.focus();
  for (let index = 0; index < 18; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.screenshot({ path: "test-results/inventory-detail-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View details" }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Hanweir Battlements", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Hanweir Battlements", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Hanweir Battlements", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: "test-results/inventory-detail-phone.png" });
  await close.click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
});

test("public inventory details retain read-only capabilities and modal keyboard behavior", async ({
  page,
  account,
}) => {
  test.skip(!account.disposable, "Requires isolated visibility fixture");
  const playerId = database<string>(
    `const user=await p.user.update({where:{username:${JSON.stringify(account.username)}},data:{inventoryDefaultVisibility:'PUBLIC'}});return user.playerId;`,
  );
  await page.context().clearCookies();
  await page.goto(`/public/inventory?cardName=Hanweir&ownerId=${playerId}`);
  await page
    .getByRole("button", { name: "Hanweir Battlements", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Hanweir Battlements" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /edit inventory|delete|audit/i }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Show back face" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
