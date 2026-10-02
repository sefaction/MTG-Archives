import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIsolatedDrillDatabase,
  isolatedDrillArchivePath,
} from "../lib/backup-drill";
import { join } from "node:path";

const target =
  "postgresql://drill@restore-db:5432/mtg_restore_drill?schema=public";

const archiveName = "mtg-archives-backup-20261002-182614.tar.gz";
test("drill locates the current application namespace and legacy root capture", () => {
  for (const path of [
    join("/input", "application", archiveName),
    join("/input", archiveName),
  ])
    assert.equal(
      isolatedDrillArchivePath(
        `/private/source/application/${archiveName}`,
        "/input",
        (candidate) => candidate === path,
      ),
      path,
    );
});
test("drill rejects missing or ambiguous archives before restore", () => {
  for (const exists of [() => false, () => true])
    assert.throws(
      () => isolatedDrillArchivePath(archiveName, "/input", exists),
      /exactly one/,
    );
});
test("drill archive selection rejects unrelated filenames", () => {
  for (const name of [
    "evidence.json",
    "database.dump",
    "backup.tar.gz",
    "../application.tar.gz",
  ])
    assert.throws(
      () => isolatedDrillArchivePath(name, "/input", () => true),
      /Invalid captured/,
    );
});

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
