import { expect, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], { windowsHide:true,encoding:"utf8",timeout:30000,
    input:`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());` });
}

test("pending discovery keeps heartbeat, choices and destination; revocation drains without early close",async({page,baseURL})=>{
  const dotnet=process.env.MTG_SCANNER_DOTNET,dll=process.env.MTG_SCANNER_HELPER_DLL;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1"||!dotnet||!dll,"Explicit localhost fake-driver helper; no USB/motor");
  expect(baseURL).toBe("http://127.0.0.1:13001");test.setTimeout(240000);
  const tag=`ui-scanner-progress-${randomUUID()}`,password=randomUUID();
  const ids:string[]=[];let service:ChildProcess|undefined,output="";
  const helper=(args:string[],input?:string)=>execFileSync(dotnet!,[dll!,...args],{windowsHide:true,input,encoding:"utf8",timeout:30000});
  const status=async()=> (await(await page.request.get("/api/scanners")).json()).agents[0];
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:10,sections:[]}}});`);
    await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    for(const mode of ["pending","refresh","revoke"]){
      const pair=await page.request.post("/api/scanners",{headers:{origin:baseURL!},data:{action:"pair"}});expect(pair.ok()).toBe(true);
      const connected=helper(["connect",baseURL!,"--local"],(await pair.json()).code+"\n");
      const id=connected.match(/Connection identity: ([a-f0-9-]{36})/)?.[1];expect(id).toBeTruthy();ids.push(id!);
      output="";service=spawn(dotnet!,[dll!,"discovery-fixture-server",id!,mode==="revoke"?"pending":mode],
        {windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,MTG_LOCAL_PILOT_TEST:"1"}});
      service.stdout?.on("data",chunk=>{output+=String(chunk);});service.stderr?.on("data",chunk=>{output+=String(chunk);});
      await page.goto("/imports/scan?input=scanner");
      const connections=page.getByRole("region",{name:"Scanner connections",exact:true});
      await expect(connections.getByRole("button",{name:"Scanner connected",exact:true})).toBeVisible();
      await connections.getByRole("button",{name:"Scanner connected",exact:true}).click();
      await expect(connections.getByText("Online",{exact:true})).toBeVisible();
      const batch=page.getByRole("region",{name:"New scan batch",exact:true});
      const source=batch.getByRole("combobox",{name:"Scanner source",exact:true});
      const start=batch.getByRole("button",{name:"Start scanner batch",exact:true});
      await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
      await page.getByRole("option",{name:new RegExp(tag)}).first().click();
      let selected="";
      if(mode==="refresh"){
        await expect(source.locator("option")).toHaveCount(2);await source.selectOption({index:1});selected=await source.inputValue();
        await expect(start).toBeEnabled(); // Never click START.
      }
      await expect.poll(()=>output.includes("controlled call pending"),{timeout:50000}).toBe(true);
      await expect(batch).toContainText("Checking scanner drivers",{timeout:12000});
      await expect(start).toBeDisabled();
      await expect(batch).toContainText("Waiting for scanner detection to finish");
      await expect(batch).not.toContainText("Choose an online scanner source");
      await expect(batch).not.toContainText("No scanner source is available yet");
      const before=await status();expect(before.online).toBe(true);
      expect(before.discoveryIssues.some((issue:{code:string})=>issue.code==="DISCOVERY_IN_PROGRESS")).toBe(true);
      expect(JSON.stringify(before)).not.toMatch(/PRIVATE|secret|tokenHash|credentialHash/);
      if(mode==="pending")for(const width of [1366,320]){
        await page.setViewportSize({width,height:900});await source.scrollIntoViewIfNeeded();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:`test-results/scanner-progress-pending-${width}.png`});
      }
      if(mode==="revoke"){
        await connections.getByRole("button",{name:"Disconnect Windows scanner",exact:true}).click();
        await expect.poll(()=>output.includes("Background helper stopped; originals retained"),{timeout:10000}).toBe(true);
        expect(service.exitCode).toBeNull(); // Actual controlled driver call still pending.
        const config=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA!,"MTGArchives","ScannerAgent",id!+".json"),"utf8"));
        expect(config.disabled).toBe(true);
        await expect.poll(()=>service!.exitCode,{timeout:45000}).toBe(0);
        expect(output.match(/WIA invocation/g)?.length).toBe(1);
        expect(output).toContain("controlled call completed");
        await expect(connections.getByText("No scanner helpers connected yet.")).toBeVisible();
      }else{
        // Every observation remains online while one real managed call is held
        // for35s: beyond the site's30s stale cutoff. No timeout/replacement call.
        await expect.poll(async()=>{
          const current=await status();expect(current.online).toBe(true);expect(service!.exitCode).toBeNull();
          return Date.parse(current.lastSeenAt)-Date.parse(before.lastSeenAt);
        },{timeout:45000,intervals:[2000]}).toBeGreaterThanOrEqual(30000);
        await expect(batch).not.toContainText("Checking scanner drivers",{timeout:15000});
        if(mode==="pending"){await expect(source.locator("option")).toHaveCount(2);await source.selectOption({index:1});}
        else {await expect(source).toHaveValue(selected);expect(output.match(/WIA invocation/g)?.length).toBe(2);}
        await expect(batch).toContainText(tag);await expect(start).toBeEnabled();
        if(mode==="pending")for(const width of [1366,320]){
          await page.setViewportSize({width,height:900});await source.scrollIntoViewIfNeeded();
          expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          await page.screenshot({path:`test-results/scanner-progress-settled-${width}.png`});
        }
        await connections.getByRole("button",{name:"Disconnect Windows scanner",exact:true}).click();
        await expect.poll(()=>service!.exitCode,{timeout:15000}).toBe(0);
      }
      service=undefined;
    }
    expect(Number(database(`console.log(await p.scannerRun.count({where:{agent:{userId:${JSON.stringify(tag)}}}}));`))).toBe(0);
    expect(Number(database(`console.log(await p.acquisitionSession.count({where:{createdByUserId:${JSON.stringify(tag)}}}));`))).toBe(0);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  }finally{
    if(service?.exitCode===null)service.kill(); // Owned fake-driver fixture only; never USB/native calls.
    for(const id of ids)helper(["forget",id]);
    database(`const n=${JSON.stringify(tag)};await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
