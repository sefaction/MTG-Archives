import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
test.skip(
  process.env.MTG_HUNT_WORKSPACE_UI !== "1",
  "Requires the explicitly isolated hunt workspace fixture and fresh browser actors.",
);
const fixtures =
  process.env.MTG_HUNT_WORKSPACE_UI === "1"
    ? JSON.parse(readFileSync(process.env.MTG_HUNT_WORKSPACE_ACCESS!, "utf8"))
    : null;
function db(body: string) {
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", process.env.MTG_HUNT_WORKSPACE_CONTAINER!, "node"],
      {
        input: `const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const u=new URL(process.env.DATABASE_URL);if(!((u.hostname==='hunt-workspace-db'&&u.pathname==='/hunt_workspace_review')||(u.hostname==='marked-pulls-db'&&u.pathname==='/marked_pulls_review')))throw Error('Wrong fixture');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
        encoding: "utf8",
      },
    ),
  );
}
async function login(page: any, f: any) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(f.owner);
  await page.getByLabel(/^password$/i).fill(f.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
}
async function hunt(page: any, f: any) {
  await page.goto("/card-hunt?deckId=" + f.reviewDeck.id);
  await page.getByRole("button", { name: "Build hunt", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Hunt results" }),
  ).toContainText("7 to pull");
}
const tableRows = (page: any) =>
  page.locator('[aria-label="Hunt results"] tbody tr');
const row = (page: any, name: string) =>
  tableRows(page).filter({
    has: page.getByRole("button", { name, exact: true }),
  });
async function more(card: any) {
  if (
    !(await card
      .locator("details")
      .evaluate((node: HTMLDetailsElement) => node.open))
  )
    await card.getByLabel(/Pull options for/).click();
}

test("hunt exclusions, partial pulled state, owned printing and reload preserve physical progress", async ({
  page,
}, info) => {
  const f = fixtures.browse;
  await login(page, f);
  const before = db(
    `return {stock:await p.inventoryItem.findMany({orderBy:{id:'asc'}}),deck:await p.deckCard.findMany({orderBy:{id:'asc'}})};`,
  );
  await hunt(page, f);
  const card = row(page, "Counterspell");
  await expect(card.getByRole("spinbutton")).not.toBeVisible();
  await expect(
    card.getByRole("button", { name: "Mark pulled", exact: true }),
  ).toBeVisible();
  await more(card);
  await card.getByRole("spinbutton").fill("1");
  await card.getByLabel(/Pull options for/).click();
  await expect(card.locator("details")).not.toHaveAttribute("open");
  await expect(
    card.getByRole("button", { name: "Select another printing", exact: true }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Mark pulled", exact: true }).click();
  await expect(card).toContainText("1 pulled");
  await expect(page.getByText(/^1 copies ready/)).toBeVisible();
  await card
    .getByRole("button", { name: "Select another printing", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Owned printings of Counterspell",
  });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("listitem")
    .filter({ hasText: /DMR/ })
    .getByRole("button", { name: "Use this printing" })
    .click();
  await expect(tableRows(page).filter({ hasText: /DMR/ })).toHaveCount(1);
  await expect(tableRows(page).filter({ hasText: /CMM/ })).toContainText(
    "1 pulled",
  );
  await page.getByText(/Locations and exclusions/).click();
  await page
    .getByRole("combobox", { name: "Exclude hunt location" })
    .selectOption(f.box.id);
  await expect(row(page, "Island")).toContainText("Bulk-0001");
  await expect(tableRows(page).filter({ hasText: /CMM/ })).toContainText(
    "Blue-0004",
  );
  await page.reload();
  await expect(tableRows(page).filter({ hasText: /CMM/ })).toContainText(
    "1 pulled",
  );
  await expect(tableRows(page).filter({ hasText: /DMR/ })).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "Hunt layout" })
    .selectOption("boxes");
  await expect(
    page.getByRole("navigation", { name: "Hunt locations" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Hunt layout" })
    .selectOption("inventory");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Binder View", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Island", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "Island", exact: true })
        .evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
    )
    .toBe(true);
  await page.reload();
  await expect(
    page.getByRole("img", { name: "Island", exact: true }),
  ).toBeVisible();
  const islandCard = page
    .locator("article")
    .filter({ has: page.getByRole("img", { name: "Island", exact: true }) });
  await expect(islandCard.locator("details")).not.toHaveAttribute("open");
  await expect(islandCard.getByRole("spinbutton")).not.toBeVisible();
  await expect(
    islandCard.getByRole("button", {
      name: "Select another printing",
      exact: true,
    }),
  ).toBeVisible();
  await islandCard
    .getByRole("button", { name: "Mark pulled", exact: true })
    .click();
  await expect(
    islandCard.getByRole("button", { name: "Unmark pulled", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await islandCard
    .getByRole("button", { name: "Unmark pulled", exact: true })
    .click();
  await expect(
    islandCard.getByRole("button", { name: "Mark pulled", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({
    path: info.outputPath("hunt-binder-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(
    db(
      `return {stock:await p.inventoryItem.findMany({orderBy:{id:'asc'}}),deck:await p.deckCard.findMany({orderBy:{id:'asc'}})};`,
    ),
  ).toEqual(before);
  writeFileSync(
    info.outputPath("planning-conservation.json"),
    JSON.stringify({
      noInventoryOrDeckWrites: true,
      heldPrintingAndSourcePreserved: true,
      reloadWorks: true,
    }),
  );
});

test("bulk cleanup shares the browser, keeps chosen stacks and shows destination capacity", async ({
  page,
}, info) => {
  const f = fixtures.browse;
  await login(page, f);
  await page.goto("/card-hunt?mode=bulk");
  const pane = page.getByRole("region", { name: "Bulk cleanup", exact: true });
  await expect(pane).toContainText("8 excess copies available to pull");
  await expect(
    pane.getByRole("button", { name: "Table View", exact: true }),
  ).toBeVisible();
  const damaged = pane.locator("tbody tr").filter({ hasText: /DMG/ });
  await more(damaged);
  await damaged
    .getByRole("button", {
      name: "Keep this stack / choose other copies",
      exact: true,
    })
    .click();
  await expect(pane.locator("tbody tr").filter({ hasText: /DMG/ })).toHaveCount(
    0,
  );
  await expect(pane).toContainText("8 excess copies available to pull");
  await pane.getByText("Create Bulk Box", { exact: true }).click();
  await pane.getByLabel("Box name", { exact: true }).fill("Small review box");
  await pane.getByLabel("Card capacity", { exact: true }).fill("5");
  await pane.getByRole("button", { name: "Create box", exact: true }).click();
  await expect(
    pane.getByRole("combobox", { name: "Bulk destination" }),
  ).toHaveValue(/.+/);
  while (
    await pane.getByRole("button", { name: "Mark pulled", exact: true }).count()
  ) {
    const count = await pane
      .getByRole("button", { name: "Unmark pulled", exact: true })
      .count();
    await pane
      .getByRole("button", { name: "Mark pulled", exact: true })
      .first()
      .click();
    await expect(
      pane.getByRole("button", { name: "Unmark pulled", exact: true }),
    ).toHaveCount(count + 1);
  }
  await expect(pane.getByText("8 copies ready", { exact: true })).toBeVisible();
  await pane
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await expect(pane.getByText("0 copies ready", { exact: true })).toBeVisible();
  await pane
    .getByRole("button", { name: "Select all marked", exact: true })
    .click();
  await expect(pane.getByText("8 copies ready", { exact: true })).toBeVisible();
  await expect(pane.getByRole("alert")).toContainText(
    "does not have enough space",
  );
  await expect(
    pane.getByRole("button", { name: "Review selected pulls" }),
  ).toBeDisabled();
  await pane
    .getByRole("combobox", { name: "Bulk destination" })
    .selectOption(f.destination.id);
  await expect(
    pane.getByRole("button", { name: "Review selected pulls" }),
  ).toBeEnabled();
  await expect(pane).toContainText("1,000 spaces available");
  await pane.screenshot({
    path: info.outputPath("bulk-workspace-desktop.png"),
  });
  await pane.getByRole("button", { name: "Binder View", exact: true }).click();
  await expect(
    pane.getByRole("img", { name: "Sol Ring", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("bulk-phone.png"),
    fullPage: true,
  });
  await page.goto("/locations?selected=" + f.box.id);
  await page
    .getByRole("button", { name: "Mark box as bulk storage", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Return box to normal storage",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return box to normal storage", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mark box as bulk storage", exact: true }),
  ).toBeVisible();
});

test("an alternate-printing commit recovers a lost reply once and keeps the correct deck printing", async ({
  page,
}, info) => {
  const f = fixtures.actions;
  await login(page, f);
  await hunt(page, f);
  const card = row(page, "Counterspell");
  await card
    .getByRole("button", { name: "Select another printing", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("listitem")
    .filter({ hasText: /DMR/ })
    .getByRole("button", { name: "Use this printing" })
    .click();
  await row(page, "Counterspell")
    .getByRole("button", { name: "Mark pulled", exact: true })
    .click();
  await expect(page.getByText(/^2 copies ready/)).toBeVisible();
  await page
    .getByRole("button", { name: "Commit selected to decks", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("DMR");
  let dropped = false;
  await page.route("**/api/card-hunt/actions", async (route) => {
    if (!dropped && route.request().method() === "POST") {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Confirm commit of 2 copies", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Check same confirmation",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Check same confirmation", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const result = db(
    `return {rows:await p.deckCard.findMany({where:{deckId:${JSON.stringify(f.reviewDeck.id)},cardName:'Counterspell'}}),stock:await p.inventoryItem.findMany({where:{location:{deckId:${JSON.stringify(f.reviewDeck.id)}},cardId:${JSON.stringify(f.alternate.id)}}})};`,
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].cardId).toBe(f.alternate.id);
  expect(result.stock.reduce((n: number, r: any) => n + r.quantity, 0)).toBe(2);
  await page.goto("/inventory?cardName=Counterspell");
  await expect(
    page.getByRole("button", { name: "Table View", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Table View", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: /Total cards/ }),
  ).toBeVisible();
  await expect(
    page.locator(".inventory-results tbody tr").filter({ hasText: /FOIL/ }),
  ).not.toHaveCount(0);
  await page.goto("/public/wishlist/" + f.owner);
  await expect(
    page.getByRole("button", { name: "Counterspell", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("cumulative-wishlist.png"),
    fullPage: true,
  });
  writeFileSync(
    info.outputPath("printing-commit.json"),
    JSON.stringify({
      lostResponseRecoveredOnce: true,
      actualPrintingInDeck: true,
      inventoryAndWishlistStillWork: true,
    }),
  );
});

test("bulk movement preserves provenance and recovers the same confirmation after a lost reply", async ({
  page,
}, info) => {
  const f = fixtures.bulk;
  await login(page, f);
  await page.goto("/card-hunt?mode=bulk");
  const pane = page.getByRole("region", { name: "Bulk cleanup", exact: true });
  await expect(pane).toContainText("8 excess copies available to pull");
  await pane
    .getByRole("combobox", { name: "Bulk destination" })
    .selectOption(f.destination.id);
  while (
    await pane.getByRole("button", { name: "Mark pulled", exact: true }).count()
  ) {
    const count = await pane
      .getByRole("button", { name: "Unmark pulled", exact: true })
      .count();
    await pane
      .getByRole("button", { name: "Mark pulled", exact: true })
      .first()
      .click();
    await expect(
      pane.getByRole("button", { name: "Unmark pulled", exact: true }),
    ).toHaveCount(count + 1);
  }
  await expect(pane.getByText("5 copies ready", { exact: true })).toBeVisible();
  await pane
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await expect(pane.getByText("0 copies ready", { exact: true })).toBeVisible();
  await pane
    .getByRole("button", { name: "Select all marked", exact: true })
    .click();
  await expect(pane.getByText("5 copies ready", { exact: true })).toBeVisible();
  await pane
    .getByRole("button", { name: "Review selected pulls", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Bulk-0002");
  await expect(
    dialog.getByText("Using your marked pulled copies."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm move", exact: true }),
  ).toBeEnabled();
  let dropped = false;
  await page.route("**/api/bulk-cleanup", async (route) => {
    const body = route.request().postDataJSON();
    if (!dropped && body?.action === "MOVE") {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Confirm move", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Check same confirmation",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Check same confirmation", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(pane).toContainText("3 excess copies available to pull");
  await expect(pane.getByText("0 copies ready", { exact: true })).toBeVisible();
  const moved = db(
    `return {items:await p.inventoryItem.findMany({where:{locationId:${JSON.stringify(f.destination.id)}}}),actions:await p.bulkCleanupAction.count({where:{actorUserId:${JSON.stringify(f.owner)},action:'MOVE'}})};`,
  );
  expect(moved.actions).toBe(1);
  expect(moved.items.reduce((n: number, row: any) => n + row.quantity, 0)).toBe(
    5,
  );
  expect(
    moved.items.find((row: any) => row.originalOpenerId === f.recipient).notes,
  ).toBe(f.normal.notes);
  await page.screenshot({
    path: info.outputPath("bulk-move-completed.png"),
    fullPage: true,
  });
});

test("marked bulk copies stay ready across filters and a partial move", async ({
  page,
}, info) => {
  test.skip(!fixtures?.partial, "Requires marked-pulls fixture.");
  const f = fixtures.partial;
  await login(page, f);
  await page.goto("/card-hunt?mode=bulk");
  const pane = page.getByRole("region", { name: "Bulk cleanup", exact: true });
  const card = pane
    .locator("tbody tr")
    .filter({ hasText: "Counterspell" })
    .filter({ hasText: /NM/ });
  await card.getByRole("button", { name: "Mark pulled", exact: true }).click();
  await expect(pane.getByText("3 copies ready", { exact: true })).toBeVisible();
  const search = pane.getByPlaceholder(/Search card name/);
  await search.fill("no-card-has-this-name");
  await expect(pane.locator("tbody tr")).toHaveCount(0);
  await expect(pane.getByText("3 copies ready", { exact: true })).toBeVisible();
  await pane
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await pane
    .getByRole("button", { name: "Select all marked", exact: true })
    .click();
  await expect(pane.getByText("3 copies ready", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(card).toContainText("3 pulled");
  await more(card);
  await card.getByRole("spinbutton").fill("1");
  await pane
    .getByRole("combobox", { name: "Bulk destination" })
    .selectOption(f.destination.id);
  await pane
    .getByRole("button", { name: "Review selected pulls", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("1 selected copy");
  await expect(dialog).toContainText("Using your marked pulled copies.");
  await dialog
    .getByRole("button", { name: "Confirm move", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(pane.getByText("2 copies ready", { exact: true })).toBeVisible();
  await expect(card).toContainText("2 pulled");
  await page.reload();
  await expect(pane.getByText("2 copies ready", { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("marked-remainder.png"),
    fullPage: true,
  });
});

test("excess scans save to the chosen Bulk Box section once and normal import excludes them", async ({
  page,
}, info) => {
  test.skip(!fixtures?.scans, "Requires marked-pulls fixture.");
  const f = fixtures.scans;
  await login(page, f);
  await page.goto("/imports/scan?batch=" + fixtures.current.id);
  const pane = page.getByRole("region", { name: "Excess scans", exact: true });
  await expect(pane).toContainText("3 confirmed scans to pull");
  await pane
    .getByRole("button", { name: "Review pull list", exact: true })
    .click();
  await pane
    .getByRole("combobox", { name: "Bulk destination" })
    .selectOption(f.destination.id);
  await pane
    .getByRole("combobox", { name: "Bulk destination section" })
    .selectOption("1");
  await expect(
    pane.getByRole("combobox", { name: "Excess scan action" }),
  ).toHaveValue("MOVE");
  await pane
    .getByRole("button", { name: "Select this page", exact: true })
    .click();
  await pane.screenshot({ path: info.outputPath("scan-bulk-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("scan-bulk-phone.png"),
    fullPage: true,
  });
  await pane
    .getByRole("button", {
      name: "Add selected scans to Bulk Box",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("button", {
      name: "Confirm add to Bulk Box",
      exact: true,
    }),
  });
  await expect(dialog).toContainText("Destination: Bulk-0002 / 1");
  await dialog
    .getByLabel("I have physically pulled these selected cards.")
    .check();
  let dropped = false;
  await page.route("**/api/bulk-cleanup", async (route) => {
    if (!dropped && route.request().postDataJSON()?.action === "MOVE_SCANS") {
      dropped = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort();
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Confirm add to Bulk Box", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Check same confirmation", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(pane).toContainText("Moved 3 copies to Bulk-0002.");
  const saved = db(
    `return {members:await p.acquisitionCommitMember.count({where:{runId:${JSON.stringify(fixtures.current.run.id)}}}),older:await p.acquisitionCommitMember.count({where:{runId:${JSON.stringify(fixtures.older.run.id)}}}),ignored:await p.acquisitionCandidate.count({where:{runId:${JSON.stringify(fixtures.current.run.id)},ignored:true}}),lots:await p.inventoryItem.findMany({where:{locationId:${JSON.stringify(f.destination.id)}}}),actions:await p.bulkCleanupAction.count({where:{actorUserId:${JSON.stringify(f.owner)},action:'MOVE_SCANS'}})};`,
  );
  expect(saved.members).toBe(3);
  expect(saved.older).toBe(0);
  expect(saved.ignored).toBe(0);
  expect(saved.actions).toBe(1);
  expect(saved.lots.reduce((n: number, r: any) => n + r.quantity, 0)).toBe(3);
  expect(
    saved.lots.every(
      (r: any) =>
        r.locationSection === "1" &&
        r.sourceType === "ACQUISITION" &&
        r.cardId === f.alternate.id,
    ),
  ).toBe(true);
  const preview = await page.request.post(
    "/api/acquisition/" + fixtures.current.id + "/commit",
    {
      headers: { origin: "http://127.0.0.1:13515" },
      data: {
        action: "preview-confirmed",
        locationId: f.box.id,
        section: "0",
        excludedPhotoIds: [],
      },
    },
  );
  expect(preview.ok()).toBe(true);
  expect((await preview.json()).count).toBe(2);
  await page.screenshot({
    path: info.outputPath("scan-diverted.png"),
    fullPage: true,
  });
});
