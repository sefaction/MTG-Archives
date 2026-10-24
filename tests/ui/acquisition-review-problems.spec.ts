import {expect, test, request} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {writeFileSync} from "node:fs";
import {APP_THEMES} from "../../lib/themes";
import {cleanupReviewFixture, reviewDatabase, reviewFingerprint, reviewSourceState, setupReviewFixture} from "./review-acceptance-fixture";

test.skip(process.env.MTG_REVIEW_PROBLEM_TEST !== "1", "Explicit isolated problem-filter fixture; no native recognition claim");
test.use({trace: "retain-on-failure", screenshot: "only-on-failure", video: "off"});

function seedProblems(tag: string, batch: string) {
  return reviewDatabase<{visualJob: string}>(`
    const tag=${JSON.stringify(tag)},batch=${JSON.stringify(batch)};
    const session=await p.acquisitionSession.findUniqueOrThrow({where:{id:batch}});
    if(session.ownerPlayerId!==tag)throw Error('Wrong fixture owner');
    const run=await p.acquisitionRun.findUniqueOrThrow({where:{sessionId:batch}});
    const cards=await p.card.findMany({where:{id:tag+'-card'}});if(cards.length!==1)throw Error('Missing fixture printing');
    const card=cards[0];await p.card.update({where:{id:card.id},data:{finishes:['nonfoil','foil']}});
    await p.acquisitionSession.update({where:{id:batch},data:{reviewDefaults:{finish:'UNKNOWN',condition:'NM'}}});
    const candidates=await p.acquisitionCandidate.findMany({where:{runId:run.id},orderBy:{acquisitionOrder:'asc'}});
    if(candidates.length!==300)throw Error('Expected bounded300-card presentation fixture');
    const crypto=require('crypto'),jobs=[];let visualJob='';
    for(let position=0;position<300;position++){
      const candidate=candidates[position],photo=await p.acquisitionPhoto.findFirstOrThrow({where:{runId:run.id,slotId:candidate.physicalId}});
      const artifact=await p.acquisitionArtifact.findFirstOrThrow({where:{runId:run.id,sourceId:photo.id}});
      if(position<23)await p.acquisitionCandidate.update({where:{id:candidate.id},data:{review:Prisma.DbNull}});
      if(position===21)await p.acquisitionCandidate.update({where:{id:candidate.id},data:{manualAnalysis:{version:1,requestKey:crypto.randomUUID(),photoId:photo.id,digest:photo.digest,generation:photo.generation,candidateRevision:candidate.revision,region:null}}});
      const empty=[16,17,18,22].includes(position),status=position<16?'CONFLICT':empty?'NO_MATCH':'REVIEW_REQUIRED';
      const proposals=empty?[]:[{card:{id:card.id,name:card.name,setCode:card.setCode,collectorNumber:card.collectorNumber,lang:card.lang},reasons:['TITLE_TEXT'],nameDistance:0}];
      const input={photoId:photo.id,digest:position===20?'0'.repeat(64):photo.digest,manualAnalysis:null};
      const output={catalog:{status:'RESOLVED',printingCoverage:'CHECKED'},proposals:{status,automaticAcceptance:false,totalProposals:proposals.length,truncated:false,proposals},native:{geometry:{status:[19,23].includes(position)?'NEEDS_CROP':'PROPOSED'},omittedPrivateObservation:'private-projection-marker-'+crypto.randomBytes(16384).toString('hex')}};
      jobs.push({id:crypto.randomUUID(),runId:run.id,candidateId:candidate.id,artifactId:artifact.id,candidateRevision:candidate.revision,stage:'photo-recognition-v1',versionKey:crypto.createHash('sha256').update(tag+position).digest('hex'),status:position===18?'PENDING':'COMPLETE',input,output,createdAt:new Date(Date.now()+60000+position)});
      if(position===22){visualJob=crypto.randomUUID();jobs.push({id:visualJob,runId:run.id,candidateId:candidate.id,artifactId:artifact.id,candidateRevision:candidate.revision,stage:'photo-visual-retrieval-v1',versionKey:crypto.createHash('sha256').update(tag+'visual').digest('hex'),status:'PENDING',input,createdAt:new Date(Date.now()+61000)});}
    }
    for(let start=0;start<jobs.length;start+=25)await p.acquisitionProcessingJob.createMany({data:jobs.slice(start,start+25)});return {visualJob};
  `);
}

