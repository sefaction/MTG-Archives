import { parseDatabaseUrl } from "./backup";

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
