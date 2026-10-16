import {execFileSync} from 'node:child_process';
export function controlledReviewTarget(value = process.env.MTG_REVIEW_FIXTURE_CONTAINER ?? 'mtg-archives-web-1') {
  if(value==='mtg-archives-web-1') return {container:value,baseURL:'http://127.0.0.1:13001',project:'mtg-archives'};
  if(value==='mtg-anchor-qualification-web-1') return {container:value,baseURL:'http://127.0.0.1:13011',project:'mtg-anchor-qualification'};
  throw new Error('Controlled review fixtures require an explicitly supported local web container');
}
export function verifyControlledReviewTarget(target:ReturnType<typeof controlledReviewTarget>) {
  const run=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000}).trim();
  const endpoint=JSON.parse(run(['context','inspect',run(['context','show']),'--format','{{json .Endpoints.docker.Host}}']));
  if(!/^(npipe:\/\/|unix:\/\/)/.test(process.env.DOCKER_HOST??endpoint)) throw new Error('Controlled review fixtures require a local Docker engine');
  if(run(['inspect',target.container,'--format','{{index .Config.Labels "com.docker.compose.project"}}'])!==target.project)
    throw new Error('Controlled review fixture container belongs to another project');
}
