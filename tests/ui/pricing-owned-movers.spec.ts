import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { refreshPricingSummariesSql } from "../../scripts/pricing-summary-sql";

test.use({ trace: "off", screenshot: "off", video: "off" });

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

function pricingSql(source: string) {
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
    { input: source, encoding: "utf8", timeout: 30_000 },
  ).trim();
}

test("owned movers use a $2 daily change and link to honest card history", async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Local snapshot only");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90_000);
  const tag = `ui-pricing-movers-${randomUUID()}`;
  const password = randomUUID();
  const names = [
    "Rare gain",
    "Ordinary noise",
    "Meaningful loss",
    "Stale gain",
    "No prior",
    "Foil gain",
    "Sold card",
    "Zero baseline",
  ];
  const uuids = names.map(() => randomUUID());
  const quote = JSON.stringify;
  let ownerId: string | null = null;
  try {
    const fixture = database<{ ownerId: string; cards: string[] }>(
      `const tag=${quote(tag)};const owner=await p.player.create({data:{name:tag,displayName:'Mover owner'}});await p.user.create({data:{username:tag,displayName:'Mover owner',playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});const names=${quote(names)};const uuids=${quote(uuids)};const cards=[];for(let i=0;i<names.length;i++){const card=await p.card.create({data:{name:tag+' '+names[i],scryfallId:require('node:crypto').randomUUID(),mtgjsonUuid:uuids[i],typeLine:'Artifact',setCode:'tst',collectorNumber:String(i+1),rarity:'rare',prices:{}}});cards.push(card.id);if(i!==6){const quantity=i===0?2:1;await p.inventoryItem.create({data:{currentOwnerId:owner.id,originalOpenerId:owner.id,cardId:card.id,quantity,foilStatus:i===5?'FOIL':'NONFOIL',condition:'NM',sourceType:'MANUAL'}});if(i===0)await p.inventoryItem.create({data:{currentOwnerId:owner.id,originalOpenerId:owner.id,cardId:card.id,quantity:1,condition:'NM',sourceType:'MANUAL'}});}}return {ownerId:owner.id,cards};`,
    );
    ownerId = fixture.ownerId;
    const values = [
      [0, "normal", "CURRENT_DATE - 4015", 4],
      [0, "normal", "CURRENT_DATE - 1095", 5],
      [0, "normal", "CURRENT_DATE - 130", 7],
      [0, "normal", "CURRENT_DATE - 1", 10],
      [0, "normal", "CURRENT_DATE", 15],
      [1, "normal", "CURRENT_DATE - 1", 1],
      [1, "normal", "CURRENT_DATE", 2],
      [2, "normal", "CURRENT_DATE - 1", 8],
      [2, "normal", "CURRENT_DATE", 5],
      [3, "normal", "CURRENT_DATE - 4", 3],
      [3, "normal", "CURRENT_DATE - 3", 7],
      [4, "normal", "CURRENT_DATE", 11],
      [5, "foil", "CURRENT_DATE - 1", 1],
      [5, "foil", "CURRENT_DATE", 4],
      [6, "normal", "CURRENT_DATE - 1", 1],
      [6, "normal", "CURRENT_DATE", 10],
      [7, "normal", "CURRENT_DATE - 1", 0],
      [7, "normal", "CURRENT_DATE", 3],
    ] as const;
    pricingSql(
      `INSERT INTO price_snapshots (mtgjson_uuid,provider,finish,price_type,currency,observed_date,price) VALUES ${values.map(([index, finish, date, price]) => `('${uuids[index]}','tcgplayer','${finish}','retail','USD',${date},${price})`).join(",")};`,
    );
    pricingSql(
      `INSERT INTO price_snapshots (mtgjson_uuid,provider,finish,price_type,currency,observed_date,price) VALUES ('${uuids[0]}','tcgplayer','normal','retail','EUR',CURRENT_DATE - 1,4),('${uuids[0]}','tcgplayer','normal','retail','EUR',CURRENT_DATE,7);`,
    );
    const keys = uuids.map((uuid, index) => ({
      mtgjson_uuid: uuid,
      provider: "tcgplayer",
      finish: index === 5 ? "foil" : "normal",
      price_type: "retail",
      currency: "USD",
    }));
    keys.push({
      mtgjson_uuid: uuids[0],
      provider: "tcgplayer",
      finish: "normal",
      price_type: "retail",
      currency: "EUR",
    });
    pricingSql(
      `${refreshPricingSummariesSql(JSON.stringify(keys))} UPDATE price_summary_state SET ready=TRUE, source_max_id=(SELECT MAX(id) FROM price_snapshots), refreshed_at=now() WHERE singleton=TRUE;`,
    );
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.goto("/pricing?view=market");
    await expect(
      page.getByRole("link", { name: "Owned movers" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Top gainers table" }),
    ).toContainText("Rare gain");
    await expect(
      page.getByRole("region", { name: "Top gainers table" }),
    ).not.toContainText("Ordinary noise");
    await expect(
      page.getByRole("region", { name: "Top gainers table" }),
    ).not.toContainText("Sold card");
    await expect(
      page.getByRole("region", { name: "Top losers table" }),
    ).toContainText("Meaningful loss");
    await expect(page.getByText("Stale observation").first()).toBeVisible();
    await expect(page.getByText(/have no prior observation/)).toBeVisible();
    await expect(
      page.getByRole("row", { name: /Zero baseline/ }).first(),
    ).toContainText("--");
    await expect(
      page.getByRole("region", { name: "Top gainers table" }),
    ).toContainText("$15.00");
    await page
      .getByRole("link", { name: new RegExp(`${tag} Rare gain`) })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/pricing/card/${fixture.cards[0]}`),
    );
    await expect(
      page.getByRole("heading", { name: /Daily observations/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Card price observations" }),
    ).toContainText("$15.00");
    pricingSql(
      `UPDATE price_snapshots SET price=16, created_at=now() WHERE mtgjson_uuid='${uuids[0]}' AND provider='tcgplayer' AND finish='normal' AND price_type='retail' AND currency='USD' AND observed_date=CURRENT_DATE; ${refreshPricingSummariesSql(JSON.stringify([keys[0]]))} UPDATE price_summary_state SET source_max_id=(SELECT MAX(id) FROM price_snapshots), refreshed_at=now() WHERE singleton=TRUE;`,
    );
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Card price observations" }),
    ).toContainText("$16.00");
    await page.goto("/pricing?view=market");
    await expect(
      page.getByRole("row", { name: new RegExp(`${tag} Rare gain`) }).first(),
    ).toContainText("$18.00");
    await page
      .getByRole("link", { name: new RegExp(`${tag} Rare gain`) })
      .first()
      .click();
    await page.getByRole("link", { name: "Long term" }).click();
    await expect(
      page.getByRole("heading", { name: /Tiered observations/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Card price observations" }),
    ).toContainText("yearly");
    await expect(
      page.getByRole("region", { name: "Card price observations" }),
    ).toContainText("monthly");
    await expect(
      page.getByRole("region", { name: "Card price observations" }),
    ).toContainText("weekly");
    await page.goto("/pricing?view=market&finish=foil");
    await expect(
      page.getByRole("region", { name: "Top gainers table" }),
    ).toContainText("Foil gain");
    await expect(
      page.getByRole("region", { name: "Top gainers table" }),
    ).not.toContainText("Rare gain");
    await page.goto("/pricing?view=market&currency=EUR");
    await expect(
      page.getByRole("region", { name: "Top gainers table" }),
    ).toContainText("Rare gain");
    await expect(
      page.getByRole("region", { name: "Top gainers table" }),
    ).not.toContainText("Meaningful loss");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("link", { name: "Owned movers" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    if (ownerId)
      database(
        `const id=${quote(ownerId)};await p.inventoryItem.deleteMany({where:{currentOwnerId:id}});await p.user.deleteMany({where:{playerId:id}});await p.player.delete({where:{id}});await p.card.deleteMany({where:{name:{startsWith:${quote(tag)}}}});return true;`,
      );
    pricingSql(
      `DELETE FROM price_monthly_summary WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); DELETE FROM price_scope_summary WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); DELETE FROM price_daily_summary WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); DELETE FROM price_snapshots WHERE mtgjson_uuid IN (${uuids.map((u) => `'${u}'`).join(",")}); UPDATE price_summary_state SET source_max_id=(SELECT MAX(id) FROM price_snapshots), refreshed_at=now() WHERE singleton=TRUE;`,
    );
  }
});
