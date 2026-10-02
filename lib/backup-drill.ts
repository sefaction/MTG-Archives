import { parseDatabaseUrl } from "./backup";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

/** Current backups use application/; older qualified captures used the root. */
export function isolatedDrillArchivePath(
  sourcePath: string,
  root = "/input",
  exists = existsSync,
) {
  const name = basename(sourcePath);
  if (!/^mtg-archives-backup-\d{8}-\d{6}\.tar\.gz$/.test(name))
    throw new Error("Invalid captured application archive name");
  const candidates = [join(root, "application", name), join(root, name)].filter(
    exists,
  );
  if (candidates.length !== 1)
    throw new Error("Expected exactly one captured application archive");
  return candidates[0];
}

/** Deliberately fixed disposable endpoint, not an operator-configurable restore target. */
export function assertIsolatedDrillDatabase(
  databaseUrl: string,
  isolated: string | undefined,
) {
  const connection = parseDatabaseUrl(databaseUrl);
  if (
    isolated !== "1" ||
    connection.host !== "restore-db" ||
    connection.database !== "mtg_restore_drill" ||
    connection.user !== "drill" ||
    connection.port !== 5432 ||
    (connection.schema && connection.schema !== "public")
  ) {
    throw new Error(
      "Refusing recovery drill outside the isolated disposable database",
    );
  }
}
