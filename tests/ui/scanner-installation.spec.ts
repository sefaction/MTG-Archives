import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}

test.describe("Windows helper installation setup", () => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires opted-in local snapshot fixtures");
  let tag: string;
  test.beforeEach(async ({page, baseURL}) => {
    expect(baseURL).toBe("http://127.0.0.1:13001");
    tag=`ui-scanner-install-${randomUUID()}`;
    const password=randomUUID();
    database(`const n=${JSON.stringify(tag)};await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:await require('bcryptjs').hash(${JSON.stringify(password)},10)}});`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();
    await page.waitForURL(/\/dashboard/);
  });
  test.afterEach(() => {
    database(`const n=${JSON.stringify(tag)};await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  });

  test("missing installer explains install-first requirement without creating a pairing", async ({page}) => {
    await page.route(/\/api\/scanners\/installer\?info$/, route=>route.fulfill({json:{available:false,version:null}}));
    await page.goto("/imports/scan");
    const panel=page.getByRole("region",{name:"Scanner connections"});
    await panel.getByRole("button",{name:"Connect a scanner",exact:true}).click();
    await expect(panel.getByText(/installer is not available on this site/)).toBeVisible();
    await expect(panel.getByRole("button",{name:"Connect this computer",exact:true})).toBeDisabled();
    await expect(panel.getByRole("link",{name:/Download Windows scanner helper/})).toHaveCount(0);
    await expect(panel.getByText(/This opens an installed helper; it does not install one/)).toBeVisible();
    await panel.getByText("Helper already installed on this computer?",{exact:true}).click();
    await expect(panel.getByRole("button",{name:"Connect installed helper",exact:true})).toBeEnabled();
    expect(Number(database(`console.log(await p.scannerPairing.count({where:{userId:${JSON.stringify(tag)}}}));`))).toBe(0);
    for(const width of [1366,320]) {
      await page.setViewportSize({width,height:900});
      await panel.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await panel.screenshot({path:`test-results/scanner-installer-missing-${width}.png`});
    }
  });

  test("loading and failed checks do not imply an installer is being prepared; retry recovers", async ({page}) => {
    let attempts=0;
    let release: (()=>void)|undefined;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    await page.route(/\/api\/scanners\/installer\?info$/, async route=>{
      attempts++;
      if(attempts===1){await pending;await route.fulfill({status:503,json:{error:"Unavailable"}});}
      else await route.fulfill({json:{available:true,version:"0.3.7"}});
    });
    await page.goto("/imports/scan");
    const panel=page.getByRole("region",{name:"Scanner connections"});
    await panel.getByRole("button",{name:"Connect a scanner",exact:true}).click();
    await expect(panel.getByText("Checking the Windows helper download…",{exact:true})).toBeVisible();
    await expect(panel.getByRole("button",{name:"Connect this computer",exact:true})).toBeDisabled();
    release!();
    await expect(panel.getByRole("alert")).toHaveText("Could not check the Windows helper download. Try again.");
    await panel.getByRole("button",{name:"Check download again",exact:true}).click();
    await expect(panel.getByRole("link",{name:"Download Windows scanner helper",exact:true})).toBeVisible();
    await expect(panel.getByRole("button",{name:"Connect this computer",exact:true})).toBeEnabled();
    await expect(panel.getByText(/Open MTGArchivesScannerSetup.exe from your Downloads folder/)).toBeVisible();
    expect(attempts).toBe(2);
  });

  test("another computer receives an install download even when an existing helper is online", async ({page}) => {
    const agentId=randomUUID();
    await page.route("**/api/scanners",route=>route.fulfill({json:{agents:[{id:agentId,name:"Existing computer",online:true,devices:[],discoveryIssues:[]}]}}));
    const installerPath=process.env.MTG_SCANNER_INSTALLER_PATH;
    expect(installerPath,"requires the validated local installer").toBeTruthy();
    const expected=createHash("sha256").update(readFileSync(installerPath!)).digest("hex");
    await page.goto("/imports/scan");
    const panel=page.getByRole("region",{name:"Scanner connections"});
    await panel.getByRole("button",{name:"Scanner connected",exact:true}).click();
    await expect(panel.getByRole("link",{name:"Update Windows scanner helper",exact:true})).toBeVisible();
    await panel.getByRole("button",{name:"Add another computer",exact:true}).click();
    const link=panel.getByRole("link",{name:"Download Windows scanner helper",exact:true});
    await expect(link).toBeVisible();
    const waiting=page.waitForEvent("download");await link.click();const download=await waiting;
    expect(download.suggestedFilename()).toBe("MTGArchivesScannerSetup.exe");
    expect(await download.failure()).toBeNull();
    expect(createHash("sha256").update(readFileSync((await download.path())!)).digest("hex")).toBe(expected);
    await expect(panel.getByRole("button",{name:"Connect this computer",exact:true})).toBeEnabled();
    expect(Number(database(`console.log(await p.acquisitionSession.count({where:{createdByUserId:${JSON.stringify(tag)}}}));`))).toBe(0);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  });
});
