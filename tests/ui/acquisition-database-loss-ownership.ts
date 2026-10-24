export type DatabaseLossIdentity = {
  id: string; image: string; run: string; nonce: string;
  network: string; volume: string; database: string;
};
type OwnedDatabase = {
  Id: string; Image: string;
  Config: {Labels: Record<string,string>; Env: string[]};
  Mounts: {Type:string;Name:string;Destination:string;RW:boolean}[];
  HostConfig: {NetworkMode:string;PortBindings:Record<string,unknown>;Privileged:boolean};
  NetworkSettings: {Networks:Record<string,{NetworkID:string}>};
  State: {Running:boolean;Paused:boolean;Restarting:boolean;Dead:boolean;OOMKilled:boolean;StartedAt:string;ExitCode:number};
};

/** Refuse every crash/restart/retirement unless the exact newly created
 * disposable PostgreSQL container, data volume and private network still match. */
export function requireDatabaseLossOwnership(value:unknown, expected:DatabaseLossIdentity,
  phase:"running"|"terminal") {
  if(!/^[a-f0-9]{64}$/.test(expected.id)||!/^sha256:[a-f0-9]{64}$/.test(expected.image)||
    !/^[a-f0-9]{64}$/.test(expected.network)||!/^[a-f0-9]{32}$/.test(expected.nonce)||
    !/^acquisition-database-loss-310-[a-z0-9-]+$/.test(expected.run)||
    !/^mtg-database-loss-data-[a-z0-9-]+$/.test(expected.volume)||!/^review\w+$/.test(expected.database))
    throw Error("Invalid disposable database identity");
  const info=value as Partial<OwnedDatabase>|null;
  const state=info?.State, mounts=info?.Mounts, config=info?.Config;
  const networks=Object.values(info?.NetworkSettings?.Networks??{});
  if(!info||info.Id!==expected.id||info.Image!==expected.image||
    config?.Labels?.["mtg.run"]!==expected.run||
    config?.Labels?.["mtg.database-loss.nonce"]!==expected.nonce||
    config?.Labels?.["mtg.fixture.role"]!=="database-loss-postgres"||
    !Array.isArray(config?.Env)||config.Env.filter(v=>v.startsWith("POSTGRES_DB=")).join()!==`POSTGRES_DB=${expected.database}`||
    config.Env.filter(v=>v.startsWith("POSTGRES_USER=")).join()!=="POSTGRES_USER=review"||
    !Array.isArray(mounts)||mounts.length!==1||mounts[0].Type!=="volume"||
    mounts[0].Name!==expected.volume||mounts[0].Destination!=="/var/lib/postgresql/data"||mounts[0].RW!==true||
    info.HostConfig?.NetworkMode!==expected.network||info.HostConfig.Privileged!==false||
    !info.HostConfig.PortBindings||Object.keys(info.HostConfig.PortBindings).length!==0||
    networks.length!==1||networks[0].NetworkID!==expected.network||
    typeof state?.Running!=="boolean"||typeof state.Paused!=="boolean"||typeof state.Restarting!=="boolean"||
    typeof state.Dead!=="boolean"||typeof state.OOMKilled!=="boolean"||state.Paused||state.Restarting||
    state.Dead||state.OOMKilled||state.Running!==(phase==="running")||
    typeof state.StartedAt!=="string"||!Number.isFinite(Date.parse(state.StartedAt))||!Number.isInteger(state.ExitCode))
    throw Error("Disposable database ownership/state differs; preserve resources without interruption");
  return info as OwnedDatabase;
}
