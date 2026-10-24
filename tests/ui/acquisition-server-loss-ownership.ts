export const SERVER_LOSS_UPLOADS_ROOT="/build/.local-data/server-loss-uploads";
export type ServerLossIdentity={id:string;image:string;run:string;nonce:string;anchor:string;uploads:string;database:string};

/** The destructive target is only the exact new web process. A shared name,
 * port, old claim or missing state never authorizes stopping an installation. */
export function requireServerLossOwnership(value:unknown, expected:ServerLossIdentity, phase:"running"|"terminal") {
  const item=value as any;
  if(!/^[a-f0-9]{64}$/.test(expected.id)||!/^sha256:[a-f0-9]{64}$/.test(expected.image)||
    !/^acquisition-server-loss-310-[a-z0-9-]+$/.test(expected.run)||! /^[a-f0-9]{32}$/.test(expected.nonce)||
    !/^[a-f0-9]{64}$/.test(expected.anchor)||expected.anchor===expected.id||
    expected.uploads!=="mtg-server-loss-uploads-"+expected.nonce.slice(0,12)||!/^review\w+$/.test(expected.database))
    throw Error("Immutable isolated server-loss identity required");
  const state=item?.State,config=item?.Config,host=item?.HostConfig,mounts=item?.Mounts;
  if(item?.Id!==expected.id||item.Image!==expected.image||config?.Labels?.["mtg.run"]!==expected.run||
    config.Labels?.["mtg.server-loss.nonce"]!==expected.nonce||config.Labels?.["mtg.fixture.role"]!=="server-loss-web"||
    host?.NetworkMode!=="container:"+expected.anchor||host.Privileged!==false||
    (host.PortBindings!==null&&(typeof host.PortBindings!=="object"||Array.isArray(host.PortBindings)||Object.keys(host.PortBindings).length))||host.RestartPolicy?.Name!=="no"||
    !Array.isArray(mounts)||mounts.length!==1||mounts[0].Type!=="volume"||mounts[0].Name!==expected.uploads||
    mounts[0].Destination!==SERVER_LOSS_UPLOADS_ROOT||mounts[0].RW!==true)
    throw Error("Web target, private namespace or sole upload storage differs");
  const urls=(config.Env??[]).filter((entry:unknown)=>typeof entry==="string"&&entry.startsWith("DATABASE_URL="));
  const url=urls.length===1?new URL(urls[0].slice("DATABASE_URL=".length)):null;
  if(!url||url.protocol!=="postgresql:"||url.hostname!=="server-loss-pg"||url.pathname!=="/"+expected.database)
    throw Error("Unexpected web database target");
  if(!state||typeof state.Running!=="boolean"||state.Paused!==false||state.Restarting!==false||state.Dead!==false||
    state.OOMKilled!==false||!Number.isInteger(state.ExitCode)||state.ExitCode<0||state.ExitCode>255||
    !Number.isFinite(Date.parse(state.StartedAt))||state.Running!==(phase==="running")||
    (phase==="running"&&(state.Status!=="running"||!Number.isInteger(state.Pid)||state.Pid<=0))||
    (phase==="terminal"&&(state.Status!=="exited"||state.Pid!==0||!Number.isFinite(Date.parse(state.FinishedAt)))))
    throw Error("Web process state is uncertain or not in the declared phase");
  return item;
}
/** A close rejection is not proof that browser requests have stopped. */
export async function observeServerLossPageClosure(page:{close():Promise<void>;isClosed():boolean}) {
  let error:unknown;
  try{await page.close();}catch(reason){error=reason;}
  const closed=page.isClosed();
  return {closed,error:error??(closed?undefined:Error("Page closure was not positively observed"))};
}
/** Keep destructive fixture helpers unreachable until every terminal proof agrees. */
export async function withServerLossCleanup(terminal:{pageClosed:boolean;blockerClosed:boolean;databaseSafe:boolean},cleanup:()=>Promise<void>) {
  if(terminal.pageClosed!==true||terminal.blockerClosed!==true||terminal.databaseSafe!==true)return false;
  await cleanup();return true;
}