/** Retire idle native connections by age so a failed prepare cannot keep a
 * closed channel circulating forever. Checked-out queries/transactions finish
 * normally; explicit installation policy and the connection cap are preserved. */
export function withDatabaseConnectionLifetime(value: string | undefined) {
  if (!value) return value;
  const url=new URL(value);
  if (!["postgres:","postgresql:"].includes(url.protocol) || url.searchParams.has("max_connection_lifetime")) return value;
  const fragment=value.indexOf("#");
  const prefix=fragment<0?value:value.slice(0,fragment);
  const suffix=fragment<0?"":value.slice(fragment);
  const separator=prefix.includes("?")?(prefix.endsWith("?")||prefix.endsWith("&")?"":"&"):"?";
  return prefix+separator+"max_connection_lifetime=30"+suffix;
}