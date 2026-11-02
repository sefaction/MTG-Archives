import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";

const fixtureSchema = z.object({
  version: z.literal(1),
  source: z.string().regex(/^[a-f0-9]{40}$/),
  baseURL: z.string().url(),
  users: z.tuple([z.object({ username: z.string().regex(/^photo-match-[a-f0-9]{32}-a$/), password: z.string().uuid() }).strict(),
    z.object({ username: z.string().regex(/^photo-match-[a-f0-9]{32}-b$/), password: z.string().uuid() }).strict()]),
  locations: z.tuple([z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict(),
    z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict(),
    z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict()]),
  cardId: z.string().uuid(),
}).strict();

test("matching photo warnings retain separate copies, whole-batch scope and current retakes", async ({ browser }, info) => {
  test.skip(process.env.MTG_PHOTO_MATCH_TEST !== "1", "Requires a separately owned disposable warning fixture");
  test.setTimeout(180000);
  // The controller admits and verifies its exact web/DB images, members and
  // loopback publication before issuing these synthetic credentials. This test
  // performs only authenticated HTTP actions, never Docker or direct SQL.
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(process.env.MTG_PHOTO_MATCH_FIXTURE!, "utf8")));
  const url = new URL(fixture.baseURL);
  expect(url.protocol).toBe("http:"); expect(url.hostname).toBe("127.0.0.1");
  expect(url.origin).toBe(fixture.baseURL); expect(url.port).not.toBe("13001");
  expect(url.username + url.password + url.search + url.hash).toBe("");
  const contexts: BrowserContext[] = [];
  const png = (r: number, g: number, b: number) => sharp({ create: { width: 80, height: 120,
    channels: 3, background: { r, g, b } } }).png().toBuffer();
  const original = await png(12, 34, 56);
  const upload = (name: string, buffer: Buffer) => ({ name, mimeType: "image/png", buffer });
  async function login(index: 0 | 1) {
    const context = await browser.newContext({ baseURL: fixture.baseURL, viewport: { width: 1366, height: 844 } });
    contexts.push(context); const page = await context.newPage();
    await page.route("https://cards.scryfall.io/**", route => route.abort());
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(fixture.users[index].username);
    await page.getByLabel(/^password$/i).fill(fixture.users[index].password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/); return { page, context };
  }
  async function start(page: Page, index: 0 | 1 | 2) {
    await page.goto("/imports/scan?input=photos");
    await page.getByTestId("storage-destination").getByRole("combobox").fill(fixture.locations[index].name);
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: /^A\s/ }).click();
    await page.getByRole("button", { name: "Start batch", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("batch")).toBeTruthy();
    return new URL(page.url()).searchParams.get("batch")!;
  }
  async function state(context: BrowserContext, id: string) {
    const response = await context.request.get(`/api/acquisition/${id}`);
    expect(response.status()).toBe(200); return response.json();
  }
  async function ready(context: BrowserContext, id: string, count: number) {
    await expect.poll(async () => {
      const progress = await state(context, id);
      return progress.slots.filter((slot: any) => slot.photos.some((photo: any) => photo.ready && !photo.purgedAt && photo.generation === slot.generation)).length;
    }, { timeout: 30000 }).toBe(count);
  }
  try {
    const foreign = await login(1), foreignId = await start(foreign.page, 2);
    await foreign.page.getByLabel("Choose card photos").setInputFiles(upload("foreign.png", original));
    await ready(foreign.context, foreignId, 1);
    const own = await login(0), otherId = await start(own.page, 1);
    await own.page.getByLabel("Choose card photos").setInputFiles(upload("other-batch.png", original));
    await ready(own.context, otherId, 1);
    expect((await own.context.request.get(`/api/acquisition/${foreignId}`)).status()).toBe(403);
    const id = await start(own.page, 0);
    await own.page.getByLabel("Choose card photos").setInputFiles(upload("first.png", original));
    await ready(own.context, id, 1);
    await expect(own.page.getByRole("heading", { name: /1 of 15 cards/ })).toBeVisible();
    await expect(own.page.getByText(/This photo file appears/)).toHaveCount(0);
    let lost = 0;
    await own.page.route(`**/api/acquisition/${id}/photos?*`, async route => {
      if (!lost) {
        lost++; expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    const remaining = [];
    for (let i = 1; i < 14; i++) remaining.push(upload(`different-${i}.png`, await png(30 + i * 11, 40 + i * 13, (50 + i * 17) % 256)));
    remaining.push(upload("same-file-separate-card.png", original));
    await own.page.getByLabel("Choose card photos").setInputFiles(remaining);
    await ready(own.context, id, 15); expect(lost).toBe(1);
    const progress = await state(own.context, id);
    expect(progress.reservedSlots).toBe(15); expect(progress.availableSlots).toBe(0);
    expect(new Set(progress.slots.map((slot: any) => slot.id)).size).toBe(15);
    const first = progress.slots[0].photos.find((photo: any) => photo.ready && photo.generation === progress.slots[0].generation);
    const last = progress.slots[14].photos.find((photo: any) => photo.ready && photo.generation === progress.slots[14].generation);
    expect(first.id).not.toBe(last.id); expect(first.digest).toBe(last.digest);
    const warning = own.page.getByTestId("capture-card-1").getByText(/This photo file appears 2 times in this batch/);
    await expect(warning).toBeVisible();
    // The matching fifteenth slot is beyond the initial twelve-card view.
    // Count is still two, unaffected by the other owner or separate batch.
    if (progress.phase === "CAPTURING") {
      const stopped = await own.context.request.post(`/api/acquisition/${id}`, { headers: { origin: fixture.baseURL },
        data: { action: "control", command: "STOP", revision: progress.revision, requestKey: randomUUID() } });
      expect(stopped.status()).toBe(200);
    } else expect(["STOPPING", "COMPLETE"]).toContain(progress.phase);
    for (const photo of [first, last]) {
      const review = await own.context.request.get(`/api/acquisition/${id}/review?photoId=${photo.id}`);
      expect(review.status()).toBe(200); const details = await review.json();
      const saved = await own.context.request.post(`/api/acquisition/${id}/review`, { headers: { origin: fixture.baseURL },
        data: { action: "accept", photoId: photo.id, revision: details.revision,
          decision: { cardId: fixture.cardId, language: "en", finish: "NONFOIL", condition: "NM" } } });
      expect(saved.status()).toBe(200);
    }
    const preview = await own.context.request.post(`/api/acquisition/${id}/commit`, { headers: { origin: fixture.baseURL },
      data: { action: "preview", locationId: fixture.locations[0].id, section: "A", photoIds: [first.id, last.id] } });
    expect(preview.status()).toBe(200); expect((await preview.json()).count).toBe(2);
    await own.page.reload(); await expect(warning).toBeVisible();
    await expect(own.page.getByTestId("capture-card-1").getByRole("button", { name: "Continue to Inventory", exact: true })).toBeEnabled();
    for (const width of [1366, 390, 320]) {
      await own.page.setViewportSize({ width, height: 844 });
      await own.page.getByTestId("capture-card-1").scrollIntoViewIfNeeded();
      await expect(warning).toBeVisible();
      expect(await own.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await own.page.screenshot({ path: info.outputPath(`matching-photo-${width}.png`) });
    }
    await own.page.getByTestId("capture-card-1").getByRole("button", { name: "Retake", exact: true }).click();
    await own.page.getByLabel("Choose card photos").setInputFiles(upload("retake.png", await png(201, 17, 68)));
    await expect.poll(async () => {
      const next = await state(own.context, id);
      return next.slots[0].generation === 2 && next.slots[0].photos[0].ready;
    }, { timeout: 30000 }).toBe(true);
    await expect(own.page.getByText(/This photo file appears/)).toHaveCount(0);
    await expect(own.page.getByRole("heading", { name: /15 of 15 cards/ })).toBeVisible();
    const after = await state(own.context, id);
    expect(after.reservedSlots).toBe(15); expect(after.availableSlots).toBe(0);
    expect(after.slots[0].photos).toHaveLength(2);
    expect(after.slots[0].photos[1].digest).toBe(last.digest);
    expect(after.slots[0].photos[0].digest).not.toBe(last.digest);
    expect(new Set(after.slots.map((slot: any) => slot.id))).toEqual(new Set(progress.slots.map((slot: any) => slot.id)));
    expect(after.slots.some((slot: any) => slot.committed)).toBe(false);
    writeFileSync(info.outputPath("matching-photo-workflow.json"), JSON.stringify({ source: fixture.source,
      ownBatch: id, otherBatch: otherId, foreignBatch: foreignId, physicalSlots: 15, currentPhotos: 15,
      rawPhotosInMainBatch: after.slots.reduce((sum: number, slot: any) => sum + slot.photos.length, 0),
      lostResponseReplays: lost, matchingCountBeforeRetake: 2, sameFileCopiesHaveDistinctIds: true,
      previewCount: 2, committedSlots: 0, crossOwnerRefused: true, otherBatchExcluded: true,
      currentRetakeRemovesWarning: true, originalSlotIdsPreserved: true, widths: [1366, 390, 320] }, null, 2));
  } finally {
    for (const context of contexts.reverse()) await context.close();
  }
});
