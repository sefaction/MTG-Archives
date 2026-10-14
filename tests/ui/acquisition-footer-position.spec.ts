import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';import path from 'node:path';
import {database,json,sha,cleanupReferenceRows,docker,web} from './acquisition-reference-local';
import {cancelAndCleanCorrectionFixture} from './correction-fixture';import {ACQUISITION_FOOTER_PARSER_VERSION} from '../../lib/acquisition-footer';

test('actual scanner footer boxes distinguish power/toughness noise and preserve original readings',async({page,baseURL})=>{
  const root=process.env.MTG_SET_TOKEN_SCAN_FIXTURES_PATH,baseline=process.env.MTG_SET_TOKEN_NATIVE_BASELINE_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||!root||!baseline,'Private saved17/39/115/20 scanner controls and frozen native baseline required; no hardware feed');
  expect(baseURL).toBe('http://127.0.0.1:13011');test.setTimeout(600000);
  expect(docker(['inspect',web,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim()).toBe('mtg-anchor-qualification');
  expect(database("console.log(process.env.DATABASE_URL?.includes('/acquisition_anchor_review'));").trim()).toBe('true');
  const manifest=JSON.parse(readFileSync(path.join(__dirname,'../../tools/acquisition-eval/scan-batch-manifest.json'),'utf8'));
  const entries=['test-scan.017.jpg','test-scan.039.jpg','test-scan.115.jpg','test-scan.020.jpg'].map(file=>manifest.entries.find((e:any)=>e.file===file));
  const inputs=entries.map((e:any)=>{const file=path.join(root!,e.file);expect(sha(readFileSync(file))).toBe(e.sha256);return file;});
  const tag=`ui-reference-scan-${randomUUID()}`,password=randomUUID(),scope=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`;
  const state=()=>json(`console.log(JSON.stringify({photos:await p.acquisitionPhoto.findMany({where:${scope},orderBy:{createdAt:'asc'}}),jobs:await p.acquisitionProcessingJob.findMany({where:${scope},orderBy:{createdAt:'asc'}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}),candidates:await p.acquisitionCandidate.findMany({where:${scope},include:{receipt:true}})}));`);
  let primaryFailure:unknown;
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:4,sections:[]}}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);await page.getByRole('option').first().click();await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');await page.getByRole('button',{name:'Advanced',exact:true}).click();await page.getByLabel('Choose card photos').setInputFiles(inputs);
    await expect.poll(()=>state().photos.length,{timeout:60000,intervals:[1000]}).toBe(4);
    await expect.poll(()=>state().jobs.filter((j:any)=>j.stage==='photo-printing-evidence-v1'&&j.status==='COMPLETE').length,{timeout:300000,intervals:[3000,5000]}).toBeGreaterThanOrEqual(4);
    await expect.poll(()=>state().jobs.filter((j:any)=>['PENDING','RUNNING'].includes(j.status)).length,{timeout:120000,intervals:[1000,3000]}).toBe(0);
    const final=state();expect(final.jobs.filter((j:any)=>j.status==='FAILED')).toHaveLength(0);
    for(const [i,entry] of entries.entries()){
      const photo=final.photos.find((p:any)=>p.digest===entry.sha256);expect(photo).toBeTruthy();
      const primary=final.jobs.find((j:any)=>j.stage==='photo-recognition-v1'&&j.input.photoId===photo.id);
      const printing=final.jobs.filter((j:any)=>j.stage==='photo-printing-evidence-v1'&&j.input.photoId===photo.id).at(-1);
      expect(primary.output.versions.footerParser).toBe(ACQUISITION_FOOTER_PARSER_VERSION);expect(printing.output.versions.footerParser).toBe(ACQUISITION_FOOTER_PARSER_VERSION);
      const old=JSON.parse(readFileSync(path.join(baseline!,'current-124-report.json.'+entry.file+'.json'),'utf8')).jobs.find((j:any)=>j.stage==='photo-recognition-v1').output.native;
      for(const key of ['geometry','text','lines','orientations','readingZones'])expect(primary.output.native[key]).toEqual(old[key]);
      expect(primary.output.proposals.evidence.collectors).toContain(entry.printedCollectorNumber);const extra=['47j','4','413','21'][i];expect(primary.output.proposals.evidence.collectors).not.toContain(extra);
      if(i<3)expect(primary.output.native.orientations[0].text.footerSupplemental.map((s:string)=>s.toLowerCase())).toContain(extra);
      expect(primary.output.proposals.automaticAcceptance).toBe(false);
      expect(primary.output.proposals.evidence.setCodes).not.toContain('stev');expect(primary.output.proposals.automaticAcceptance).toBe(false);expect(printing.output.proposals.automaticAcceptance).toBe(false);
      const id=database(`console.log((await p.card.findUniqueOrThrow({where:{scryfallId:${JSON.stringify(entry.scryfallId)}},select:{id:true}})).id);`).trim();expect(printing.output.proposals.proposals[0].card.id).toBe(id);
      const card=page.getByTestId(`capture-card-${i+1}`);await card.scrollIntoViewIfNeeded();const details=card.locator('details').filter({has:page.getByText('All OCR text and reading directions',{exact:true})});
      if(!await details.evaluate(e=>(e as HTMLDetailsElement).open))await details.locator('summary').click();
      const footer=primary.output.native.orientations[0].text.footer.join(' | ');
      for(const width of [1366,320]){await page.setViewportSize({width,height:1000});await expect(details.getByText('Footer: '+footer,{exact:true})).toBeVisible();
        const additional=primary.output.native.orientations[0].text.footerSupplemental;
        if(additional?.length)await expect(details.getByText('Additional footer reading: '+additional.join(' | '),{exact:true})).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
      const link=await card.getByRole('link',{name:'Open original photo',exact:true}).getAttribute('href');const download=await page.request.get(link!);expect(download.ok()).toBe(true);expect(sha(await download.body())).toBe(entry.sha256);expect(sha(readFileSync(inputs[i]))).toBe(entry.sha256);
    }
    expect(final.inventory).toBe(0);expect(final.candidates.every((c:any)=>c.review===null&&c.receipt===null)).toBe(true);
    if(process.env.MTG_SET_TOKEN_REPORT_PATH)writeFileSync(process.env.MTG_SET_TOKEN_REPORT_PATH,JSON.stringify({passed:true,developmentOnly:true,state:final},null,2));
  }catch(error){primaryFailure=error;}finally{
    const failures:unknown[]=primaryFailure===undefined?[]:[primaryFailure];
    const cleanup=async(action:()=>unknown|Promise<unknown>)=>{try{await action();}catch(error){failures.push(error);}};
    await cleanup(()=>database(`await p.authSession.deleteMany({where:{userId:${JSON.stringify(tag)}}});`+cancelAndCleanCorrectionFixture(tag)));
    await cleanup(async()=>{if(!page.isClosed())await page.goto('/login');});
    await cleanup(()=>cleanupReferenceRows(tag));
    await cleanup(()=>database(cancelAndCleanCorrectionFixture(tag)));
    if(failures.length)throw new AggregateError(failures,'Scanner footer position qualification or cleanup failed');
  }
});
