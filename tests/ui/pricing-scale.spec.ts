import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 120_000,
    }),
  );
}

function measurements(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samples,
  };
}

test("Pricing stays available at the largest local owned-printing scope", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot and summary backfill",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(240_000);
  const tag = `ui-pricing-scale-${randomUUID()}`;
  const password = randomUUID();
  const quote = JSON.stringify;
  let printings = 0;
  try {
    printings = database<number>(`const tag=${quote(tag)};
      const [source]=await p.$queryRaw\`SELECT "currentOwnerId" FROM "InventoryItem"
        WHERE quantity > 0 GROUP BY "currentOwnerId" ORDER BY count(*) DESC LIMIT 1\`;
      const items=await p.inventoryItem.findMany({where:{currentOwnerId:source.currentOwnerId,quantity:{gt:0},card:{mtgjsonUuid:{not:null}}},
        select:{cardId:true,quantity:true,foil:true,foilStatus:true,condition:true,language:true,card:{select:{mtgjsonUuid:true}}}});
      const owner=await p.player.create({data:{name:tag,displayName:'Pricing scale fixture'}});
      await p.user.create({data:{username:tag,displayName:'Pricing scale fixture',playerId:owner.id,
        passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
      for(let i=0;i<items.length;i+=500){await p.inventoryItem.createMany({data:items.slice(i,i+500).map(item=>({
        currentOwnerId:owner.id,originalOpenerId:owner.id,cardId:item.cardId,quantity:item.quantity,
        foil:item.foil,foilStatus:item.foilStatus,condition:item.condition,language:item.language,sourceType:'MANUAL'}))});}
      return new Set(items.map(item=>item.card.mtgjsonUuid)).size;`);
    expect(printings).toBeGreaterThan(3_000);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);

    const results: Record<string, number[]> = {};
    for (const view of ["collection", "market", "data"] as const) {
      const times: number[] = [];
      for (let trial = 0; trial < 5; trial++) {
        const started = Date.now();
        const response = await page.request.get(`/pricing?view=${view}`, {
          timeout: 30_000,
        });
        times.push(Date.now() - started);
        expect(response.status()).toBe(200);
        expect(await response.text()).not.toContain(
          "Pricing analytics are unavailable",
        );
      }
      results[view] = times;
    }
    const pricingRequest = page.request.get("/pricing?view=collection", {
      timeout: 30_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const concurrentStarted = Date.now();
    const dashboard = await page.request.get("/dashboard", { timeout: 5_000 });
    const concurrentDashboardMs = Date.now() - concurrentStarted;
    expect(dashboard.status()).toBe(200);
    expect((await pricingRequest).status()).toBe(200);
    expect(concurrentDashboardMs).toBeLessThan(3_000);
    console.log(
      JSON.stringify({
        ownedPrintings: printings,
        collection: measurements(results.collection),
        market: measurements(results.market),
        data: measurements(results.data),
        concurrentDashboardMs,
      }),
    );
  } finally {
    database(`const tag=${quote(tag)};const owner=await p.player.findUnique({where:{name:tag}});if(owner){
      await p.inventoryItem.deleteMany({where:{currentOwnerId:owner.id}});
      await p.user.deleteMany({where:{playerId:owner.id}});
      await p.player.delete({where:{id:owner.id}});}return true;`);
  }
});
