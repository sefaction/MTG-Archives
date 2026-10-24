import test from "node:test";
import assert from "node:assert/strict";
import {requireServerLossOwnership,SERVER_LOSS_UPLOADS_ROOT,type ServerLossIdentity} from "./ui/acquisition-server-loss-ownership";
const expected:ServerLossIdentity={id:"a".repeat(64),image:"sha256:"+"b".repeat(64),run:"acquisition-server-loss-310-unit",nonce:"c".repeat(32),anchor:"d".repeat(64),uploads:"mtg-server-loss-uploads-"+"c".repeat(12),database:"review_server_loss_unit"};
function fixture(){return {Id:expected.id,Image:expected.image,Config:{Labels:{"mtg.run":expected.run,"mtg.server-loss.nonce":expected.nonce,"mtg.fixture.role":"server-loss-web"},Env:["DATABASE_URL=postgresql://fixture@server-loss-pg/"+expected.database]},HostConfig:{NetworkMode:"container:"+expected.anchor,Privileged:false,PortBindings:{},RestartPolicy:{Name:"no"}},Mounts:[{Type:"volume",Name:expected.uploads,Destination:SERVER_LOSS_UPLOADS_ROOT,RW:true}],State:{Running:true,Paused:false,Restarting:false,Dead:false,OOMKilled:false,Status:"running",Pid:42,ExitCode:0,StartedAt:"2026-10-24T00:00:00Z",FinishedAt:"0001-01-01T00:00:00Z"}};}
test("only the exact isolated web and declared namespace/storage can be interrupted",()=>{
  const value=fixture();assert.equal(requireServerLossOwnership(value,expected,"running"),value);
  (value.HostConfig as any).PortBindings=null;assert.equal(requireServerLossOwnership(value,expected,"running"),value);
  Object.assign(value.State,{Running:false,Status:"exited",Pid:0,ExitCode:137,FinishedAt:"2026-10-24T00:01:00Z"});
  assert.equal(requireServerLossOwnership(value,expected,"terminal"),value);
  assert.throws(()=>requireServerLossOwnership(value,expected,"running"));
});
test("foreign identities, published ports, restart policies and unexpected data are refused",()=>{
  const cases:((value:ReturnType<typeof fixture>)=>void)[]=[
    v=>{v.Id="e".repeat(64)},v=>{v.Image="sha256:"+"e".repeat(64)},v=>{v.Config.Labels["mtg.run"]="other"},
    v=>{v.Config.Labels["mtg.server-loss.nonce"]="e".repeat(32)},v=>{v.Config.Labels["mtg.fixture.role"]="postgres"},
    v=>{v.HostConfig.NetworkMode="bridge"},v=>{v.HostConfig.Privileged=true},v=>{v.HostConfig.PortBindings={"3000/tcp":[]} as any},
    v=>{v.HostConfig.RestartPolicy.Name="always"},v=>{v.Mounts[0].Type="bind"},v=>{v.Mounts[0].Name="shared"},
    v=>{v.Mounts[0].Destination="/app/uploads"},v=>{v.Mounts[0].RW=false},v=>{v.Mounts.push({...v.Mounts[0]})},
    v=>{v.Config.Env=["DATABASE_URL=postgresql://fixture@server-loss-pg/production"]},v=>{v.Config.Env.push(v.Config.Env[0])},v=>{v.Config.Env=["DATABASE_URL=postgresql://fixture@shared/"+expected.database]},
    v=>{(v.HostConfig as any).PortBindings=undefined},v=>{(v.HostConfig as any).PortBindings=[]},
  ];for(const mutate of cases){const value=fixture();mutate(value);assert.throws(()=>requireServerLossOwnership(value,expected,"running"));}
});
test("short targets, forged context and missing or ambiguous process state never authorize interruption",()=>{
  for(const key of ["id","image","run","nonce","anchor","uploads","database"] as const){assert.throws(()=>requireServerLossOwnership(fixture(),{...expected,[key]:"invalid"},"running"));}
  for(const state of [null,{}, {Running:true}, {...fixture().State,OOMKilled:true},{...fixture().State,Paused:true},
    {...fixture().State,Restarting:true},{...fixture().State,Dead:true},{...fixture().State,Running:"true"},
    {...fixture().State,StartedAt:"unknown"},{...fixture().State,Pid:0},{...fixture().State,ExitCode:null}]){
    const value=fixture();(value as any).State=state;assert.throws(()=>requireServerLossOwnership(value,expected,"running"));
  }
});