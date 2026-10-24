import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {loadLegacyFixtureCleanups} from "./legacy-fixture-cleanup-sources";

const owner="ui-acquisition-44444444-4444-4444-8444-444444444444";
const ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"];
const sources=loadLegacyFixtureCleanups();
assert.equal(sources.length,25);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

function fixture(source: typeof sources[number], options: {ids?:string[];root?:string;errors?:Map<string,unknown>;selectionError?:Error}={}) {
  const root=options.root??path.resolve("synthetic-owned-uploads"),attempts:string[]=[],deletes:string[]=[],events:string[]=[];
  const rows=options.ids??ids;
  const p=new Proxy({},{get(_target,model:string){return {
    findMany:async()=>{
      if(["acquisitionPhoto","scannerRun"].includes(model)){if(options.selectionError)throw options.selectionError;return rows.map(id=>({id}));}
      return model==="acquisitionSession"?[{id:"session"}]:model==="acquisitionRun"?[{id:"run"}]:[];
    },
    count:async()=>0,
    updateMany:async()=>({count:0}),
    deleteMany:async()=>{deletes.push(model);events.push("delete:"+model);return {count:0};},
  };}});
  const modules=(name:string)=>{
    if(name==="path")return path;
    if(name==="crypto")return {createHash};
    assert.equal(name,"fs/promises");
    return {rm:async()=>{},access:async()=>{throw Object.assign(Error("gone"),{code:"ENOENT"});},unlink:async(file:string)=>{const relative=path.relative(root,file);attempts.push(relative);events.push("file:"+relative);if(options.errors?.has(relative))throw options.errors.get(relative);}};
  };
  const script=source.script(owner,source.kind==="scanner"?rows:[]);
  return {attempts,deletes,events,run:()=>new AsyncFunction("p","require","process","console",script)(p,modules,{env:{UPLOADS_DATA_PATH:root}},{log:()=>{}})};
}

const verifier=ts.createSourceFile("verifier",readFileSync("scripts/verify-legacy-fixture-files.ts","utf8"),ts.ScriptTarget.Latest,true);
const retryNode=verifier.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="retryVerifiedLegacyFixtureCleanup");
assert.ok(retryNode);
const retryCode=ts.transpileModule(retryNode.getText(verifier).replace(/^export\s+/,""),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const retry=new Function("assert",retryCode+";return retryVerifiedLegacyFixtureCleanup;")(assert) as (restored:boolean,pending:boolean,cleanup:()=>Promise<void>)=>Promise<void>;
test("real verifier withholds retry and replay until restoration is verified",async()=>{
  for(const [restored,pending]of [[false,false],[false,true],[true,true]]){
    let calls=0;await assert.rejects(retry(restored,pending,async()=>{calls++}));assert.equal(calls,0);
  }
});
test("real verifier permits cleanup and replay only after verified restoration",async()=>{
  let calls=0;await retry(true,false,async()=>{calls++});assert.equal(calls,2);
});
test("real verifier preserves the first retry failure without replaying it",async()=>{
  const error=Error("retry failed");let calls=0;
  await assert.rejects(retry(true,false,async()=>{calls++;throw error;}),(actual:unknown)=>actual===error);assert.equal(calls,1);
});

for(const source of sources){
  const label=`${path.basename(source.file)}:${source.index}`;
  const directory=source.kind==="photo"?"acquisition-v1":"scanner-control-v1";
  const paths=ids.flatMap(id=>source.suffixes.map(suffix=>path.join(directory,id+suffix)));
  test(label+" attempts all independent paths and retains recovery rows",async()=>{
    const first=Error("first unlink"),f=fixture(source,{errors:new Map([[paths[0],first]])});
    await assert.rejects(f.run(),(error:unknown)=>error instanceof AggregateError&&assert.deepEqual(error.errors,[first])===undefined);
    assert.deepEqual(f.attempts,paths);assert.deepEqual(f.deletes,[]);
  });
  test(label+" preserves multiple and falsy causes in stable order",async()=>{
    for(const first of [Error("first"),undefined,null,false,0,""]){
      const last=Error("last"),f=fixture(source,{errors:new Map<string,unknown>([[paths[0],first],[paths.at(-1)!,last]])});
      await assert.rejects(f.run(),(error:unknown)=>error instanceof AggregateError&&assert.deepEqual(error.errors,[first,last])===undefined);
      assert.deepEqual(f.attempts,paths);assert.deepEqual(f.deletes,[]);
    }
  });
  test(label+" normal and missing-file cleanup precede relational deletion",async()=>{
    for(const missing of [false,true]){
      const errors=missing?new Map(paths.map(file=>[file,Object.assign(Error("gone"),{code:"ENOENT"})])):undefined;
      const f=fixture(source,{errors,ids:[...ids].reverse()});await f.run();
      assert.deepEqual(f.attempts,paths);assert.equal(f.events.findIndex(event=>event.startsWith("delete:")),paths.length);assert.ok(f.deletes.includes("acquisitionPhoto"));assert.ok(f.deletes.includes("player"));
    }
  });
  test(label+" validates later identity and root before any file or row deletion",async()=>{
    for(const options of [{ids:[ids[0],"../peer"]},{root:""},{root:"relative"}]){
      const f=fixture(source,options);await assert.rejects(f.run(),/fixture|storage/i);assert.deepEqual(f.attempts,[]);assert.deepEqual(f.deletes,[]);
    }
  });
  test(label+" failed reference selection causes no partial file/deletion",async()=>{
    const error=Error("selection failed"),f=fixture(source,{selectionError:error});
    await assert.rejects(f.run(),(actual:unknown)=>actual===error);assert.deepEqual(f.attempts,[]);assert.deepEqual(f.deletes,[]);
  });
}
