const publicInventoryPath = "/public/inventory";

export function publicInventoryLink(username: string) {
  return publicMemberLink(publicInventoryPath, username);
}

export function publicWishlistLink(username: string) {
  return publicMemberLink("/public/wishlist", username);
}

function publicMemberLink(path: string, username: string) {
  // Browsers normalize dot segments before sending a request.
  const segment =
    username === "." || username === ".." || username.startsWith("~")
      ? `~${username}`
      : username;
  return `${path}/${encodeURIComponent(segment)}`;
}

export function publicInventoryUsername(segment: string) {
  return segment.startsWith("~") ? segment.slice(1) : segment;
}

export function publicWishlistPageUsername(segment: string) {
  // The installed App Router passes encoded page params to user code. Decode
  // exactly once here; route handlers already receive decoded params.
  return publicInventoryUsername(decodeURIComponent(segment));
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
