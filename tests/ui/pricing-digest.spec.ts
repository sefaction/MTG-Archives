import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { refreshPricingSummariesSql } from "../../scripts/pricing-summary-sql";
import { pricingSnapshotUpsertSql } from "../../scripts/pricing-snapshot-upsert-sql";

test.use({ trace: "off", screenshot: "off", video: "off" });

function appDb<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 60_000,
    }),
  );
}

function pricingSql(sql: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "mtg-archives-pricing-postgres-1",
      "psql",
      "-U",
      "mtgpricing",
      "-d",
      "mtgpricing",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: sql, encoding: "utf8", timeout: 60_000 },
  ).trim();
}

test("daily Pricing digest is opt-in, bounded, owner-scoped and replay-safe", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Local snapshot only");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(120_000);
  const tag = `ui-pricing-digest-${randomUUID()}`;
  const password = randomUUID();
  const uuids = Array.from({ length: 113 }, () => randomUUID());
  const quote = JSON.stringify;
  let ownerIds: string[] = [];
  execFileSync("docker", ["pause", "mtg-archives-notification-worker-1"]);
  try {
    const fixture = appDb<{ ownerIds: string[]; userIds: string[] }>(
      `const tag=${quote(tag)};const uuids=${quote(uuids)};const ownerIds=[];const userIds=[];for(let ownerIndex=0;ownerIndex<4;ownerIndex++){const owner=await p.player.create({data:{name:tag+'-'+ownerIndex,displayName:'Digest owner '+ownerIndex}});const user=await p.user.create({data:{username:tag+'-'+ownerIndex,displayName:'Digest owner '+ownerIndex,playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});ownerIds.push(owner.id);userIds.push(user.id);await p.pricingAlertPreference.create({data:{userId:user.id,enabled:ownerIndex!==3,enabledAt:new Date(Date.now()-86400000),provider:'tcgplayer',finish:'normal',priceType:'retail',currency:'USD'}});}for(let i=0;i<uuids.length;i++){const card=await p.card.create({data:{name:tag+' Card '+i,scryfallId:require('node:crypto').randomUUID(),mtgjsonUuid:uuids[i],typeLine:'Artifact',setCode:'tst',collectorNumber:String(i+1),rarity:'rare',prices:{}}});const ownerIndex=i<110?0:i-109;await p.inventoryItem.create({data:{currentOwnerId:ownerIds[ownerIndex],originalOpenerId:ownerIds[ownerIndex],cardId:card.id,quantity:i===0?3:1,condition:'NM',sourceType:'MANUAL'}});}return {ownerIds,userIds};`,
    );
    ownerIds = fixture.ownerIds;
    const values = uuids.flatMap((uuid, i) => {
      const current =
        i < 105 ? 13 : i < 110 ? 11 : i === 110 ? 14 : i === 111 ? 7 : 14;
      return [
        `('${uuid}','tcgplayer','normal','retail','USD',CURRENT_DATE - 2,10,CURRENT_DATE - 2 + INTERVAL '12 hours')`,
        `('${uuid}','tcgplayer','normal','retail','USD',CURRENT_DATE - 1,${current},CURRENT_DATE - 1 + INTERVAL '12 hours')`,
      ];
    });
    values.push(
      `('${uuids[0]}','tcgplayer','normal','retail','USD',CURRENT_DATE - 3,8,CURRENT_DATE - 3 + INTERVAL '12 hours')`,
    );
    pricingSql(
      `INSERT INTO price_snapshots (mtgjson_uuid,provider,finish,price_type,currency,observed_date,price,created_at) VALUES ${values.join(",")};`,
    );
    const keys = uuids.map((uuid) => ({
      mtgjson_uuid: uuid,
      provider: "tcgplayer",
      finish: "normal",
      price_type: "retail",
      currency: "USD",
    }));
    pricingSql(
      `${refreshPricingSummariesSql(JSON.stringify(keys))} UPDATE price_summary_state SET ready=TRUE, source_max_id=(SELECT MAX(id) FROM price_snapshots), refreshed_at=now() WHERE singleton=TRUE;`,
    );
    const runDigest = () =>
      execFileSync(
        "docker",
        [
          "exec",
          "mtg-archives-web-1",
          "./node_modules/.bin/tsx",
          "-e",
          "import {processDailyPricingDigests} from './lib/pricing-notification-digests'; processDailyPricingDigests().then(console.log)",
        ],
        { encoding: "utf8", timeout: 90_000 },
      );
    runDigest();
    runDigest();
    const state = appDb<{
      counts: number[];
      details: {
        totalMovers: number;
        shown: number;
        impact: number;
        source: string;
      };
      deliveries: number;
    }>(
      `const userIds=${quote(fixture.userIds)};const counts=[];for(const userId of userIds)counts.push(await p.notification.count({where:{recipientUserId:userId,sourceType:'pricing_digest'}}));const digest=await p.notification.findFirst({where:{recipientUserId:userIds[0],sourceType:'pricing_digest'}});const deliveries=await p.notificationDeliveryJob.count({where:{notification:{recipientUserId:{in:userIds},sourceType:'pricing_digest'}}});return {counts,details:{totalMovers:digest.metadataJson.totalMovers,shown:digest.metadataJson.shownMovers.length,impact:digest.metadataJson.shownMovers[0].collectionImpact,source:digest.metadataJson.provider},deliveries};`,
    );
    expect(state.counts).toEqual([1, 1, 1, 0]);
    expect(state.details).toEqual({
      totalMovers: 105,
      shown: 100,
      impact: 9,
      source: "tcgplayer",
    });
    expect(state.deliveries).toBe(0);

    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(`${tag}-0`);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.goto("/settings/pricing-alerts");
    await expect(
      page.getByRole("checkbox", {
        name: /Enable daily in-app Pricing digests/,
      }),
    ).toBeChecked();
    await expect(
      page.getByRole("link", { name: /105 owned price movers/ }),
    ).toBeVisible();
    await page.getByRole("link", { name: /105 owned price movers/ }).click();
    await expect(
      page.getByRole("region", { name: "Pricing digest movements" }),
    ).toContainText(`${tag} Card 0`);
    await expect(
      page.getByRole("region", { name: "Pricing digest movements" }),
    ).not.toContainText(`${tag} Card 110`);
    await expect(
      page.getByText(/Showing the 100 largest impacts of 105/),
    ).toBeVisible();
    const secondContext = await browser.newContext();
    try {
      const secondPage = await secondContext.newPage();
      await secondPage.goto(`${baseURL}/login`);
      await secondPage.getByLabel(/username or email/i).fill(`${tag}-1`);
      await secondPage.getByLabel(/^password$/i).fill(password);
      await secondPage.getByRole("button", { name: /^log in$/i }).click();
      await secondPage.waitForURL(/dashboard/);
      await secondPage.goto(`${baseURL}/settings/pricing-alerts`);
      await secondPage
        .getByRole("link", { name: /1 owned price mover/ })
        .click();
      const secondDigest = secondPage.getByRole("region", {
        name: "Pricing digest movements",
      });
      await expect(secondDigest).toContainText(`${tag} Card 110`);
      await expect(secondDigest).not.toContainText(`${tag} Card 0 (`);
    } finally {
      await secondContext.close();
    }
    const priorDate = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    pricingSql(
      `${pricingSnapshotUpsertSql([
        {
          mtgjsonUuid: uuids[0],
          provider: "tcgplayer",
          finish: "normal",
          priceType: "retail",
          currency: "USD",
          observedDate: priorDate,
          price: 12,
        },
        {
          mtgjsonUuid: uuids[1],
          provider: "tcgplayer",
          finish: "normal",
          priceType: "retail",
          currency: "USD",
          observedDate: yesterday,
          price: 11,
        },
      ])}`,
    );
    expect(
      pricingSql(
        `SELECT source_revision > summary_revision FROM price_summary_state WHERE singleton=TRUE;`,
      ),
    ).toBe("t");
    await page.goto("/pricing?view=market");
    await expect(
      page.getByText(
        /Pricing analytics are unavailable: Pricing summaries are rebuilding/,
      ),
    ).toBeVisible();
    pricingSql(
      `${refreshPricingSummariesSql(JSON.stringify(keys.slice(0, 2)))} UPDATE price_summary_state SET source_max_id=(SELECT MAX(id) FROM price_snapshots), summary_revision=source_revision, refreshed_at=now() WHERE singleton=TRUE;`,
    );
    expect(
      pricingSql(
        `SELECT revision_count,price FROM price_snapshots WHERE mtgjson_uuid='${uuids[0]}' AND observed_date=CURRENT_DATE-2;`,
      ),
    ).toBe("1|12.0000");
    expect(
      pricingSql(
        `SELECT revision_count,price FROM price_snapshots WHERE mtgjson_uuid='${uuids[1]}' AND observed_date=CURRENT_DATE-1;`,
      ),
    ).toBe("1|11.0000");
    const tomorrowDate = new Date(Date.now() + 86_400_000);
    tomorrowDate.setUTCHours(3, 0, 0, 0);
    const tomorrow = tomorrowDate.toISOString();
    execFileSync(
      "docker",
      [
        "exec",
        "mtg-archives-web-1",
        "./node_modules/.bin/tsx",
        "-e",
        `import {processDailyPricingDigests} from './lib/pricing-notification-digests'; processDailyPricingDigests(new Date('${tomorrow}')).then(console.log)`,
      ],
      { encoding: "utf8", timeout: 90_000 },
    );
    execFileSync(
      "docker",
      ["exec", "mtg-archives-web-1", "./node_modules/.bin/tsx", "-e",
        `import {processDailyPricingDigests} from './lib/pricing-notification-digests'; processDailyPricingDigests(new Date('${tomorrow}')).then(console.log)`],
      { encoding: "utf8", timeout: 90_000 },
    );
    const corrected = appDb<{
      counts: number[];
      movement: {
        currentDate: string;
        isCorrection: boolean;
        currentPrice: number;
      };
      retracted: { currentPrice: number; previouslyAlertedPrice: number; currentDate: string }[];
      deliveries: number;
    }>(
      `const ids=${quote(fixture.userIds)};const day=new Date().toISOString().slice(0,10);const counts=[];for(const recipientUserId of ids)counts.push(await p.notification.count({where:{recipientUserId,sourceType:'pricing_digest'}}));const n=await p.notification.findUnique({where:{recipientUserId_sourceType_sourceId:{recipientUserId:ids[0],sourceType:'pricing_digest',sourceId:day}}});const deliveries=await p.notificationDeliveryJob.count({where:{notification:{recipientUserId:{in:ids},sourceType:'pricing_digest'}}});return {counts,movement:n.metadataJson.shownMovers[0],retracted:n.metadataJson.retractedMovers,deliveries};`,
    );
    expect(corrected.counts).toEqual([2, 1, 1, 0]);
    expect(corrected.movement.isCorrection).toBe(true);
    expect(corrected.movement.currentPrice).toBe(12);
    expect(corrected.retracted).toEqual(expect.arrayContaining([
      expect.objectContaining({ currentPrice: 11, previouslyAlertedPrice: 13, currentDate: yesterday }),
    ]));
    expect(corrected.deliveries).toBe(0);
    await page.goto("/settings/pricing-alerts");
    await page
      .getByRole("link", { name: /1 owned price mover, 1 corrected below threshold imported/ })
      .click();
    await expect(page.getByText("Corrected observation")).toBeVisible();
    await expect(page.getByRole("region", { name: "Corrected Pricing alerts" })).toContainText(`${tag} Card 1`);
    await expect(
      page.getByRole("region", { name: "Pricing digest movements" }),
    ).toContainText(`${tag} Card 0`);
    pricingSql(
      pricingSnapshotUpsertSql([
        {
          mtgjsonUuid: uuids[0],
          provider: "tcgplayer",
          finish: "normal",
          priceType: "retail",
          currency: "USD",
          observedDate: priorDate,
          price: 12,
        },
      ]),
    );
    expect(
      pricingSql(
        `SELECT revision_count FROM price_snapshots WHERE mtgjson_uuid='${uuids[0]}' AND observed_date=CURRENT_DATE-2;`,
      ),
    ).toBe("1");
  } finally {
    try {
      if (ownerIds.length) {
        appDb(
          `const ids=${quote(ownerIds)};const users=await p.user.findMany({where:{playerId:{in:ids}},select:{id:true}});await p.notificationDeliveryJob.deleteMany({where:{notification:{recipientUserId:{in:users.map(x=>x.id)},sourceType:'pricing_digest'}}});await p.notification.deleteMany({where:{recipientUserId:{in:users.map(x=>x.id)},sourceType:'pricing_digest'}});await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});await p.user.deleteMany({where:{playerId:{in:ids}}});await p.player.deleteMany({where:{id:{in:ids}}});await p.card.deleteMany({where:{name:{startsWith:${quote(tag)}}}});return true;`,
        );
      }
      pricingSql(
        `DO $pricing_cleanup$ BEGIN IF to_regclass('price_weekly_summary') IS NOT NULL THEN DELETE FROM price_weekly_summary WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); END IF; IF to_regclass('price_yearly_summary') IS NOT NULL THEN DELETE FROM price_yearly_summary WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); END IF; END $pricing_cleanup$; DELETE FROM price_monthly_summary WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); DELETE FROM price_scope_summary WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); DELETE FROM price_daily_summary WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); DELETE FROM price_snapshots WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); UPDATE price_summary_state SET source_max_id=(SELECT MAX(id) FROM price_snapshots), refreshed_at=now() WHERE singleton=TRUE;`,
      );
    } finally {
      execFileSync("docker", ["unpause", "mtg-archives-notification-worker-1"]);
    }
  }
});
