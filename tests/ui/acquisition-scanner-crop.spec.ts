import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8",
    timeout: 30000,
  });
}
test("tight scanner images retain the footer through recognition and visual review", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1" ||
      !process.env.MTG_ACQUISITION_SCANNER_PATH,
    "Requires local snapshot and private scanner corpus",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(240000);
  page.setDefaultTimeout(10000);
  const tag = `ui-scanner-${randomUUID()}`,
    password = randomUUID();
  const manifest = JSON.parse(
    readFileSync("tools/acquisition-eval/scanner-manifest.json", "utf8"),
  );
  const entries = [
    manifest.entries[0],
    manifest.entries[9],
    manifest.entries[16],
  ];
  try {
    database(
      `const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:3,sections:[]}}});`,
    );
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/imports/scan");
    await page
      .getByTestId("storage-destination")
      .getByRole("combobox")
      .fill(tag);
    await page.getByRole("option").first().click();
    await page
      .getByRole("button", { name: "Start batch", exact: true })
      .click();
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Batch finish", exact: true })
      .selectOption("NONFOIL");
    await page
      .getByRole("combobox", { name: "Batch condition", exact: true })
      .selectOption("NM");
    await page.getByRole("button", { name: "Save batch defaults" }).click();
    await expect(page.getByText("Batch defaults saved.")).toBeVisible();
    // Serial intake isolates crop verification from the separate burst retry #468.
    for (const [i, entry] of entries.entries()) {
      expect(path.basename(entry.file)).toBe(entry.file);
      const buffer = readFileSync(
        path.join(process.env.MTG_ACQUISITION_SCANNER_PATH!, entry.file),
      );
      expect(createHash("sha256").update(buffer).digest("hex")).toBe(
        entry.sha256,
      );
      await page
        .getByLabel("Choose card photos")
        .setInputFiles({ name: entry.file, mimeType: "image/jpeg", buffer });
      // Prioritize only this disposable fixture ahead of existing upgrade work.
      // This tests the real worker/UI, not queue latency under a backlog.
      await expect
        .poll(
          () =>
            Number(
              database(
                `await p.acquisitionProcessingJob.updateMany({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-recognition-v1',status:'PENDING'},data:{availableAt:new Date(0)}});console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-recognition-v1',status:'COMPLETE'}}));`,
              ),
            ),
          { timeout: 120000 },
        )
        .toBe(i + 1);
      const output = JSON.parse(
        database(
          `const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},artifact:{digest:${JSON.stringify(entry.sha256)}},stage:'photo-recognition-v1',status:'COMPLETE'},select:{output:true}});const expected=await p.card.findUniqueOrThrow({where:{scryfallId:${JSON.stringify(entry.scryfallId)}},select:{id:true}});console.log(JSON.stringify({output:job.output,expectedId:expected.id}));`,
        ),
      );
      expect(output.output.native.geometry.method).toBe("full-frame");
      expect(output.output.proposals.proposals[0].card.id).toBe(
        output.expectedId,
      );
      expect(output.output.proposals.evidence.setCodes).toContain("neo");
      expect(output.output.proposals.evidence.collectors).toContain(
        entry.collectorNumber,
      );
      await expect
        .poll(
          () =>
            Number(
              database(
                `await p.acquisitionProcessingJob.updateMany({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:{in:['photo-catalog-reconciliation-v1','photo-visual-retrieval-v1']},status:'PENDING'},data:{availableAt:new Date(0)}});console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-catalog-reconciliation-v1',status:'COMPLETE'}}));`,
              ),
            ),
          { timeout: 120000 },
        )
        .toBe(i + 1);
      const reconciled = JSON.parse(
        database(
          `const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},artifact:{digest:${JSON.stringify(entry.sha256)}},stage:'photo-catalog-reconciliation-v1',status:'COMPLETE'},select:{output:true}});console.log(JSON.stringify(job.output));`,
        ),
      );
      expect(reconciled.catalog.status).toBe("RESOLVED");
      expect(reconciled.catalog.printingCoverage).toBe("CHECKED");
      expect(reconciled.native.photoDigest).toBe(entry.sha256);
      if (process.env.MTG_ACQUISITION_VISUAL_TEST === "1") {
        expect(reconciled.visual.photoDigest).toBe(entry.sha256);
        expect(reconciled.visual.referenceCount).toBe(112472);
        expect(reconciled.visual.candidates).toHaveLength(12);
        expect(reconciled.visual.geometricCandidates.length).toBeGreaterThan(0);
        expect(reconciled.proposals.automaticAcceptance).toBe(false);
        expect(reconciled.sourceVisualJobId).toMatch(/^[a-f0-9-]{36}$/);
      }
      expect(
        reconciled.proposals.proposals.some(
          (proposal: any) => proposal.card.id === output.expectedId,
        ),
      ).toBe(true);
      const card = page.getByTestId(`capture-card-${i + 1}`);
      await card.scrollIntoViewIfNeeded();
      if (process.env.MTG_ACQUISITION_VISUAL_TEST === "1") {
        await expect(
          card.getByText("Whole card compared with catalog images"),
        ).toBeVisible({ timeout: 20000 });
        await expect(card.getByTestId("scan-proposal-evidence")).toHaveText(
          "Suggested from image comparison; verify the exact printing.",
        );
      }
      await expect(card.getByText(/Full image retained; no crop/)).toBeVisible({
        timeout: 20000,
      });
      await expect(
        card.getByRole("button", { name: "Full card image", exact: true }),
      ).toBeEnabled();
      await expect(
        card.getByRole("img", {
          name: `Full card image ${i + 1}`,
          exact: true,
        }),
      ).toBeVisible();
      await card
        .getByRole("button", { name: "Reading zones", exact: true })
        .click();
      await expect(
        card.getByText(/Cyan: title\/footer areas attempted/),
      ).toBeVisible();
    }
    await page.reload();
    const card = page.getByTestId("capture-card-1");
    for (const width of [1366, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await card.scrollIntoViewIfNeeded();
      await expect(
        card.getByText(/Full image retained; no crop/),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await card.evaluate((el) =>
        window.scrollTo(
          0,
          window.scrollY + el.getBoundingClientRect().top - 170,
        ),
      );
      // The canvas is visible before its authenticated image has decoded and
      // painted. Verify actual pixels so paired screenshots cannot capture an
      // empty scan while the source request is still in flight.
      await expect
        .poll(() =>
          card
            .getByRole("img", { name: "Full card image 1", exact: true })
            .evaluate((element) => {
              const canvas = element as HTMLCanvasElement;
              return (
                canvas.width > 0 &&
                canvas.height > 0 &&
                canvas
                  .getContext("2d")!
                  .getImageData(
                    Math.floor(canvas.width / 2),
                    Math.floor(canvas.height / 2),
                    1,
                    1,
                  ).data[3] === 255
              );
            }),
        )
        .toBe(true);
      await page.screenshot({
        path: `test-results/scanner-full-frame-${width}.png`,
      });
    }
    if (process.env.MTG_ACQUISITION_VISUAL_TEST === "1") {
      // Exhausted visual work is a separate failure, not fabricated unreadable
      // text. Preserve the real completed evidence and add an owned failed
      // generation, as a permanent processing failure would do.
      database(
        `const prior=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},artifact:{digest:${JSON.stringify(entries[0].sha256)}},stage:'photo-visual-retrieval-v1',status:'COMPLETE'}});await p.acquisitionProcessingJob.create({data:{runId:prior.runId,artifactId:prior.artifactId,candidateId:prior.candidateId,candidateRevision:prior.candidateRevision,stage:prior.stage,versionKey:require('crypto').randomUUID(),input:prior.input,status:'FAILED',attempts:3,maxAttempts:3,errorCode:'PROCESSING_FAILED'}});`,
      );
      await page.reload();
      const failedCard = page.getByTestId("capture-card-1");
      await failedCard.scrollIntoViewIfNeeded();
      await expect(
        failedCard.getByText(
          /Image comparison failed\. Your photo and text suggestions are saved/,
        ),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        failedCard.getByRole("img", { name: "Full card image 1", exact: true }),
      ).toBeVisible();
    }
    expect(
      Number(
        database(
          `console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`,
        ),
      ),
    ).toBe(0);
  } finally {
    // Block new authenticated polling and retire only this fixture owner.
    database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    try {
    database(
      `const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionCommitMember.deleteMany({where});await p.acquisitionCommit.deleteMany({where});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`,
    );

    } finally {
      // A final sweep also catches writes completed during legacy teardown.
      database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    }
  }
});
