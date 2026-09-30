import { expect, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], { windowsHide:true,encoding:"utf8",timeout:30000,
    input:`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());` });
}
test("driver faults keep helper online and available sources usable with clear recovery guidance",async({page,baseURL})=>{
  const dotnet=process.env.MTG_SCANNER_DOTNET,dll=process.env.MTG_SCANNER_HELPER_DLL;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1"||!dotnet||!dll,"Explicit localhost helper fixture; no driver or motor");
  expect(baseURL).toBe("http://127.0.0.1:13001");test.setTimeout(180000);
  const tag=`ui-scanner-discovery-${randomUUID()}`,password=randomUUID();
  const ids:string[]=[]; let service:ChildProcess|undefined;
  const helper=(args:string[],input?:string)=>execFileSync(dotnet!,[dll!,...args],{windowsHide:true,input,encoding:"utf8",timeout:30000});
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:10}}});`);
    await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    for(const mode of ["partial","all","setup"]){
      const paired=await page.request.post("/api/scanners",{headers:{origin:baseURL!},data:{action:"pair"}});expect(paired.ok()).toBe(true);
      const output=helper(["connect",baseURL!,"--local"],(await paired.json()).code+"\n");
      const id=output.match(/Connection identity: ([a-f0-9-]{36})/)?.[1];expect(id).toBeTruthy();ids.push(id!);
      service=spawn(dotnet!,[dll!,"discovery-fixture-server",id!,mode],{windowsHide:true,stdio:"ignore",env:{...process.env,MTG_LOCAL_PILOT_TEST:"1"}});
      await page.goto("/imports/scan?input=scanner");
      const connections=page.getByRole("region",{name:"Scanner connections",exact:true});
      await expect(connections.getByRole("button",{name:"Scanner connected",exact:true})).toBeVisible();
      await connections.getByRole("button",{name:"Scanner connected",exact:true}).click();
      await expect(connections.getByText("Online",{exact:true})).toBeVisible();
      await expect(connections).toContainText("Windows could not check every scanner driver");
      const source=page.getByRole("combobox",{name:"Scanner source",exact:true});
      const batch=page.getByRole("region",{name:"New scan batch",exact:true});
      const start=batch.getByRole("button",{name:"Start scanner batch",exact:true});
      await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
      await page.getByRole("option",{name:new RegExp(tag)}).first().click();
      if(mode==="all"){
        await expect(source.locator("option")).toHaveCount(1);await expect(start).toBeDisabled();
        await expect(batch).toContainText("No scanner source is available yet");
      }else{
        await expect(source.locator("option")).toHaveCount(2);await source.selectOption({index:1});
        await expect(start).toBeEnabled(); // Never click START, even for this no-motor fixture.
      }
      await expect(batch).toContainText(mode==="setup"?"Connect this computer again to restart detection":"Detection retries automatically");
      const status=(await (await page.request.get("/api/scanners")).json()).agents[0];
      expect(status.online).toBe(true);expect(status.discoveryIssues.length).toBe(mode==="all"?2:1);
      expect(JSON.stringify(status)).not.toMatch(/PRIVATE|tokenHash|credentialHash|secret/);
      const oldSeen=Date.parse(status.lastSeenAt);
      await expect.poll(async()=>Date.parse((await(await page.request.get("/api/scanners")).json()).agents[0].lastSeenAt),{timeout:12000,intervals:[1000]}).toBeGreaterThan(oldSeen);
      expect(service.exitCode).toBeNull();
      if(mode==="partial")for(const width of [1366,320]){
        await page.setViewportSize({width,height:900});await source.scrollIntoViewIfNeeded();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:`test-results/scanner-discovery-${width}.png`});
      }
      await connections.getByRole("button",{name:"Disconnect Windows scanner",exact:true}).click();
      await expect.poll(()=>service!.exitCode,{timeout:15000}).toBe(0);service=undefined;
    }
    expect(Number(database(`console.log(await p.scannerRun.count({where:{agent:{userId:${JSON.stringify(tag)}}}}));`))).toBe(0);
    expect(Number(database(`console.log(await p.acquisitionSession.count({where:{createdByUserId:${JSON.stringify(tag)}}}));`))).toBe(0);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  }finally{
    if(service?.exitCode===null)service.kill(); // Owned fixture has no native driver calls.
    for(const id of ids)helper(["forget",id]);
    database(`const n=${JSON.stringify(tag)};await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
