import test from "node:test";
import assert from "node:assert/strict";
import {withDatabaseConnectionLifetime} from "../lib/prisma-connection-url";

test("the native default bounds idle connection age while preserving endpoint and other policy",()=>{
  const before=new URL("postgresql://owner:p%40ss@database:5432/review?schema=public&connection_limit=5&pool_timeout=9&socket_timeout=45&options=-c%20application_name%3Dreview");
  const transformed=withDatabaseConnectionLifetime(before.href)!;
  assert.equal(transformed,before.href+"&max_connection_lifetime=30");
  const after=new URL(transformed);
  assert.equal(after.searchParams.get("max_connection_lifetime"),"30");
  after.searchParams.delete("max_connection_lifetime");
  assert.deepEqual([...after.searchParams],[...before.searchParams]);
  for(const key of ["protocol","username","password","host","pathname","hash"] as const)assert.equal(after[key],before[key]);
});

test("explicit installation lifetimes including disabled are byte-preserved",()=>{
  for(const age of ["0","15","90"]){const url=`postgres://u:p@db/review?max_connection_lifetime=${age}&connection_limit=3`;assert.equal(withDatabaseConnectionLifetime(url),url);}
  assert.equal(withDatabaseConnectionLifetime(undefined),undefined);
  assert.equal(withDatabaseConnectionLifetime("file:./review.db"),"file:./review.db");
});