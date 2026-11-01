import {execFileSync} from 'node:child_process';
export function controlledReviewTarget(value = process.env.MTG_REVIEW_FIXTURE_CONTAINER ?? 'mtg-archives-web-1') {
  if(value==='mtg-archives-web-1') return {container:value,baseURL:'http://127.0.0.1:13001',project:'mtg-archives'};
  if(value==='mtg-anchor-qualification-web-1') return {container:value,baseURL:'http://127.0.0.1:13011',project:'mtg-anchor-qualification'};
  if(value==='mtg-reload308-qualification-web') return {container:value,baseURL:'http://127.0.0.1:23001',project:'mtg-reload308-qualification'};
  throw new Error('Controlled review fixtures require an explicitly supported local web container');
}
export type DockerRead = (args: string[]) => string;
const readDocker: DockerRead = args => execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000}).trim();
export function verifyControlledReviewTarget(
  target:ReturnType<typeof controlledReviewTarget>, run: DockerRead = readDocker, dockerHost = process.env.DOCKER_HOST,
) {
  const known = controlledReviewTarget(target.container);
  if(target.baseURL !== known.baseURL || target.project !== known.project) throw new Error('Controlled review fixture target was changed');
  const local = (endpoint: string) =>
    /^npipe:\/{2,4}(?:\.|localhost)\/pipe\/[a-zA-Z0-9_.-]+$/i.test(endpoint) ||
    /^unix:\/\/\/(?!\/)[^?#]+$/.test(endpoint);
  if(dockerHost && !local(dockerHost)) throw new Error('Controlled review fixtures require a local Docker engine');
  const endpoint=JSON.parse(run(['context','inspect',run(['context','show']),'--format','{{json .Endpoints.docker.Host}}']));
  if(typeof endpoint !== 'string' || !local(endpoint)) throw new Error('Controlled review fixtures require a local Docker engine');
  if(dockerHost && dockerHost !== endpoint) throw new Error('Controlled review Docker override and context must match');
  // Deliberately inspect only identity, state, project and published ports; never Env.
  const web = JSON.parse(run(['container','inspect',target.container,'--format',
    '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"ports":{{json .NetworkSettings.Ports}}}']));
  if(typeof web?.id !== 'string' || !/^[a-f0-9]{64}$/.test(web.id) || web.name !== `/${target.container}` || web.running !== true)
    throw new Error('Controlled review fixture container identity or running state changed');
  if(web.project !== target.project)
    throw new Error('Controlled review fixture container belongs to another project');
  const bindings = web.ports?.['3000/tcp'];
  if(!Array.isArray(bindings) || bindings.length !== 1 || bindings[0]?.HostIp !== '127.0.0.1' || bindings[0]?.HostPort !== new URL(target.baseURL).port)
    throw new Error('Controlled review fixture loopback port does not match baseURL');
  return web.id as string;
}
