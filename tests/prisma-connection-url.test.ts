import test from "node:test";
import assert from "node:assert/strict";
import {withDatabaseConnectionLifetime} from "../lib/prisma-connection-url";

test("the native default bounds idle connection age while preserving endpoint and other policy",()=>{
  const before=new URL("postgresql://owner:p%40ss@database:5432/review?schema=public&connection_limit=5&pool_timeout=9&socket_timeout=45&options=-c%20application_name%3Dreview");
  const after=new URL(withDatabaseConnectionLifetime(before.href)!);
  assert.equal(after.searchParams.get("max_connection_lifetime"),"30");
  after.searchParams.delete("max_connection_lifetime");
  assert.equal(after.href,before.href);
});

test("explicit installation lifetimes including disabled are byte-preserved",()=>{
  for(const age of ["0","15","90"]){const url=`postgres://u:p@db/review?max_connection_lifetime=${age}&connection_limit=3`;assert.equal(withDatabaseConnectionLifetime(url),url);}
  assert.equal(withDatabaseConnectionLifetime(undefined),undefined);
  assert.equal(withDatabaseConnectionLifetime("file:./review.db"),"file:./review.db");
});