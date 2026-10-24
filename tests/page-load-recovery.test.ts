import assert from "node:assert/strict";
import test from "node:test";
import {navigatePageRecovery} from "../lib/page-load-recovery";

test("recovery opens the same absolute origin/path/query without a history reload",()=>{
  const calls:unknown[]=[],state={retained:"router state"};
  navigatePageRecovery({href:"https://cards.example//foreign.example/batch?batch=one%20two&x=1",
    replace:url=>calls.push(["navigate",url])},{state,replaceState:()=>assert.fail("No fragment to remove")});
  assert.deepEqual(calls,[["navigate","https://cards.example//foreign.example/batch?batch=one%20two&x=1"]]);
});
test("fragment removal preserves history state before the full GET navigation",()=>{
  for(const fragment of ["#capture-card-2","#"]){
    const calls:unknown[]=[],state={retained:"router state"};
    navigatePageRecovery({href:"https://cards.example/imports/scan?batch=one"+fragment,
      replace:url=>calls.push(["navigate",url])},{state,replaceState:(value,title,url)=>calls.push(["history",value,title,url])});
    assert.deepEqual(calls,[["history",state,"","https://cards.example/imports/scan?batch=one"],
      ["navigate","https://cards.example/imports/scan?batch=one"]]);
  }
});