import { expect, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });

function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
}

function holdPricingTable(): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(
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
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  child.stdin.end(
    "BEGIN; LOCK TABLE price_snapshots IN ACCESS EXCLUSIVE MODE; SELECT 'LOCKED'; SELECT pg_sleep(7); COMMIT;",
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Pricing lock did not start")), 8_000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (String(chunk).includes("LOCKED")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error("Pricing lock process failed"));
    });
  });
}

test("a slow Pricing history read does not block Dashboard", async ({ page, baseURL }) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires disposable local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(45_000);
  const tag = `ui-pricing-responsive-${randomUUID()}`;
  const password = randomUUID();
  const quote = JSON.stringify;
  let lock: ChildProcessWithoutNullStreams | undefined;
  try {
    database(`const tag=${quote(tag)};const owner=await p.player.create({data:{name:tag,displayName:'Pricing responder'}});
      await p.user.create({data:{username:tag,displayName:'Pricing responder',playerId:owner.id,passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
      const card=await p.card.create({data:{name:tag,scryfallId:require('node:crypto').randomUUID(),mtgjsonUuid:'00010d56-fe38-5e35-8aed-518019aa36a5',typeLine:'Artifact',setCode:'tst',collectorNumber:'1',rarity:'common',prices:{}}});
      await p.inventoryItem.create({data:{currentOwnerId:owner.id,originalOpenerId:owner.id,cardId:card.id,quantity:1,condition:'NM',sourceType:'MANUAL'}});return true;`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);

    lock = await holdPricingTable();
    const pricingRequest = page.request.get("/pricing", { timeout: 25_000 });
    await new Promise((resolve) => setTimeout(resolve, 750));
    const started = Date.now();
    const dashboard = await page.request.get("/dashboard", { timeout: 5_000 });
    const concurrentMs = Date.now() - started;
    expect(dashboard.status()).toBe(200);
    expect(concurrentMs).toBeLessThan(3_000);
    const pricing = await pricingRequest;
    expect(pricing.status()).toBe(200);
  } finally {
    lock?.kill();
    database(`const tag=${quote(tag)};const owner=await p.player.findUnique({where:{name:tag}});if(owner){
      await p.inventoryItem.deleteMany({where:{currentOwnerId:owner.id}});
      await p.user.deleteMany({where:{playerId:owner.id}});
      await p.player.delete({where:{id:owner.id}});
      await p.card.deleteMany({where:{name:tag}});}return true;`);
  }
});
