import assert from "node:assert/strict";
import test from "node:test";
import { assertIsolatedDrillDatabase } from "../lib/backup-drill";

const target =
  "postgresql://drill@restore-db:5432/mtg_restore_drill?schema=public";

test("recovery drill accepts only its fixed disposable database and explicit isolated flag", () => {
  assert.doesNotThrow(() => assertIsolatedDrillDatabase(target, "1"));
  for (const flag of [undefined, "", "true", "0"]) {
    assert.throws(() => assertIsolatedDrillDatabase(target, flag), /Refusing/);
  }
});

test("recovery drill rejects live host, database, role, port and schema targets", () => {
  for (const url of [
    target.replace("restore-db", "postgres"),
    target.replace("restore-db", "localhost"),
    target.replace("mtg_restore_drill", "mtginventory"),
    target.replace("drill@", "postgres@"),
    target.replace(":5432", ":5433"),
    target.replace("schema=public", "schema=private"),
  ])
    assert.throws(() => assertIsolatedDrillDatabase(url, "1"), /Refusing/);
});
