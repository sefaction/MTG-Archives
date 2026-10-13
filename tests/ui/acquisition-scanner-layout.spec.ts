import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {database,json,sha,cleanupReferenceRows,docker,web,worker} from './acquisition-reference-local';
import {cancelAndCleanCorrectionFixture} from './correction-fixture';

for(const padded of [false,true])test('actual '+(padded?'padded':'tight')+' scanner layout save/use/reset preserves originals and future snapshots',async({page,baseURL})=>{
  const folder=padded?process.env.MTG_SCANNER_PADDED_FIXTURES_PATH:process.env.MTG_SCANNER_LAYOUT_FIXTURES_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||!folder,'Isolated local generated scanner controls required; no hardware feed');
  expect(baseURL).toBe('http://127.0.0.1:13011');test.setTimeout(600000);
  const endpoint=JSON.parse(docker(['context','inspect',docker(['context','show']).trim(),'--format','{{json .Endpoints.docker.Host}}']));
  expect(endpoint.startsWith('npipe://')||endpoint.startsWith('unix://')).toBe(true);
  if(process.env.DOCKER_HOST)expect(process.env.DOCKER_HOST.startsWith('npipe://')||process.env.DOCKER_HOST.startsWith('unix://')).toBe(true);
  for(const name of [web,worker])expect(docker(['inspect',name,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim()).toBe('mtg-anchor-qualification');
  expect(database("console.log(process.env.DATABASE_URL?.includes('/acquisition_anchor_review'));").trim()).toBe('true');
  const source=folder+'/calibration.png',target=folder+'/unresolved.png',tag=`ui-reference-scan-${randomUUID()}`,password=randomUUID();
  const own=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`;
  const state=()=>json(`console.log(JSON.stringify({photos:await p.acquisitionPhoto.findMany({where:${own},orderBy:{createdAt:'asc'}}),jobs:await p.acquisitionProcessingJob.findMany({where:${own},orderBy:{createdAt:'asc'}}),candidates:await p.acquisitionCandidate.findMany({where:${own},include:{receipt:true}}),player:await p.player.findUnique({where:{id:${JSON.stringify(tag)}},select:{scannerLayoutProfile:true}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}})}));`);
  const settled=async(count:number)=>{
    await expect.poll(()=>state().photos.length,{timeout:60000,intervals:[1000]}).toBe(count);
    await expect.poll(()=>{
      const s=state();return s.jobs.filter((j:any)=>j.stage==='photo-printing-evidence-v1'&&j.status==='COMPLETE').length;
    },{timeout:240000,intervals:[1000,3000]}).toBeGreaterThanOrEqual(count);
    await expect.poll(()=>state().jobs.filter((j:any)=>['PENDING','RUNNING'].includes(j.status)).length,{timeout:120000,intervals:[1000,3000]}).toBe(0);
    const s=state();if(process.env.MTG_SCANNER_LAYOUT_REPORT_PATH)writeFileSync(process.env.MTG_SCANNER_LAYOUT_REPORT_PATH+(padded?'.padded':'.tight')+'.phase-'+count+'.json',JSON.stringify(s,null,2));expect(s.jobs.filter((j:any)=>j.status==='FAILED')).toHaveLength(0);return s;
  };
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:3,sections:[]}}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);await page.getByRole('option').first().click();
    await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');await page.getByRole('button',{name:'Advanced',exact:true}).click();
    await page.getByLabel('Choose card photos').setInputFiles(source);const first=await settled(1);
    const firstNative=first.jobs.find((j:any)=>j.stage==='photo-recognition-v1').output.native;
    expect(firstNative.geometry.method).toBe('scanner-card-edges');expect(firstNative.scannerLayoutTemplate).toBeTruthy();
    expect(first.photos[0].scannerLayoutProfile).toBeNull();
    const firstCard=page.getByTestId('capture-card-1');
    await firstCard.getByRole('button',{name:'Reuse outline for future scans',exact:true}).click();
    await expect(firstCard.getByRole('status').filter({hasText:'Scanner layout saved for future scans.'})).toBeVisible();
    const profile=state().player.scannerLayoutProfile;expect(profile).not.toBeNull();
    await page.getByLabel('Choose card photos').setInputFiles(target);const second=await settled(2);
    expect(second.photos[1].scannerLayoutProfile).toBe(profile);
    const inferred=second.jobs.find((j:any)=>j.stage==='photo-recognition-v1'&&j.input.photoId===second.photos[1].id).output.native;
    expect(inferred.geometry.method).toBe('declared-card-scan');expect(inferred.scannerLayout.inference.status).toBe('PROPOSED');
    expect(inferred.scannerLayout.inference.boundaryVerified).toBe(false);expect(inferred.scannerLayout.readingStatus).toBe('COMPLETE');
    const identifier=inferred.scannerLayout.orientations[0];
    expect(identifier.identifierSource.status).toBe('EXTRACTED');
    expect(identifier.identifierSource.width).toBeGreaterThan(606);expect(identifier.identifierSource.height).toBeGreaterThan(126);
    expect(identifier.identifierSource.width).toBeLessThanOrEqual(identifier.identifierSource.sourceWidth);
    expect(identifier.identifierSource.height).toBeLessThanOrEqual(identifier.identifierSource.sourceHeight);
    expect(identifier.identifierSource.sourceFrame).toEqual({width:padded?1600:1700,height:2300});
    if(padded){
      expect(inferred.orientations[0].text.footer).toEqual([]);
      expect(inferred.scannerLayout.inference.anchorSpace).toBe('LAYOUT_SEARCH');
      expect(inferred.scannerLayout.inference.observedAnchors).toEqual(['COLLECTOR','TITLE']);
      expect(inferred.scannerLayout.anchorSearch.status).toBe('COMPLETE');
      expect(inferred.scannerLayout.anchorSearch.orientations[0].text.title).toEqual(['Another Creature']);
    }else expect(inferred.scannerLayout.anchorSearch).toBeUndefined();
    expect(identifier.identifierLines.length).toBeGreaterThan(0);
    expect(identifier.text.footerSourceIdentifiers).toEqual(['U 0042','TST EN']);
    const card=page.getByTestId('capture-card-2');
    for(const width of [1366,320]){
      await page.setViewportSize({width,height:1000});
      await card.scrollIntoViewIfNeeded();const details=card.getByTestId('scanner-layout-readings');await expect(details).toBeVisible();
      if(!await details.evaluate(e=>(e as HTMLDetailsElement).open))await details.locator('summary').click();
      await expect(details.getByText('Title: Another Creature',{exact:true})).toBeVisible();
      await expect(details.getByText('Footer: U 0042 | TST EN',{exact:true})).toBeVisible();
      await expect(details.getByText('Additional identifier reading: U 0042 | TST EN',{exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(padded){
        const search=card.getByTestId('scanner-anchor-search');await expect(search).toBeVisible();
        if(!await search.evaluate(e=>(e as HTMLDetailsElement).open))await search.locator('summary').click();
        await expect(search.getByText('Title: Another Creature',{exact:true})).toBeVisible();
        await expect(search.getByText('Footer: U 0042 | TST EN',{exact:true})).toBeVisible();
      }
      await details.screenshot({path:`test-results/scanner-layout-${padded?'padded':'tight'}-${width}.png`});
    }
    await card.getByRole('button',{name:'Edit card boundary',exact:true}).click();
    await expect(card.getByRole('button',{name:'Use scanner outline',exact:true})).toBeVisible();
    await card.getByRole('button',{name:'Cancel boundary changes',exact:true}).click();
    await card.getByRole('button',{name:'Remove saved scanner layout',exact:true}).click();
    await expect(card.getByRole('status').filter({hasText:'Saved scanner layout removed.'})).toBeVisible();
    expect(state().player.scannerLayoutProfile).toBeNull();expect(state().photos[1].scannerLayoutProfile).toBe(profile);
    await page.getByLabel('Choose card photos').setInputFiles(target);const final=await settled(3);
    expect(final.photos[2].scannerLayoutProfile).toBeNull();
    const plain=final.jobs.find((j:any)=>j.stage==='photo-recognition-v1'&&j.input.photoId===final.photos[2].id).output.native;
    expect(plain.scannerLayout).toBeUndefined();
    for(const key of ['geometry','text','lines','orientations','readingZones'])expect(inferred[key]).toEqual(plain[key]);
    for(let i=0;i<3;i++){
      const original=i===0?source:target;expect(final.photos[i].digest).toBe(sha(readFileSync(original)));
      // The ordinary original link is the authority for download parameters.
      await page.getByTestId(`capture-card-${i+1}`).scrollIntoViewIfNeeded();
      const link=await page.getByTestId(`capture-card-${i+1}`).getByRole('link',{name:'Open original photo',exact:true}).getAttribute('href');
      const download=await page.request.get(link!);expect(download.ok()).toBe(true);expect(sha(await download.body())).toBe(final.photos[i].digest);
    }
    expect(final.inventory).toBe(0);expect(final.candidates.every((c:any)=>c.review===null&&c.receipt===null)).toBe(true);
    if(process.env.MTG_SCANNER_LAYOUT_REPORT_PATH)writeFileSync(process.env.MTG_SCANNER_LAYOUT_REPORT_PATH+(padded?'.padded':'.tight'),JSON.stringify({syntheticPixels:true,independentScannerAccuracy:false,passed:true,state:final,widths:[1366,320]},null,2));
  }finally{
    database(`await p.authSession.deleteMany({where:{userId:${JSON.stringify(tag)}}});`+cancelAndCleanCorrectionFixture(tag));
    cleanupReferenceRows(tag);database(cancelAndCleanCorrectionFixture(tag));
  }
});
