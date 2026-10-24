/** Retire idle native connections by age so a failed prepare cannot keep a
 * closed channel circulating forever. Checked-out queries/transactions finish
 * normally; explicit installation policy and the connection cap are preserved. */
export function withDatabaseConnectionLifetime(value: string | undefined) {
  if (!value) return value;
  const url=new URL(value);
  if (!["postgres:","postgresql:"].includes(url.protocol) || url.searchParams.has("max_connection_lifetime")) return value;
  url.searchParams.set("max_connection_lifetime","30");
  return url.toString();
}