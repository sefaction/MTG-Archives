import assert from "node:assert/strict";
import test from "node:test";
import {requireBrowserLossOwnership} from "./ui/acquisition-browser-loss-ownership";
const expected={id:"1".repeat(64),web:"2".repeat(64),image:"sha256:"+"3".repeat(64),
  run:"acquisition-browser-loss-310-unit",nonce:"4".repeat(32)};
function record(){return {Id:expected.id,Image:expected.image,Mounts:[],
  Config:{Labels:{"mtg.run":expected.run,"mtg.browser-loss.nonce":expected.nonce,"mtg.fixture.role":"browser-loss-browser"}},
  HostConfig:{NetworkMode:`container:${expected.web}`},State:{Running:true,Paused:false,Restarting:false,Dead:false,OOMKilled:false,StartedAt:"2026-10-24T00:00:00Z",ExitCode:0}};}
test("interruption needs the exact isolated browser and current running state",()=>{
  const info=record();assert.equal(requireBrowserLossOwnership(info,expected,"running"),info);
  assert.throws(()=>requireBrowserLossOwnership(info,expected,"terminal"));
  info.State.Running=false;assert.equal(requireBrowserLossOwnership(info,expected,"terminal"),info);
  assert.throws(()=>requireBrowserLossOwnership(info,expected,"running"));
});
test("foreign identities, mounts and uncertain states cannot authorize a kill or cleanup",()=>{
  for(const mutate of [
    (x:ReturnType<typeof record>)=>{x.Id="5".repeat(64);},
    (x:ReturnType<typeof record>)=>{x.Image="sha256:"+"5".repeat(64);},
    (x:ReturnType<typeof record>)=>{x.Config.Labels["mtg.run"]="another-owner";},
    (x:ReturnType<typeof record>)=>{x.Config.Labels["mtg.browser-loss.nonce"]="5".repeat(32);},
    (x:ReturnType<typeof record>)=>{x.Config.Labels["mtg.fixture.role"]="web";},
    (x:ReturnType<typeof record>)=>{x.HostConfig.NetworkMode="host";},
    (x:ReturnType<typeof record>)=>{x.Mounts=[{}] as never[];},
    (x:ReturnType<typeof record>)=>{x.State.Paused=true;},
    (x:ReturnType<typeof record>)=>{x.State.Restarting=true;},
    (x:ReturnType<typeof record>)=>{x.State.Dead=true;},
    (x:ReturnType<typeof record>)=>{x.State.OOMKilled=true;},
  ]){const info=record();mutate(info);assert.throws(()=>requireBrowserLossOwnership(info,expected,"running"));}
  for(const value of [null,{},undefined])assert.throws(()=>requireBrowserLossOwnership(value,expected,"running"));
  assert.throws(()=>requireBrowserLossOwnership(record(),{...expected,id:"short-id"},"running"));
});
