import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], { windowsHide:true,encoding:"utf8",timeout:30000,
    input:`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());` });
}

test("rejected scanner Start can retire its original identity before setup changes",async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1","Owned local protocol fixture; no helper or motor");
  expect(baseURL).toBe("http://127.0.0.1:13001");test.setTimeout(120000);
  const tag=`ui-rejected-start-${randomUUID()}`,password=randomUUID(),agentId=randomUUID(),secret=randomBytes(32).toString("base64url");
  const requests:Record<string,unknown>[]=[];let retireRequests=0;
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:1,sections:[]}}});`);
    await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    const pair=await page.request.post("/api/scanners",{headers:{origin:baseURL!},data:{action:"pair"}});expect(pair.ok()).toBe(true);
    expect((await page.request.post("/api/scanner-agent/pair",{data:{version:1,pairCode:(await pair.json()).code,agentId,secret,name:"Rejected Start fixture"}})).ok()).toBe(true);
    const headers={authorization:`Bearer ${agentId}.${secret}`};
    const pulse=async()=>expect((await page.request.post("/api/scanner-agent/pulse",{headers,data:{version:1,agentVersion:"0.3.0-native",devices:[{id:"fixture-reject",name:"Rejected Start fixture",backend:"fixture",source:"Fixture",qualification:"GenericUnqualified"}]}})).ok()).toBe(true);
    await pulse();
    await page.route("**/api/scanners/runs",async route=>{
      const body=route.request().postDataJSON();
      if(body?.action==="create")requests.push(body);
      if(body?.action==="retire"&&++retireRequests===1){
        const response=await route.fetch();expect(response.ok()).toBe(true);expect((await response.json()).retired).toBe(true);
        await route.fulfill({status:503,json:{error:"Injected lost cancellation acknowledgement"}});return;
      }
      await route.continue();
    });
    await page.goto("/imports/scan?input=scanner");await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);await page.getByRole("option").first().click();
    const start=page.getByRole("button",{name:"Start scanner batch",exact:true});await expect(start).toBeEnabled();
    // Fill capacity after the form read it. The real server rejects creation.
    database(`const n=${JSON.stringify(tag)};await p.card.create({data:{id:n+'-capacity',scryfallId:require('crypto').randomUUID(),name:n,typeLine:'Basic Land',setCode:'tst',collectorNumber:'1',rarity:'common'}});await p.inventoryItem.create({data:{cardId:n+'-capacity',currentOwnerId:n,originalOpenerId:n,locationId:n,quantity:1,condition:'NM',sourceType:'MANUAL'}});`);
    await start.click();await expect(page.getByRole("alert").filter({hasText:"The original Start is saved"})).toBeVisible();
    expect(requests).toHaveLength(1);
    await expect(page.getByRole("button",{name:"Change scanner setup",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Change scanner setup",exact:true}).click();
    await expect(page.getByRole("alert").filter({hasText:"Injected lost cancellation acknowledgement"})).toBeVisible();
    await expect(page.getByTestId("storage-destination").getByRole("button",{name:/change/i})).toBeDisabled();
    await page.reload();await expect(page.getByRole("button",{name:"Change scanner setup",exact:true})).toBeEnabled();
    expect(requests).toHaveLength(1); // Reload only recovers, never creates.
    await page.getByRole("button",{name:"Change scanner setup",exact:true}).click();
    // Retiring after reload opens the destination editor; it is already usable.
    const destination=page.getByTestId("storage-destination");
    await expect(destination.getByRole("combobox")).toBeEnabled();
    await destination.getByRole("button",{name:"Keep current destination",exact:true}).click();
    await expect(destination.getByRole("button",{name:/change/i})).toBeEnabled();
    await expect(destination).toContainText(tag);
    await expect(page.getByRole("status").filter({hasText:"The previous Start was cancelled."})).toBeVisible();
    // Atomic rejection has no partial batch/reservation to cancel.
    expect(Number(database(`console.log(await p.acquisitionSession.count({where:{createdByUserId:${JSON.stringify(tag)}}}));`).trim())).toBe(0);
    expect(retireRequests).toBe(2);
    await page.setViewportSize({width:320,height:700});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:"test-results/scanner-rejected-start-phone.png",fullPage:true});
    await page.setViewportSize({width:1366,height:768});
    await page.screenshot({path:"test-results/scanner-rejected-start-desktop.png",fullPage:true});
    // Retirement permanently rejects any late replay of the original request.
    const old=await page.request.post("/api/scanners/runs",{headers:{origin:baseURL!},data:requests[0]});expect(old.status()).toBe(409);
    expect((await old.json()).error).toMatch(/cancelled|retired/i);
    database(`await p.inventoryItem.deleteMany({where:{currentOwnerId:${JSON.stringify(tag)}}});`);
    await page.getByRole("button",{name:"Refresh capacity",exact:true}).click();await pulse();
    await expect(start).toBeEnabled();await start.click();
    await expect(page.getByRole("region",{name:"Scanner batch"})).toBeVisible();
    expect(requests).toHaveLength(2);expect(requests[1].requestKey).not.toBe(requests[0].requestKey);
    const counts=JSON.parse(database(`console.log(JSON.stringify({runs:await p.scannerRun.count({where:{agent:{userId:${JSON.stringify(tag)}}}}),photos:await p.acquisitionPhoto.count({where:{run:{session:{createdByUserId:${JSON.stringify(tag)}}}}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}})}));`));
    expect(counts).toEqual({runs:1,photos:0,inventory:0});
  } finally {
    try { await page.unrouteAll({behavior:"wait"}); } catch (error) { if(!page.isClosed()) throw error; }
    database(`const n=${JSON.stringify(tag)},w={run:{session:{createdByUserId:n}}};const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;
      if(!root||!paths.isAbsolute(root))throw new Error('Private fixture storage unavailable');
      const ids=new Set([...${JSON.stringify(requests.map(r=>r.requestKey))},...(await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}})).map(r=>r.id)]);
      for(const id of ids){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid owned fixture identity');for(const suffix of ['.start.json','.retired.json'])await fs.unlink(paths.join(root,'scanner-control-v1',id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      await p.scannerRun.deleteMany({where:{agent:{userId:n}}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.card.deleteMany({where:{id:n+'-capacity'}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});

test("changing setup after a lost Start acknowledgement opens the accepted batch instead",async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1","Owned local protocol fixture; no helper or motor");
  expect(baseURL).toBe("http://127.0.0.1:13001");test.setTimeout(120000);
  const tag=`ui-rejected-start-${randomUUID()}`,password=randomUUID(),agentId=randomUUID(),secret=randomBytes(32).toString("base64url");
  const creates:Record<string,unknown>[]=[];let original:{id:string;runId:string}|null=null,retireRequests=0;
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});`);
    await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    const pair=await page.request.post("/api/scanners",{headers:{origin:baseURL!},data:{action:"pair"}});expect(pair.ok()).toBe(true);
    expect((await page.request.post("/api/scanner-agent/pair",{data:{version:1,pairCode:(await pair.json()).code,agentId,secret,name:"Accepted Start fixture"}})).ok()).toBe(true);
    const headers={authorization:`Bearer ${agentId}.${secret}`};
    expect((await page.request.post("/api/scanner-agent/pulse",{headers,data:{version:1,agentVersion:"0.3.0-native",devices:[{id:"fixture-accepted",name:"Accepted Start fixture",backend:"fixture",source:"Fixture",qualification:"GenericUnqualified"}]}})).ok()).toBe(true);
    await page.route("**/api/scanners/runs?request=*",route=>route.fulfill({status:503,json:{error:"Injected lookup outage"}}));
    await page.route("**/api/scanners/runs",async route=>{
      const body=route.request().postDataJSON();
      if(body?.action==="retire"){retireRequests++;await route.continue();return;}
      if(body?.action!=="create"){await route.continue();return;}
      creates.push(body);const response=await route.fetch();expect(response.ok()).toBe(true);original=await response.json();
      const polled=await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"poll",version:1}});expect(polled.ok()).toBe(true);
      const {run,epoch}=await polled.json();
      const claimed=await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"claim",version:1,runId:run.runId,epoch,executionId:randomUUID()}});
      expect(claimed.ok()).toBe(true);expect((await claimed.json()).feedAuthorized).toBe(true); // no physical helper
      await route.fulfill({status:503,json:{error:"Injected lost accepted Start acknowledgement"}});
    });
    await page.goto("/imports/scan?input=scanner");await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);await page.getByRole("option").first().click();
    await page.getByRole("button",{name:"Start scanner batch",exact:true}).click();
    await expect(page.getByRole("alert").filter({hasText:"The original Start is saved"})).toBeVisible();
    await page.reload();await expect(page.getByRole("button",{name:"Change scanner setup",exact:true})).toBeEnabled();
    expect(creates).toHaveLength(1);
    database(`await p.scannerAgent.update({where:{id:${JSON.stringify(agentId)}},data:{lastSeenAt:new Date(0)}});`);
    await page.getByRole("button",{name:"Change scanner setup",exact:true}).click();
    await expect(page.getByRole("region",{name:"Scanner batch"})).toBeVisible();
    expect(original).not.toBeNull();await expect(page).toHaveURL(new RegExp(`batch=${original!.id}`));
    expect(creates).toHaveLength(1);expect(retireRequests).toBe(1);
    const state=JSON.parse(database(`const n=${JSON.stringify(tag)};const runs=await p.scannerRun.findMany({where:{agent:{userId:n}}});console.log(JSON.stringify({runs:runs.length,status:runs[0]?.status,sessions:await p.acquisitionSession.count({where:{createdByUserId:n}}),photos:await p.acquisitionPhoto.count({where:{run:{session:{createdByUserId:n}}}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:n}})}));`));
    expect(state).toEqual({runs:1,status:"STARTED",sessions:1,photos:0,inventory:0});
    expect(await page.evaluate(user=>sessionStorage.getItem(`mtg-scanner-start-v1:${user}`),tag)).toBeNull();
  } finally {
    try {await page.unrouteAll({behavior:"wait"});} catch(error){if(!page.isClosed())throw error;}
    database(`const n=${JSON.stringify(tag)},w={run:{session:{createdByUserId:n}}};const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;
      if(!root||!paths.isAbsolute(root))throw new Error('Private fixture storage unavailable');
      for(const r of await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}})){if(!/^[a-f0-9-]{36}$/.test(r.id))throw new Error('Invalid owned fixture identity');for(const suffix of ['.start.json','.retired.json'])await fs.unlink(paths.join(root,'scanner-control-v1',r.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      await p.scannerRun.deleteMany({where:{agent:{userId:n}}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});`);
  }
});
