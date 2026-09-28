import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8",
    timeout: 30000,
  });
}
test("library selections stream past ten without exceeding capacity or upload bounds", async ({
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.MTG_LOCAL_PILOT_TEST !== "1",
    "Requires local snapshot",
  );
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(90000);
  const tag = `ui-library-${randomUUID()}`,
    password = randomUUID();
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const buffer = await sharp({
    create: { width: 420, height: 600, channels: 3, background: "#335577" },
  })
    .jpeg()
    .toBuffer();
  const files = Array.from({ length: 12 }, (_, i) => ({
    name: `card-${i + 1}.jpg`,
    mimeType: "image/jpeg",
    buffer,
  }));
  let release!: () => void;
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0,
    maximum = 0;
  try {
    database(
      `const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:14,sections:[]}}});`,
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
    await expect(
      page.getByRole("heading", { name: /0 of 14 cards/ }),
    ).toBeVisible();
    await page.route("**/api/acquisition/*/photos?*", async (route) => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        await gate;
        await route.fulfill({ response: await route.fetch() });
      } finally {
        active--;
      }
    });
    await page.getByLabel("Choose card photos").setInputFiles(files);
    await expect(
      page.getByRole("heading", { name: /10 of 14 cards/ }),
    ).toBeVisible();
    await expect(
      page.getByText("Adding 10 of 12 selected photos"),
    ).toBeVisible();
    expect(maximum).toBe(2);
    await page.screenshot({
      path: "test-results/acquisition-library-progress-phone.png",
    });
    release();
    await expect(
      page.getByRole("heading", { name: /12 of 14 cards/ }),
    ).toBeVisible();
    await expect(page.getByText(/12 photos prepared/)).toBeVisible({
      timeout: 30000,
    });
    expect(maximum).toBe(2);
    await expect(page.getByText(/Adding .* selected photos/)).toHaveCount(0);
    await page
      .getByLabel("Choose card photos")
      .setInputFiles(files.slice(0, 3));
    await expect(
      page.getByRole("region", { name: "Batch progress" }).getByRole("alert"),
    ).toContainText("2 spaces remaining");
    await expect(
      page.getByRole("region", { name: "Batch progress" }).getByRole("alert"),
    ).toBeInViewport();
    await expect(
      page.getByRole("heading", { name: /12 of 14 cards/ }),
    ).toBeVisible();
    await page
      .getByLabel("Choose card photos")
      .setInputFiles(files.slice(0, 2));
    await expect(
      page.getByRole("heading", { name: /14 of 14 cards/ }),
    ).toBeVisible();
    await expect(page.getByText(/14 photos prepared/)).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole("button", { name: "Photo library", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/acquisition-library-phone.png",
      fullPage: true,
    });
    database(
      `const n=${JSON.stringify(tag)};await p.inventoryLocation.create({data:{id:n+'-open',name:n+'-open',normalizedName:n+'-open',ownerPlayerId:n,type:'Box'}});`,
    );
    await page.goto("/imports/scan");
    await page
      .getByTestId("storage-destination")
      .getByRole("combobox")
      .fill(tag + "-open");
    await page.getByRole("option").first().click();
    await page
      .getByRole("button", { name: "Start batch", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: /0 cards$/ })).toBeVisible();
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.getByLabel("Choose card photos").setInputFiles(files);
    await expect(
      page.getByText("Adding 10 of 12 selected photos"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Stop adding photos", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Batch progress" }).getByRole("alert"),
    ).toContainText("10 of 12 were queued");
    release();
    await expect(page.getByText(/10 photos prepared/)).toBeVisible({
      timeout: 30000,
    });
    await page.getByLabel("Choose card photos").setInputFiles(files.slice(10));
    await expect(
      page.getByRole("heading", { name: /12 cards$/ }),
    ).toBeVisible();
    await expect(page.getByText(/12 photos prepared/)).toBeVisible({
      timeout: 30000,
    });
    console.log(
      JSON.stringify({
        selected: 12,
        saved: 14,
        maximumConcurrentUploads: maximum,
        capacity: 14,
      }),
    );
  } finally {
    release();
    await context.close();
    database(
      `const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionCommitMember.deleteMany({where});await p.acquisitionCommit.deleteMany({where});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`,
    );
  }
});
