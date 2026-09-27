import { expect, test, chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { checkAcquisitionCommit } from "./acquisition-commit-steps";
import { checkAcquisitionReview } from "./acquisition-review-steps";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8",
    timeout: 30000,
  });
}
test("photo batches recover lost ACKs, keep the limit and retake the same slot", async ({
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(180000);
  const tag = `ui-acquisition-${randomUUID()}`,
    password = randomUUID();
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  const fixture = await sharp({
    create: { width: 420, height: 600, channels: 3, background: "#335577" },
  })
    .jpeg()
    .toBuffer();
  let committed = 0;
  try {
    database(
      `const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:2,sections:[{name:'A',capacity:2}]}}});`,
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
    await page.getByRole("button", { name: /^A\s/ }).click();
    await expect(
      page.getByText(/2 spaces remaining in this destination/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start batch", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: /0 of 2 cards/ }),
    ).toBeVisible();
    let lost = false;
    await page.route("**/api/acquisition/*/photos?*", async (route) => {
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByLabel("Choose card photos").setInputFiles({
      name: "card.jpg",
      mimeType: "image/jpeg",
      buffer: fixture,
    });
    await expect(
      page.getByRole("button", { name: "Retry upload" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /1 of 2 cards/ }),
    ).toBeVisible();
    await expect(page.getByText(/1 photos prepared/)).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole("button", { name: "Retry upload" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Open camera" }).click();
    await expect(
      page.getByRole("button", { name: "Take photo", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Take photo", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /2 of 2 cards/ }),
    ).toBeVisible();
    await expect(page.getByText(/2 photos prepared/)).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole("button", { name: "Take photo", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Photo library", exact: true }),
    ).toBeDisabled();
    await page
      .getByTestId("capture-card-1")
      .getByRole("button", { name: "Retake" })
      .click();
    await expect(page.getByText(/2 photos prepared/)).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole("heading", { name: /2 of 2 cards/ }),
    ).toBeVisible();
    const sessionId = new URL(page.url()).searchParams.get("batch")!;
    await expect
      .poll(() =>
        JSON.parse(
          database(
            `console.log(JSON.stringify(await p.acquisitionPhoto.count({where:{run:{sessionId:${JSON.stringify(sessionId)}}}})));`,
          ),
        ),
      )
      .toBe(3);
    await expect
      .poll(
        async () => {
          const state = await (
            await context.request.get(`/api/acquisition/${sessionId}`)
          ).json();
          const photo = state.slots[0].photos[0];
          return (
            photo.generation === 2 &&
            photo.ready &&
            state.photoPreparation.some(
              (p: any) => p.photoId === photo.id && p.status === "COMPLETE",
            )
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
    const photoUrl = await page
      .getByTestId("capture-card-1")
      .locator("img")
      .getAttribute("src");
    const anonymous = await browser.newContext({ baseURL });
    expect((await anonymous.request.get(photoUrl!)).status()).toBe(403);
    expect(
      (
        await anonymous.request.get(photoUrl!.split("?")[0] + "/recognition")
      ).status(),
    ).toBe(403);
    await anonymous.close();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    database(
      `const n=${JSON.stringify(tag)};await p.inventoryLocation.create({data:{id:n+'-open',name:n+'-open',normalizedName:n+'-open',ownerPlayerId:n,type:'Box'}});`,
    );
    await page.goto("/imports/scan");
    await page
      .getByTestId("storage-destination")
      .getByRole("combobox")
      .fill(tag + "-open");
    await page.getByRole("option").first().click();
    await expect(
      page.getByText(/This location has no capacity set/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start batch", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: /0 cards$/ })).toBeVisible();
    await page.getByLabel("Choose card photos").setInputFiles({
      name: "card.jpg",
      mimeType: "image/jpeg",
      buffer: fixture,
    });
    await expect(page.getByRole("heading", { name: /1 cards$/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Photo library", exact: true }),
    ).toBeEnabled();
    await expect(page.getByText(/1 photos prepared/)).toBeVisible({
      timeout: 30000,
    });
    await page.screenshot({
      path: "test-results/acquisition-phone.png",
      fullPage: true,
    });
    if (process.env.MTG_ACQUISITION_CORPUS_PATH) {
      const manifest = JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "tools/acquisition-eval/android-manifest.json",
          ),
          "utf8",
        ),
      );
      const photos = manifest.entries.map(
        (entry: { file: string; sha256: string }) => {
          if (path.basename(entry.file) !== entry.file)
            throw new Error("Invalid corpus name");
          const photo = path.join(
            process.env.MTG_ACQUISITION_CORPUS_PATH!,
            entry.file,
          );
          expect(
            createHash("sha256").update(readFileSync(photo)).digest("hex"),
          ).toBe(entry.sha256);
          return photo;
        },
      );
      const started = Date.now();
      await page.getByLabel("Choose card photos").setInputFiles(photos);
      await expect(
        page.getByRole("heading", { name: /11 cards$/ }),
      ).toBeVisible();
      await expect(page.getByText(/11 photos prepared/)).toBeVisible({
        timeout: 60000,
      });
      const digests = JSON.parse(
        database(
          `console.log(JSON.stringify(await p.acquisitionPhoto.findMany({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}},select:{digest:true,ready:true,purgeAfter:true}})));`,
        ),
      );
      for (const entry of manifest.entries)
        expect(digests).toContainEqual({
          digest: entry.sha256,
          ready: true,
          purgeAfter: null,
        });
      console.log(
        JSON.stringify({
          privateAndroidPhotos: photos.length,
          uploadToPreparedMilliseconds: Date.now() - started,
          inventoryWrites: 0,
        }),
      );
      if (process.env.MTG_ACQUISITION_RECOGNITION_TEST === "1") {
        await expect(page.getByTestId("recognition-suggestions")).toHaveCount(
          10,
          { timeout: 120000 },
        );
        const observed = JSON.parse(
          database(
            `console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-recognition-v1',status:'COMPLETE'},select:{output:true,artifact:{select:{digest:true}}}})));`,
          ),
        );
        for (const entry of manifest.entries) {
          const result = observed.find(
            (j: any) => j.artifact.digest === entry.sha256,
          );
          expect(result, entry.file).toBeTruthy();
          expect(result.output.native.photoDigest).toBe(entry.sha256);
          expect(result.output.proposals.automaticAcceptance).toBe(
            result.output.proposals.status === "STRONG_MATCH",
          );
          if (result.output.proposals.automaticAcceptance) {
            expect(result.output.proposals.proposals[0].reasons).toContain(
              "TITLE_EXACT",
            );
          }
          const ids = result.output.proposals.proposals.map(
            (p: any) => p.card.id,
          );
          const expected = JSON.parse(
            database(
              `console.log(JSON.stringify(await p.card.findUnique({where:{scryfallId:${JSON.stringify(entry.scryfallId)}},select:{id:true}})));`,
            ),
          );
          expect(ids, entry.file).toContain(expected.id);
        }
        await page
          .getByTestId("recognition-suggestions")
          .first()
          .locator("summary")
          .click();
        await expect(
          page.getByTestId("recognition-suggestions").first(),
        ).toContainText("Krosan Vorine");
        await page.screenshot({
          path: "test-results/acquisition-recognition-phone.png",
          fullPage: true,
        });
        console.log(
          JSON.stringify({
            realRecognitionPhotos: manifest.entries.length,
            expectedPrintingInTop12: manifest.entries.length,
            strongMatches: observed.filter(
              (j: any) => j.output.proposals.automaticAcceptance,
            ).length,
          }),
        );
        await checkAcquisitionReview(page);
        const strong = observed.filter(
          (j: any) => j.output.proposals.automaticAcceptance,
        );
        expect(strong.length).toBeGreaterThan(0);
        await expect(
          page.getByRole("button", { name: "Correct match", exact: true }),
        ).toHaveCount(strong.length);
        const autoCard = page
          .locator('[data-testid^="capture-card-"]')
          .filter({
            has: page.getByRole("button", {
              name: "Correct match",
              exact: true,
            }),
          })
          .first();
        await expect(autoCard).toContainText("Automatically confirmed");
        await autoCard
          .getByRole("button", { name: "Correct match", exact: true })
          .click();
        const autoDialog = page.getByRole("dialog");
        await expect(
          autoDialog.getByRole("radio", { checked: true }),
        ).toHaveCount(1);
        await autoDialog
          .getByRole("combobox", { name: "Card condition", exact: true })
          .selectOption("DMG");
        await autoDialog
          .getByRole("button", { name: "Save card review" })
          .click();
        await page.reload();
        await expect(
          page.getByRole("button", { name: "Correct match", exact: true }),
        ).toHaveCount(strong.length - 1);
        await expect(
          page
            .locator('[data-testid^="capture-card-"]')
            .filter({ hasText: "DMG" }),
        ).toHaveCount(1);
        await page.screenshot({
          path: "test-results/acquisition-auto-confirm-phone.png",
          fullPage: true,
        });
        const receipt = await checkAcquisitionCommit(page);
        committed = 1;
        const committedState = JSON.parse(
          database(`console.log(JSON.stringify({
          rows:await p.inventoryItem.findMany({where:{currentOwnerId:${JSON.stringify(tag)}}}),
          audits:await p.inventoryAuditLog.findMany({where:{changedByUserId:${JSON.stringify(tag)},changeType:'acquisition_committed'}}),
          members:await p.acquisitionCommitMember.findMany({where:{commitId:${JSON.stringify(receipt.id)}}}),
          photos:await p.acquisitionPhoto.findMany({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}},select:{purgeAfter:true}})
        }));`),
        );
        expect(committedState.rows).toHaveLength(1);
        expect(committedState.rows[0]).toMatchObject({
          quantity: 1,
          sourceType: "ACQUISITION",
          originalOpenerId: null,
          condition: "LP",
          foilStatus: "NONFOIL",
        });
        expect(committedState.audits).toHaveLength(1);
        expect(committedState.members).toHaveLength(1);
        expect(
          committedState.photos.filter((p: any) => p.purgeAfter),
        ).toHaveLength(1);
      }
    }
    expect(
      JSON.parse(
        database(
          `console.log(JSON.stringify(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}})));`,
        ),
      ),
    ).toBe(committed);
  } finally {
    await browser.close();
    database(
      `const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionCommitMember.deleteMany({where});await p.acquisitionCommit.deleteMany({where});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`,
    );
  }
});
