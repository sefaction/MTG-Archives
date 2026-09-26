import { expect, test, type BrowserContext } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", screenshot: "off", video: "off" });

function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 180_000,
  }));
}

function summary(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  return { count: sorted.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1), samples: times };
}

const routes = {
  collection: "/pricing?view=collection",
  market: "/pricing?view=market",
  data: "/pricing?view=data",
  dashboard: "/dashboard",
} as const;

async function sample(contexts: BrowserContext[], rounds: number,
  isPassRunning: () => boolean, requireOverlap = false) {
  const times: Record<keyof typeof routes, number[]> = {
    collection: [], market: [], data: [], dashboard: [],
  };
  for (let round = 0; round < rounds; round++) {
    for (const [view, route] of Object.entries(routes) as
      Array<[keyof typeof routes, string]>) {
      const requests = await Promise.all(contexts.map(async (context) => {
        const startedInPass = isPassRunning();
        const started = Date.now();
        const response = await context.request.get(route, { timeout: 30_000 });
        const body = await response.text();
        expect(response.status(), `${view} should stay available`).toBe(200);
        expect(body).not.toContain("Pricing analytics are unavailable");
        return { ms: Date.now() - started,
          inPass: startedInPass && isPassRunning() };
      }));
      for (const result of requests) {
        if (!requireOverlap || result.inPass) times[view].push(result.ms);
      }
    }
  }
  return times;
}

test("four signed-in owners can use Pricing during isolated raw retention", async ({
  browser, baseURL,
}) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1" ||
    process.env.PRICING_RETENTION_SITE_LOAD !== "1",
  "Requires an authorized local Pricing snapshot and both optional PostgreSQL drill services");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(1_200_000);
  const tag = `ui-pricing-retention-load-${randomUUID()}`;
  const password = randomUUID();
  const quote = JSON.stringify;
  const contexts: BrowserContext[] = [];
  let drill: ReturnType<typeof spawn> | undefined;
  let ended: Promise<{ code: number | null; stdout: string; stderr: string }> | undefined;
  try {
    const fixture = database<{ ownedRows: number[]; physicalCopies: number[] }>(`
      const tag=${quote(tag)}; const sizes=[1,0.4,0.12,0.025];
      const [source]=await p.$queryRaw\`SELECT "currentOwnerId" FROM "InventoryItem"
        WHERE quantity > 0 GROUP BY "currentOwnerId" ORDER BY count(*) DESC LIMIT 1\`;
      const items=await p.inventoryItem.findMany({where:{currentOwnerId:source.currentOwnerId,
        quantity:{gt:0},card:{mtgjsonUuid:{not:null}}},select:{cardId:true,
        foil:true,foilStatus:true,condition:true,language:true}});
      if(items.length<3000)throw new Error('Pricing scale fixture needs at least 3,000 owned rows');
      const ownedRows=[];const physicalCopies=[];
      for(let ownerIndex=0;ownerIndex<4;ownerIndex++){
        const owner=await p.player.create({data:{name:tag+'-'+ownerIndex,
          displayName:'Pricing retention load owner '+ownerIndex}});
        await p.user.create({data:{username:tag+'-'+ownerIndex,
          displayName:'Pricing retention load owner '+ownerIndex,playerId:owner.id,
          passwordHash:await require('bcryptjs').hash(${quote(password)},10)}});
        const selected=items.slice(0,Math.max(1,Math.floor(items.length*sizes[ownerIndex])));
        const quantity=ownerIndex===0?Math.ceil(150000/selected.length):
          ownerIndex===1?8:ownerIndex===2?3:1;
        for(let i=0;i<selected.length;i+=500){
          await p.inventoryItem.createMany({data:selected.slice(i,i+500).map(item=>({
            currentOwnerId:owner.id,originalOpenerId:owner.id,cardId:item.cardId,
            quantity,foil:item.foil,foilStatus:item.foilStatus,
            condition:item.condition,language:item.language,sourceType:'MANUAL'}))});
        }
        ownedRows.push(selected.length);physicalCopies.push(selected.length*quantity);
      }
      return {ownedRows,physicalCopies};`);
    expect(fixture.ownedRows[0]).toBeGreaterThan(3_000);
    expect(fixture.physicalCopies[0]).toBeGreaterThanOrEqual(150_000);

    for (let ownerIndex = 0; ownerIndex < 4; ownerIndex++) {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel(/username or email/i).fill(`${tag}-${ownerIndex}`);
      await page.getByLabel(/^password$/i).fill(password);
      await page.getByRole("button", { name: /^log in$/i }).click();
      await page.waitForURL(/dashboard/);
      await page.close();
    }
    await sample(contexts, 1, () => false); // Warm both app and database caches.
    const baseline = await sample(contexts, 2, () => false);

    const args = ["exec", "-e", "MTG_LOCAL_PILOT_TEST=1",
      "-e", "PRICING_VERIFY_POSTGRES_DRILL=1",
      "-e", "PRICING_DIRECT_VERIFICATION_DRILL=1",
      "-e", "PRICING_CLONE_POSTGRES_DRILL=1",
      "mtg-archives-web-1", "node", "--import", "tsx",
      "scripts/verify-pricing-retention-fullsize.ts", "--run"];
    drill = spawn("docker", args, { windowsHide: true });
    let stdout = "", stderr = "", running = false, finished = false;
    let announcePass!: () => void;
    const passStarted = new Promise<void>((resolve) => { announcePass = resolve; });
    drill.stdout!.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes('"mode":"pass-start"')) { running = true; announcePass(); }
      if (stdout.includes('"mode":"fullsize-retention-drill-passed"')) running = false;
    });
    drill.stderr!.on("data", (chunk) => { stderr += chunk.toString(); });
    ended = new Promise((resolve) => drill!.on("close", (code) => {
      finished = true; running = false; resolve({ code, stdout, stderr });
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([passStarted,
        ended.then((result) => { throw new Error(`Drill ended before pass: ${result.stderr}`); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() =>
          reject(new Error("Drill did not reach pass-start in ten minutes")), 600_000); })]);
    } finally { if (timer) clearTimeout(timer); }
    const during = await sample(contexts, 5, () => running && !finished, true);
    const result = await ended;
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('"mode":"fullsize-retention-drill-passed"');
    const report = Object.fromEntries(Object.keys(routes).map((view) => [view, {
      baseline: summary(baseline[view as keyof typeof routes]),
      during: summary(during[view as keyof typeof routes]),
    }]));
    console.log(JSON.stringify({ mode: "pricing-retention-site-load", fixture,
      fourConcurrentOwners: true, report }));
    for (const view of Object.keys(routes) as Array<keyof typeof routes>)
      expect(during[view].length, `${view} needs enough pass-overlap requests`).toBeGreaterThanOrEqual(16);
  } finally {
    if (ended) await ended;
    for (const context of contexts) await context.close();
    database(`const tag=${quote(tag)};const owners=await p.player.findMany({
      where:{name:{startsWith:tag}},select:{id:true}});const ids=owners.map(x=>x.id);
      await p.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});
      await p.user.deleteMany({where:{playerId:{in:ids}}});
      await p.player.deleteMany({where:{id:{in:ids}}});return true;`);
  }
});
