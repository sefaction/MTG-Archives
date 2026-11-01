import assert from "node:assert/strict";
import test from "node:test";
import {requireDatabaseLossOwnership} from "./ui/acquisition-database-loss-ownership";
const expected={id:"1".repeat(64),image:"sha256:"+"2".repeat(64),network:"3".repeat(64),nonce:"4".repeat(32),
  run:"acquisition-database-loss-310-unit",volume:"mtg-database-loss-data-unit",database:"reviewUnit"};
function record(){return {
  Id:expected.id,Image:expected.image,
  Config:{Labels:{"mtg.run":expected.run,"mtg.database-loss.nonce":expected.nonce,"mtg.fixture.role":"database-loss-postgres"},
    Env:[`POSTGRES_DB=${expected.database}`,"POSTGRES_USER=review"]},
  Mounts:[{Type:"volume",Name:expected.volume,Destination:"/var/lib/postgresql/data",RW:true}],
  HostConfig:{NetworkMode:expected.network,PortBindings:{} as Record<string,unknown>,Privileged:false},
  NetworkSettings:{Networks:{isolated:{NetworkID:expected.network}}},
  State:{Running:true,Paused:false,Restarting:false,Dead:false,OOMKilled:false,StartedAt:"2026-10-24T00:00:00Z",ExitCode:0},
};}
test("database interruption requires exact disposable data and current container state",()=>{
  const info=record();assert.equal(requireDatabaseLossOwnership(info,expected,"running"),info);
  assert.throws(()=>requireDatabaseLossOwnership(info,expected,"terminal"));
  info.State.Running=false;info.State.ExitCode=137;
  assert.equal(requireDatabaseLossOwnership(info,expected,"terminal"),info);
  assert.throws(()=>requireDatabaseLossOwnership(info,expected,"running"));
});
test("foreign containers/data/networks, published ports and uncertain database states are refused",()=>{
  for(const mutate of [
    (x:ReturnType<typeof record>)=>{x.Id="5".repeat(64);},
    (x:ReturnType<typeof record>)=>{x.Image="sha256:"+"5".repeat(64);},
    (x:ReturnType<typeof record>)=>{x.Config.Labels["mtg.run"]="another-owner";},
    (x:ReturnType<typeof record>)=>{x.Config.Labels["mtg.database-loss.nonce"]="5".repeat(32);},
    (x:ReturnType<typeof record>)=>{x.Config.Labels["mtg.fixture.role"]="database-loss-web";},
    (x:ReturnType<typeof record>)=>{x.Config.Env=["POSTGRES_DB=main","POSTGRES_USER=review"];},
    (x:ReturnType<typeof record>)=>{x.Config.Env.push("POSTGRES_DB=main");},
    (x:ReturnType<typeof record>)=>{x.Mounts[0].Name="user-data";},
    (x:ReturnType<typeof record>)=>{x.Mounts[0].Type="bind";},
    (x:ReturnType<typeof record>)=>{x.Mounts[0].Destination="/unrelated";},
    (x:ReturnType<typeof record>)=>{x.Mounts.push({...x.Mounts[0],Name:"extra"});},
    (x:ReturnType<typeof record>)=>{x.HostConfig.NetworkMode="host";},
    (x:ReturnType<typeof record>)=>{x.NetworkSettings.Networks.isolated.NetworkID="5".repeat(64);},
    (x:ReturnType<typeof record>)=>{x.HostConfig.PortBindings={"5432/tcp":[{HostPort:"5432"}]};},
    (x:ReturnType<typeof record>)=>{x.HostConfig.Privileged=true;},
    (x:ReturnType<typeof record>)=>{x.State.Paused=true;},
    (x:ReturnType<typeof record>)=>{x.State.Restarting=true;},
    (x:ReturnType<typeof record>)=>{x.State.Dead=true;},
    (x:ReturnType<typeof record>)=>{x.State.OOMKilled=true;},
    (x:ReturnType<typeof record>)=>{x.State.StartedAt="unknown";},
  ]){const info=record();mutate(info);assert.throws(()=>requireDatabaseLossOwnership(info,expected,"running"));}
  for(const x of [null,undefined,{}])assert.throws(()=>requireDatabaseLossOwnership(x,expected,"running"));
  assert.throws(()=>requireDatabaseLossOwnership(record(),{...expected,id:"short"},"running"));
});
