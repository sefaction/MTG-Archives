import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('private original-only boundary labels verify bytes, source coordinates and resumable exports',async({page})=>{
  const folder=process.env.MTG_SCANNER_BOUNDARY_CONTROL_PATH,images=process.env.MTG_SCANNER_BOUNDARY_IMAGE_PATH;
  test.skip(!folder||!images,'Explicit private synthetic annotation controls required');test.setTimeout(60000);
  const output=mkdtempSync(path.join(folder!,'browser-'));
  await page.setViewportSize({width:1366,height:1200});
  await page.goto(pathToFileURL(path.join(folder!,'controls.html')).href);
  await expect(page.getByRole('heading',{name:'Mark the physical card outline'})).toBeVisible();
  await page.locator('#images').setInputFiles([path.join(images!,'calibration.png'),path.join(images!,'unresolved.png')]);
  await expect(page.getByRole('status')).toHaveText('Click the four corners, then save the visible outline.');
  await page.locator('#reviewer').fill('Synthetic control operator');await page.locator('#zoom').selectOption('0.25');
  const canvas=page.locator('#canvas');await canvas.scrollIntoViewIfNeeded();
  // Independent known outer contour:12px centered rim around[50,30]..[1650,2270].
  const points=[[44,24],[1656,24],[1656,2276],[44,2276]];
  for(const [x,y] of points)await canvas.click({position:{x:x*.25,y:y*.25}});
  await page.getByRole('button',{name:'Save visible outline',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Label saved locally. Export to keep it after closing this page.');
  const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Export labels',exact:true}).click();
  const download=await downloadWait,file=path.join(output,'labels.json');await download.saveAs(file);
  const truth=JSON.parse(readFileSync(file,'utf8'));
  // A rasterized mouse click at25% has up to2 native pixels of rounding.
  for(let i=0;i<4;i++)for(let axis=0;axis<2;axis++)expect(Math.abs(truth.entries[0].boundary.quad[i][axis]-points[i][axis])).toBeLessThanOrEqual(2);expect(truth.entries[0].boundary.status).toBe('VISIBLE');
  expect(truth.entries[1].boundary.status).toBe('PENDING');expect(truth.entries[1].boundary.quad).toBeNull();
  expect(truth.entries.every((e:any)=>e.expectedScryfallIds===null)).toBe(true);
  await page.getByRole('button',{name:'Clear label',exact:true}).click();
  await page.locator('#resume').setInputFiles(file);await expect(page.getByRole('status')).toHaveText('Exported labels restored.');
  const changed=structuredClone(truth);changed.entries[0].sha256='f'.repeat(64);const changedPath=path.join(output,'changed.json');writeFileSync(changedPath,JSON.stringify(changed));
  await page.locator('#resume').setInputFiles(changedPath);await expect(page.getByRole('status')).toHaveText('Resume file has different originals or truth metadata.');
  const corrupted=path.join(output,'calibration.png');writeFileSync(corrupted,readFileSync(path.join(images!,'unresolved.png')));
  await page.locator('#images').setInputFiles(corrupted);await expect(page.getByRole('status')).toHaveText('The selected file differs from the frozen original.');
  await expect(page.getByRole('button',{name:'Save visible outline',exact:true})).toBeDisabled();
  await page.locator('#images').setInputFiles([path.join(images!,'calibration.png'),path.join(images!,'unresolved.png')]);
  await expect(page.getByRole('status')).toHaveText('Saved outline loaded. Clear it to replace its corners.');
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Click the four corners, then save the visible outline.');
  await page.getByRole('button',{name:'Uncertain',exact:true}).click();
  const finalWait=page.waitForEvent('download');await page.getByRole('button',{name:'Export labels',exact:true}).click();
  await (await finalWait).saveAs(path.join(folder!,'browser-labels.json'));
  for(const width of [1366,320]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(folder!,'labeler-'+width+'.png')});}
});
