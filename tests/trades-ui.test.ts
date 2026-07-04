import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tradesPage = readFileSync("app/trades/page.tsx", "utf8");
const tradeBuilder = readFileSync("components/TradeBuilder.tsx", "utf8");
const tradeActions = readFileSync("app/trades/actions.ts", "utf8");
const tradeCardPreview = readFileSync(
  "components/TradeCardPreview.tsx",
  "utf8",
);
const wishlistTable = readFileSync("components/WishlistTable.tsx", "utf8");

test("trades page renders the searchable trade builder instead of active inventory dropdowns", () => {
  assert.match(tradesPage, /<TradeBuilder/);
  assert.match(tradesPage, /proposerOwnerId=\{proposerId\}/);
  assert.match(tradesPage, /receiverPlayerId=\{receiverId\}/);
  assert.doesNotMatch(tradesPage, /offerItems\s*=/);
  assert.doesNotMatch(tradesPage, /offerItems=/);
  assert.doesNotMatch(tradesPage, /requestItems=/);
  assert.doesNotMatch(tradesPage, /\{false \? \(/);
});

test("trades page surfaces trade wishlist queues without preloading inventories", () => {
  assert.match(tradesPage, /Trade Wishlist/);
  assert.match(tradesPage, /wishlistView\?: string/);
  assert.match(tradesPage, /TradeWishlistDirection/);
  assert.match(tradesPage, /WishlistViewToggle/);
  assert.match(tradesPage, /Visual spoiler/);
  assert.match(tradesPage, /personHeader="Wanted by"/);
  assert.match(tradesPage, /cancelTradeWishlistItem/);
  assert.match(tradesPage, /myTradeWishlist/);
  assert.match(tradesPage, /wantedFromMe/);
  assert.match(tradesPage, /tradeWishlistItem\.findMany/);
  assert.match(tradesPage, /TradeWishlistStatus\.OPEN/);
  assert.match(tradesPage, /Public-inventory wants grouped by direction/);
  assert.match(tradesPage, /<CompactSection/);
  assert.match(tradesPage, /<TradeCardPreview/);
  assert.match(tradesPage, /Negotiate/);
  assert.match(
    tradesPage,
    /requestedInventoryItemId=\$\{item\.targetInventoryItemId\}/,
  );
  assert.match(
    tradesPage,
    /offeredInventoryItemId=\$\{item\.targetInventoryItemId\}/,
  );
  assert.match(tradesPage, /initialRequestedItem=/);
  assert.match(tradesPage, /initialOfferedItem=/);
  assert.doesNotMatch(tradesPage, /include:\s*\{\s*location:\s*true\s*\}/);
});

test("trade wishlist supports dense table, binder, and visual spoiler views", () => {
  assert.match(tradesPage, /<table className="min-w-full text-left text-sm">/);
  assert.match(tradesPage, /view === "binder"/);
  assert.match(tradesPage, /variant="spoiler"/);
  assert.match(tradesPage, /variant="text"/);
  assert.match(tradesPage, /ColorIdentityIcons/);
  assert.match(tradesPage, /playerColorStyle/);
  assert.match(tradeCardPreview, /variant\?: "row" \| "spoiler" \| "text"/);
  assert.match(tradeCardPreview, /aspect-\[63\/88\]/);
});

test("trade wishlist cards can be cancelled without deleting history", () => {
  assert.match(tradeActions, /export async function cancelTradeWishlistItem/);
  assert.match(tradeActions, /TradeWishlistStatus\.CANCELLED/);
  assert.match(
    tradeActions,
    /You can only cancel your own trade wishlist cards/,
  );
  assert.match(tradesPage, /name="tradeWishlistItemId"/);
  assert.match(tradesPage, />\s*Cancel\s*</);
  assert.match(wishlistTable, /cancelTradeWishlistItem/);
  assert.match(wishlistTable, /name="tradeWishlistItemId"/);
});

test("trade history is moved behind a history tab", () => {
  assert.match(tradesPage, /view\?: string/);
  assert.match(tradesPage, /params\.view === "history"/);
  assert.match(tradesPage, /href="\/trades\?view=history"/);
  assert.match(tradesPage, /tradeView === "active"/);
  assert.match(tradesPage, /historySections/);
});

test("trades page avoids mojibake separators in visible copy", () => {
  assert.doesNotMatch(tradesPage, /â|Â/);
  assert.match(tradesPage, /<->/);
  assert.match(tradesPage, /Accepting trade\.\.\./);
});

test("active trades are grouped into prioritized action queues", () => {
  assert.match(tradesPage, /Needs My Response/);
  assert.match(tradesPage, /Needs My Physical Confirmation/);
  assert.match(tradesPage, /Waiting On Partner/);
  assert.match(tradesPage, /prioritizedActiveTradeIds/);
  assert.match(tradesPage, /Counter From This/);
  assert.match(tradesPage, /Use As Template/);
});

test("physical trade confirmation captures incoming destination locations", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /proposerDestinationLocationId/);
  assert.match(schema, /receiverDestinationLocationId/);
  assert.match(tradesPage, /myDestinationLocations/);
  assert.match(tradesPage, /name="destinationLocationId"/);
  assert.match(tradesPage, /Move incoming \{incomingCard\.name\} to/);
  assert.match(tradeActions, /assertTradeDestinationLocation/);
  assert.match(tradeActions, /data\.proposerDestinationLocationId/);
  assert.match(tradeActions, /data\.receiverDestinationLocationId/);
  assert.match(tradeActions, /trade\.receiverDestinationLocationId/);
  assert.match(tradeActions, /trade\.proposerDestinationLocationId/);
});

test("trade builder keeps existing 1-for-1 server action fields", () => {
  assert.match(tradeBuilder, /"use client"/);
  assert.match(tradeBuilder, /\/api\/trades\/inventory-search/);
  assert.match(tradeBuilder, /Search cards/);
  assert.match(tradeBuilder, /name="offeredInventoryItemId"/);
  assert.match(tradeBuilder, /name="requestedInventoryItemId"/);
  assert.match(tradeBuilder, /name="receiverPlayerId"/);
  assert.match(tradeBuilder, /initialOfferedItem/);
  assert.match(tradeBuilder, /initialRequestedItem/);
  assert.match(tradeBuilder, /Proposal draft/);
  assert.match(tradeBuilder, /locationName/);
  assert.match(tradeBuilder, /priceLabel/);
});

test("trade inventory search API only fetches matching tradeable rows", () => {
  const route = readFileSync(
    "app/api/trades/inventory-search/route.ts",
    "utf8",
  );
  assert.match(route, /query\.length < 2/);
  assert.match(route, /take: 24/);
  assert.match(route, /InventoryLocationKind\.NORMAL/);
  assert.match(route, /activeTradeStatuses/);
  assert.match(route, /available: Math\.max/);
  assert.match(route, /locationName/);
  assert.match(route, /priceLabel/);
});
