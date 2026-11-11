const publicInventoryPath = "/public/inventory";

export function publicInventoryLink(username: string) {
  // Browsers normalize dot segments before sending a request.
  const segment =
    username === "." || username === ".." || username.startsWith("~")
      ? `~${username}`
      : username;
  return `${publicInventoryPath}/${encodeURIComponent(segment)}`;
}

export function publicInventoryUsername(segment: string) {
  return segment.startsWith("~") ? segment.slice(1) : segment;
}

export function publicInventoryOwnerLink(
  ownerPlayerId: string,
  searchParams: URLSearchParams,
) {
  const query = new URLSearchParams(searchParams);
  query.delete("ownerId");
  query.set("owner", ownerPlayerId);
  return `${publicInventoryPath}?${query}`;
}
