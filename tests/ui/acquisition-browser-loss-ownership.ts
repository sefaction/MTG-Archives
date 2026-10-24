export type BrowserLossIdentity = {id:string;web:string;image:string;run:string;nonce:string};
type OwnedBrowser = {Id:string;Image:string;Mounts:unknown[];
  Config:{Labels:Record<string,string>};HostConfig:{NetworkMode:string};
  State:{Running:boolean;Paused:boolean;Restarting:boolean;Dead:boolean;OOMKilled:boolean;StartedAt:string;ExitCode:number}};

/** Only the newly created, isolated browser may be interrupted. Never accept
 * names, shortened IDs, an inherited image label or an observation timeout. */
export function requireBrowserLossOwnership(value:unknown, expected:BrowserLossIdentity,
  phase:"running"|"terminal") {
  if(!/^[a-f0-9]{64}$/.test(expected.id)||!/^[a-f0-9]{64}$/.test(expected.web)||
    !/^sha256:[a-f0-9]{64}$/.test(expected.image)||!/^[a-f0-9]{32}$/.test(expected.nonce)||
    !/^acquisition-browser-loss-310-[a-z0-9-]+$/.test(expected.run))throw Error("Invalid browser fixture identity");
  const info=value as {Id?:string;Image?:string;Mounts?:unknown[];
    Config?:{Labels?:Record<string,string>};HostConfig?:{NetworkMode?:string};
    State?:{Running?:boolean;Paused?:boolean;Restarting?:boolean;Dead?:boolean;OOMKilled?:boolean;StartedAt?:string;ExitCode?:number}};
  if(!info||info.Id!==expected.id||info.Image!==expected.image||
    info.Config?.Labels?.["mtg.run"]!==expected.run||
    info.Config?.Labels?.["mtg.browser-loss.nonce"]!==expected.nonce||
    info.Config?.Labels?.["mtg.fixture.role"]!=="browser-loss-browser"||
    info.HostConfig?.NetworkMode!==`container:${expected.web}`||
    !Array.isArray(info.Mounts)||info.Mounts.length!==0||
    typeof info.State?.Running!=="boolean"||typeof info.State.Paused!=="boolean"||
    typeof info.State.Restarting!=="boolean"||typeof info.State.Dead!=="boolean"||
    typeof info.State.OOMKilled!=="boolean"||typeof info.State.StartedAt!=="string"||
    !Number.isFinite(Date.parse(info.State.StartedAt))||!Number.isInteger(info.State.ExitCode)||
    info.State.Paused||info.State.Restarting||
    info.State.Dead||info.State.OOMKilled||info.State.Running!==(phase==="running"))
    throw Error("Browser fixture ownership or terminal state differs; nothing may be interrupted or retired");
  return info as OwnedBrowser;
}