for (const width of [1366, 390, 320]) test(`whole-batch problem filters preserve drafts at ${width}px`, async ({page, baseURL}) => {
  test.setTimeout(180_000); page.setDefaultTimeout(15_000);
  await page.setViewportSize({width, height: width === 1366 ? 768 : 844});
  const tag = `ui-review-acceptance-${randomUUID()}`, before = reviewFingerprint();
  writeFileSync(test.info().outputPath("fixture-before.json"), JSON.stringify({tag, before}));
  let failed = false, primary: unknown;
  let anonymous: Awaited<ReturnType<typeof request.newContext>> | undefined;
  try {
    const fixture = await setupReviewFixture(page, baseURL!, tag, 300);
    const seeded = seedProblems(tag, fixture.batch), source = reviewSourceState(fixture.batch);
    writeFileSync(test.info().outputPath("source-before.json"), JSON.stringify(source));
    const started = performance.now();
    const progress = await (await page.request.get(`/api/acquisition/${fixture.batch}`, {timeout: 15_000})).json();
    const progressBytes = Buffer.byteLength(JSON.stringify(progress));
    expect(JSON.stringify(progress)).not.toContain("private-projection-marker-");
    expect(progressBytes).toBeLessThan(300 * 32768 / 5);
    writeFileSync(test.info().outputPath("progress-projection.json"), JSON.stringify({cards:300,
      syntheticNativeBytesAtLeast:300*32768,progressBytes,milliseconds:Math.round(performance.now()-started)}));
    expect(progress.slots).toHaveLength(300);
    anonymous = await request.newContext({baseURL});
    const denied = await anonymous.get(`/api/acquisition/${fixture.batch}`);
    expect(denied.status()).toBe(403);
    expect(await denied.text()).not.toContain("reviewProblems");
    expect(progress.slots.filter((s: {reviewProblems: string[]}) => s.reviewProblems.includes("no-match")).map((s: {position: number}) => s.position)).toEqual([16,17]);
    for (const position of [18,20,21,22]) expect(progress.slots[position].reviewProblems).not.toContain("no-match");
    await page.goto(`/imports/scan?batch=${fixture.batch}`);
    const filter = page.getByRole("combobox", {name: "Show cards", exact: true});
    for (const [value, text] of [["conflict","Conflicting suggestions (16)"],["no-match","No match (2)"],
      ["unknown-finish","Choose finish (24)"],["quality","Photo needs attention (2)"],["overflow","Outside batch allocation (1)"]])
      await expect(filter.locator(`option[value="${value}"]`)).toHaveText(text);
    await filter.selectOption("conflict");
    expect(await page.locator('[data-testid^="capture-card-"]').count()).toBeLessThan(300);
    await expect(page.getByTestId("capture-card-17")).toHaveCount(0);
    const more = page.getByRole("button", {name: "Load more cards", exact: true});
    if (await more.isVisible()) await more.click();
    await expect(page.locator('[data-testid^="capture-card-"]')).toHaveCount(16);
    expect(await page.locator('[data-testid^="capture-card-"]').evaluateAll(rows => rows.map(row => Number(row.getAttribute("data-testid")!.replace("capture-card-", ""))))).toEqual(Array.from({length: 16}, (_, i) => i + 1));
    await filter.selectOption("quality");
    const draft = page.getByTestId("capture-card-24");
    await draft.scrollIntoViewIfNeeded();
    await draft.getByRole("button", {name: "Correct", exact: true}).press("Enter");
    await draft.getByRole("combobox", {name: "Card condition", exact: true}).selectOption("LP");
    await filter.selectOption("no-match");
    await expect(page.locator('[data-testid^="capture-card-"]')).toHaveCount(3);
    await expect(draft.getByRole("combobox", {name: "Card condition", exact: true})).toHaveValue("LP");
    await expect(page.getByTestId("capture-card-19")).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.reload();
    await filter.selectOption("no-match");
    await expect(draft).toHaveCount(1);
    await expect(draft.getByRole("combobox", {name: "Card condition", exact: true})).toHaveValue("LP");
    await filter.selectOption("quality");
    await draft.scrollIntoViewIfNeeded();
    await expect(draft.getByRole("combobox", {name: "Card condition", exact: true})).toHaveValue("LP");
    const layouts: unknown[] = [];
    for (const theme of APP_THEMES) {
      await page.locator("html").evaluate((element, id) => element.setAttribute("data-theme", id), theme.id);
      for (const mode of ["Simple", "Advanced"]) {
        await page.getByRole("button", {name: mode, exact: true}).click();
        await filter.selectOption("no-match");
        await expect(draft.getByRole("combobox", {name: "Card condition", exact: true})).toHaveValue("LP");
        const metrics = await page.evaluate(() => ({width: innerWidth, scrollWidth: document.documentElement.scrollWidth}));
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
        layouts.push({theme: theme.id, mode, ...metrics});
      }
    }
    writeFileSync(test.info().outputPath("layout-states.json"), JSON.stringify(layouts));
    reviewDatabase(`await p.acquisitionProcessingJob.update({where:{id:${JSON.stringify(seeded.visualJob)}},data:{status:'COMPLETE'}});return true;`);
    await expect(filter.locator('option[value="no-match"]')).toHaveText("No match (3)");
    await expect(page.getByTestId("capture-card-23")).toBeVisible();
    await draft.scrollIntoViewIfNeeded();
    await draft.getByRole("button", {name: "Cancel changes", exact: true}).click();
    await expect(draft).toHaveCount(0);
    await filter.selectOption("overflow"); await expect(page.getByTestId("capture-card-300")).toBeVisible();
    await expect(page.locator('[data-testid^="capture-card-"]')).toHaveCount(1);
    const afterSource = reviewSourceState(fixture.batch); expect(afterSource).toEqual(source);
    expect(reviewDatabase(`return {stock:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}),commits:await p.acquisitionCommit.count({where:{run:{sessionId:${JSON.stringify(fixture.batch)}}}}),audits:await p.inventoryAuditLog.count({where:{changedByUser:{playerId:${JSON.stringify(tag)}}}})};`)).toEqual({stock:0,commits:0,audits:0});
    writeFileSync(test.info().outputPath("source-after.json"), JSON.stringify(afterSource));
    await page.screenshot({path: test.info().outputPath(`filters-${width}.png`), fullPage: false});
  } catch (error) { failed = true; primary = error; }
  const errors: unknown[] = [];
  try { await anonymous?.dispose(); } catch (error) { errors.push(error); }
  try { await page.unrouteAll({behavior: "wait"}); await page.goto("about:blank"); } catch (error) { errors.push(error); }
  try { await page.context().clearCookies(); } catch (error) { errors.push(error); }
  try { cleanupReviewFixture(tag, tag + "-card"); } catch (error) { errors.push(error); }
  try { const after = reviewFingerprint(); writeFileSync(test.info().outputPath("fixture-after.json"), JSON.stringify({tag, after})); expect(after).toEqual(before); } catch (error) { errors.push(error); }
  if (failed || errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], "Problem-filter case and cleanup failures");
});
