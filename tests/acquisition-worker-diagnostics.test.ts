import assert from "node:assert/strict";
import test from "node:test";
import {catalogWorkerFailure} from "../lib/acquisition-worker-diagnostics";

test("catalog stop diagnostics retain phase/public database code and omit private error material",()=>{
  const error={code:"P2025",message:"private query and token",stack:"private path",meta:{query:"secret"}};
  assert.deepEqual(catalogWorkerFailure("ADMISSION",error),{event:"catalog-worker-stopped",phase:"ADMISSION",errorCode:"P2025"});
  assert.equal(catalogWorkerFailure("PROCESSING",{errorCode:"P1001"}).errorCode,"P1001");
});
test("arbitrary diagnostic fields cannot become worker log payloads",()=>{
  for(const error of [null,undefined,"private message",{code:"P2025 secret"},{code:{secret:true}},{code:"P202500"}]){
    assert.deepEqual(catalogWorkerFailure("AUTO_CONFIRM",error),{event:"catalog-worker-stopped",phase:"AUTO_CONFIRM",errorCode:"UNKNOWN"});
  }
});
test("hostile exception accessors cannot suppress the safe stop record",()=>{
  const error=Object.defineProperty({},"code",{get(){throw Error("private accessor");}});
  assert.deepEqual(catalogWorkerFailure("ADMISSION",error),{event:"catalog-worker-stopped",phase:"ADMISSION",errorCode:"UNKNOWN"});
});
