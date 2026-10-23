import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const container = process.env.MTG_LANGUAGE_TEST_CONTAINER || "mtg-archives-web-1";
function database<T>(body: string): T {
  return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node"], {
    windowsHide: true, encoding: "utf8", timeout: 30_000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Language fixture database operation failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
function snapshot() {
  return database<Record<string, unknown>>(String.raw`const tables=await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");const output={};for(const {tablename} of tables){const quoted='"'+tablename.replaceAll('"','""')+'"';output[tablename]=await p.$queryRawUnsafe('SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(t)::text, chr(10) ORDER BY to_jsonb(t)::text),\'\')) AS digest FROM '+quoted+' t');}return output;`);
}

test("Public language filters constrain actual results, suggestions and desktop/phone navigation", async ({ browser, request, baseURL }, testInfo) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires an owned local snapshot");
  test.setTimeout(150_000);
  expect(baseURL).toBe(`http://127.0.0.1:${process.env.MTG_LANGUAGE_TEST_PORT || "13001"}`);
  const expectedProject = process.env.MTG_LANGUAGE_TEST_PROJECT || "mtg-archives";
  const project = execFileSync("docker", ["inspect", container, "--format", '{{index .Config.Labels "com.docker.compose.project"}}'], { encoding: "utf8", windowsHide: true }).trim();
  expect(project).toBe(expectedProject);
  const tag = `language-${randomUUID()}`;
  const ids = [tag + "-a", tag + "-b", tag + "-private"];
  const names = Object.fromEntries(["English", "French", "Dual", "OtherEnglish", "OtherFrench", "Private", "PrivateOwner", "Zero"].map(key => [key, `${tag} ${key}`]));
  const before = snapshot();
  const quote = JSON.stringify;
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  const failures: unknown[] = [];
  try {
    database(`return p.$transaction(async tx=>{
      const ids=${quote(ids)},names=${quote(names)};
      for(const id of ids){await tx.player.create({data:{id,name:id,displayName:id}});await tx.user.create({data:{id,username:id,displayName:id,playerId:id,passwordHash:'fixture-not-login',inventoryDefaultVisibility:id===ids[2]?'PRIVATE':'PUBLIC'}});}
      await tx.inventoryLocation.create({data:{id:${quote(tag + "-hidden")},ownerPlayerId:ids[0],name:'Private language fixture',normalizedName:${quote(tag + "-hidden")},visibility:'PRIVATE'}});
      for(const key of Object.keys(names)){await tx.card.create({data:{id:${quote(tag)}+'-'+key,name:names[key],scryfallId:require('node:crypto').randomUUID(),typeLine:'Artifact',setCode:'tst',collectorNumber:key,rarity:'common'}});}
      for(const [key,owner,language,quantity,locationId] of [['English',ids[0],'EN',2,null],['French',ids[0],'FR',3,null],['Dual',ids[0],'EN',5,null],['Dual',ids[0],'FR',7,null],['OtherEnglish',ids[1],'EN',11,null],['OtherFrench',ids[1],'FR',13,null],['Private',ids[0],'FR',17,${quote(tag + "-hidden")}],['PrivateOwner',ids[2],'FR',19,null],['Zero',ids[0],'FR',0,null]]){await tx.inventoryItem.create({data:{currentOwnerId:owner,originalOpenerId:owner,cardId:${quote(tag)}+'-'+key,language,quantity,condition:'NM',sourceType:'MANUAL',locationId}});}
      return true;
    });`);
    const cases: { language?: string; owner?: string; keys: string[]; languages: string[]; count: number }[] = [
      { language: "FR", keys: ["Dual", "French", "OtherFrench"], languages: ["FR"], count: 3 },
      { language: "EN", keys: ["Dual", "English", "OtherEnglish"], languages: ["EN"], count: 3 },
      { language: " en ", keys: ["Dual", "English", "OtherEnglish"], languages: ["EN"], count: 3 },
      { language: "en,FR,en", keys: ["Dual", "English", "French", "OtherEnglish", "OtherFrench"], languages: ["EN", "FR"], count: 6 },
      { keys: ["Dual", "English", "French", "OtherEnglish", "OtherFrench"], languages: ["EN", "FR"], count: 6 },
      { language: "  , ", keys: ["Dual", "English", "French", "OtherEnglish", "OtherFrench"], languages: ["EN", "FR"], count: 6 },
      { language: "unknown", keys: [], languages: [], count: 0 },
      { language: "FR", owner: ids[0], keys: ["Dual", "French"], languages: ["FR"], count: 2 },
      { language: "EN", owner: ids[1], keys: ["OtherEnglish"], languages: ["EN"], count: 1 },
      { language: "FR", owner: ids[2], keys: [], languages: [], count: 0 },
    ];
    for (const fixture of cases) {
      const params = new URLSearchParams({ cardName: tag, displayMode: "exact", pageSize: "10" });
      if (fixture.language !== undefined) params.set("language", fixture.language);
      if (fixture.owner) params.set("owner", fixture.owner);
      const response = await request.get(`/api/public/inventory/list?${params}`);
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.totalMatchingCount, `matching count for ${JSON.stringify(fixture)}`).toBe(fixture.count);
      expect([...new Set(result.rows.map((row: any) => row.name))].sort()).toEqual(fixture.keys.map(key => names[key]).sort());
      expect([...new Set(result.rows.map((row: any) => row.language))].sort()).toEqual(fixture.languages);
      const suggestions = new URLSearchParams({ kind: "cardName", q: tag });
      if (fixture.language !== undefined) suggestions.set("language", fixture.language);
      if (fixture.owner) suggestions.set("owner", fixture.owner);
      const suggested = await request.get(`/api/public/inventory/filter-suggestions?${suggestions}`);
      expect(suggested.status()).toBe(200);
      expect((await suggested.json()).suggestions.map((option: any) => option.value).sort()).toEqual(fixture.keys.map(key => names[key]).sort());
    }
    expect((await request.get(`/api/inventory/filter-suggestions?kind=cardName&q=${tag}&language=FR`)).status()).toBe(401);

    for (const width of [1366, 320]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
      contexts.push(context);
      await context.route("**/*", route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(`/public/inventory?cardName=${tag}&displayMode=exact&pageSize=10`);
      for (const [language, keys] of [["FR", ["Dual", "French", "OtherFrench"]], ["EN,FR", ["Dual", "English", "French", "OtherEnglish", "OtherFrench"]], ["", ["Dual", "English", "French", "OtherEnglish", "OtherFrench"]]] as const) {
        await page.getByRole("button", { name: /advanced inventory search/i }).click();
        const panel = page.getByRole("dialog", { name: "Filter inventory" });
        await expect(panel).toBeVisible();
        await panel.getByRole("tab", { name: "Collection" }).click();
        await panel.locator('input[name="language"]').fill(language);
        await panel.getByRole("button", { name: "Apply filters" }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get("language") || "").toBe(language);
        if (await panel.isVisible()) await panel.getByRole("button", { name: "Close filters" }).click();
        const results = page.locator(".inventory-results");
        for (const key of keys) await expect(results.getByText(names[key], { exact: true }).first()).toBeVisible();
        for (const key of ["Private", "PrivateOwner", "Zero", ...(language === "FR" ? ["English", "OtherEnglish"] : [])]) await expect(results).not.toContainText(names[key]);
        if (language === "FR") await expect(page.getByLabel("Remove Language: FR").first()).toBeVisible();
      }
      await page.screenshot({ path: testInfo.outputPath(`language-${width}.png`), fullPage: true });
      await context.close(); contexts.splice(contexts.indexOf(context), 1);
    }
  } catch (error) { failures.push(error); } finally {
    for (const context of contexts) try { await context.close(); } catch (error) { failures.push(error); }
    try {
      database(`return p.$transaction(async tx=>{const ids=${quote(ids)};await tx.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});await tx.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});await tx.user.deleteMany({where:{id:{in:ids}}});await tx.player.deleteMany({where:{id:{in:ids}}});await tx.card.deleteMany({where:{id:{in:${quote(Object.keys(names).map(key => tag + "-" + key))}}}});return true;});`);
      assert.deepEqual(snapshot(), before, "all existing table counts and full-row fingerprints must be preserved");
      console.log(`PASS: exact owned language fixture cleanup and ${Object.keys(before).length}-table fingerprint preservation`);
    } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Language qualification and cleanup failed");
  }
});
