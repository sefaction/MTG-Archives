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
const tradeValueSummary = readFileSync(
  "components/TradeValueSummary.tsx",
  "utf8",
);
const tradeValue = readFileSync("lib/trade-value.ts", "utf8");
const tradePairingCard = readFileSync(
  "components/TradePairingCard.tsx",
  "utf8",
);
const tradePairing = readFileSync("lib/trade-pairing.ts", "utf8");
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

test("trade desk groups wishlist queues around the selected partner", () => {
  assert.match(tradesPage, /Trade Desk/);
  assert.match(tradesPage, /TradeDeskLane/);
  assert.match(tradesPage, /title="Cards I want"/);
  assert.match(tradesPage, /title="Wanted from me"/);
  assert.match(tradesPage, /partnerWants/);
  assert.match(tradesPage, /row\.personId === receiverId/);
  assert.match(tradesPage, /xl:grid-cols-/);
  assert.match(tradesPage, /xl:sticky/);
  assert.match(tradesPage, /cancelTradeWishlistItem/);
  assert.match(tradesPage, /myTradeWishlist/);
  assert.match(tradesPage, /wantedFromMe/);
  assert.match(tradesPage, /tradeWishlistItem\.findMany/);
  assert.match(tradesPage, /TradeWishlistStatus\.OPEN/);
  assert.match(tradesPage, /<TradeCardPreview/);
  assert.match(tradesPage, /actionLabel="Request"/);
  assert.match(tradesPage, /actionLabel="Offer"/);
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

test("trade desk uses compact scrollable card lanes", () => {
  assert.match(tradesPage, /max-h-\[42rem\]/);
  assert.match(tradesPage, /overflow-y-auto/);
  assert.match(tradesPage, /playerColorStyle/);
  assert.match(tradesPage, /card\.priceLabel/);
  assert.match(tradeCardPreview, /compact/);
});

test("wishlist cards can be clicked, dragged into slots, or paired together", () => {
  assert.match(tradesPage, /Pairing board:/);
  assert.match(tradesPage, /<TradePairingCard/);
  assert.match(tradesPage, /pairingSide="requested"/);
  assert.match(tradesPage, /pairingSide="offered"/);
  assert.match(tradesPage, /pairingItem:/);
  assert.match(tradeBuilder, /TRADE_PAIRING_ADD_EVENT/);
  assert.match(tradeBuilder, /Drop cards here/);
  assert.match(tradeBuilder, /onDrop=/);
  assert.match(tradePairingCard, /draggable=\{Boolean\(payload\)\}/);
  assert.match(tradePairingCard, /Drop to pair both cards/);
  assert.match(tradePairingCard, /addItem\(incoming\)/);
  assert.match(tradePairingCard, /addItem\(payload\)/);
  assert.match(tradePairing, /application\/x-mtg-trade-card/);
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

test("trade desk, active trades, and history have separate tabs", () => {
  assert.match(tradesPage, /view\?: string/);
  assert.match(tradesPage, /TradePageView/);
  assert.match(tradesPage, /label: "Trade Desk"/);
  assert.match(tradesPage, /label: "Trade Wishlist"/);
  assert.match(tradesPage, /\/trades\?view=wishlist/);
  assert.match(tradesPage, /label: "Active Trades"/);
  assert.match(tradesPage, /\/trades\?view=active/);
  assert.match(tradesPage, /\/trades\?view=history/);
  assert.match(tradesPage, /tradeView === "desk"/);
  assert.match(tradesPage, /historySections/);
});

test("global trade wishlist groups every open want by person", () => {
  assert.match(tradesPage, /TradeWishlistOverviewColumn/);
  assert.match(tradesPage, /groupTradeWishlistRows/);
  assert.match(tradesPage, /tradeView === "wishlist"/);
  assert.match(tradesPage, /rows=\{myTradeWishlistRows\}/);
  assert.match(tradesPage, /rows=\{wantedFromMeRows\}/);
  assert.match(tradesPage, /Open Trade Desk/);
  assert.match(tradesPage, /Every open person-to-person want/);
});

test("trade rows stay collapsed behind viewer-oriented compact summaries", () => {
  assert.match(tradesPage, /const displayLeftCards = userIsReceiver/);
  assert.match(tradesPage, /const displayRightCards = userIsReceiver/);
  assert.match(tradesPage, /const displayLeftPlayer = userIsReceiver/);
  assert.match(tradesPage, /tradeSideLabel\(displayLeftCards\)/);
  assert.match(tradesPage, /tradeSideLabel\(displayRightCards\)/);
  assert.match(tradesPage, /displayLeftCards\.map/);
  assert.match(tradesPage, /displayRightCards\.map/);
  assert.match(tradesPage, /leftLines=\{displayLeftCards\}/);
  assert.match(tradesPage, /rightLines=\{displayRightCards\}/);
  assert.match(tradesPage, /group-open:hidden/);
  assert.match(tradesPage, /statusLabel\(trade\.status\)\.replaceAll/);
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

test("counter proposals explicitly replace their source trade", () => {
  assert.match(tradesPage, /counterTradeId=\$\{trade\.id\}/);
  assert.match(tradeBuilder, /name="counterTradeId"/);
  assert.match(tradeBuilder, /decline and replace/);
  assert.match(tradeActions, /ignoredReservationTradeId/);
  assert.match(tradeActions, /id: \{ not: ignoredReservationTradeId \}/);
  assert.match(tradeActions, /assertCanCounterTrade/);
  assert.match(tradeActions, /status: TradeStatus\.DECLINED/);
  assert.match(tradeActions, /eventType: "countered"/);
  assert.match(tradeActions, /replaced\.count !== 1/);
});

test("physical trade confirmation captures incoming destination locations", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /proposerDestinationLocationId/);
  assert.match(schema, /receiverDestinationLocationId/);
  assert.match(tradesPage, /myDestinationLocations/);
  assert.match(tradesPage, /name="destinationLocationId"/);
  assert.match(tradesPage, /Move \{incomingCards\.length\} incoming card/);
  assert.match(tradeActions, /assertTradeDestinationLocation/);
  assert.match(tradeActions, /data\.proposerDestinationLocationId/);
  assert.match(tradeActions, /data\.receiverDestinationLocationId/);
  assert.match(tradeActions, /trade\.receiverDestinationLocationId/);
  assert.match(tradeActions, /trade\.proposerDestinationLocationId/);
});

test("trade builder supports multiple quantity-aware card lines", () => {
  assert.match(tradeBuilder, /"use client"/);
  assert.match(tradeBuilder, /\/api\/trades\/inventory-search/);
  assert.match(tradeBuilder, /Search cards/);
  assert.match(tradeBuilder, /name="offeredLinesJson"/);
  assert.match(tradeBuilder, /name="requestedLinesJson"/);
  assert.match(tradeBuilder, /TradeDraftLine/);
  assert.match(tradeBuilder, /onQuantityChange/);
  assert.match(tradeBuilder, /name="receiverPlayerId"/);
  assert.match(tradeBuilder, /initialOfferedItem/);
  assert.match(tradeBuilder, /initialRequestedItem/);
  assert.match(tradeBuilder, /Proposal draft/);
  assert.match(tradeBuilder, /<details className="group/);
  assert.match(tradeBuilder, /Add message or notes/);
  assert.match(tradeBuilder, /Build a multi-card exchange/);
  assert.match(tradeBuilder, /locationName/);
  assert.match(tradeBuilder, /priceLabel/);
});

test("expected proposal conflicts render inline without hiding unexpected failures", () => {
  assert.match(tradeBuilder, /useActionState/);
  assert.match(tradeBuilder, /action=\{submitProposal\}/);
  assert.match(
    tradeBuilder,
    /role=\{proposalState\.status === "error" \? "alert" : "status"\}/,
  );
  assert.match(tradeBuilder, /\{proposalState\.message\}/);
  assert.match(
    tradeActions,
    /One or more selected quantities are already reserved or unavailable\./,
  );
  assert.match(tradeActions, /tradeProposalValidationState\(error\)/);
  assert.match(tradeActions, /throw error/);
});

test("trade builder and active trades compare quantity-aware values", () => {
  assert.match(tradeBuilder, /<TradeValueSummary/);
  assert.match(tradeBuilder, /priceAmount: item\.priceAmount/);
  assert.match(tradesPage, /<TradeValueSummary/);
  assert.match(tradesPage, /preferredPriceProvider/);
  assert.match(tradeValueSummary, /Known-value gap/);
  assert.match(tradeValueSummary, /Estimate incomplete/);
  assert.match(tradeValue, /selectPreferredCardPrice/);
  assert.match(tradeValue, /line\.priceAmount \* quantity/);
  assert.match(tradeActions, /priceAmount: price\.amount/);
  assert.match(tradeActions, /actor\.preferredPriceProvider/);
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
  assert.match(route, /tradeLine\.findMany/);
  assert.match(route, /buildReservedInventoryQuantities/);
  assert.match(route, /lines: \{ none: \{\} \}/);
  assert.match(route, /available: Math\.max/);
  assert.match(route, /locationName/);
  assert.match(route, /priceLabel/);
  assert.match(route, /priceAmount/);
  assert.match(route, /selectTradeCardPrice/);
});
