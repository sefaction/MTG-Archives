import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanPricingView,
  pricingWorkspaceHref,
  usdCopyValue,
  collectionValueLabel,
} from "../lib/pricing-workspace";

test("current USD estimates distinguish genuine zero, absent and other-currency prices", () => {
  assert.deepEqual(usdCopyValue({ amount: 2, currency: "USD" }, 3), {
    value: 6,
    missing: 0,
  });
  assert.deepEqual(usdCopyValue({ amount: 0, currency: "USD" }, 3), {
    value: 0,
    missing: 0,
  });
  assert.deepEqual(usdCopyValue({ amount: 2, currency: "EUR" }, 3), {
    value: 0,
    missing: 3,
  });
  assert.deepEqual(usdCopyValue(null, 3), { value: 0, missing: 3 });
  assert.equal(collectionValueLabel(0, 3, 3), "Unavailable");
  assert.equal(collectionValueLabel(0, 3, 0), "$0.00");
  assert.equal(collectionValueLabel(0, 0, 0), "$0.00");
  assert.equal(collectionValueLabel(6, 5, 2), "$6.00");
});
test("pricing task links retain historical context without losing explicit market/data deep links", () => {
  assert.equal(cleanPricingView(undefined), "collection");
  assert.equal(cleanPricingView("market"), "market");
  assert.equal(cleanPricingView("data"), "data");
  assert.equal(cleanPricingView("bad"), "collection");
  const url = new URL(
    pricingWorkspaceHref(
      {
        provider: "cardmarket",
        currency: "EUR",
        finish: "foil",
        range: "30",
        view: "data",
      },
      "market",
    ),
    "https://example.invalid",
  );
  assert.equal(url.searchParams.get("view"), "market");
  assert.equal(url.searchParams.get("currency"), "EUR");
  assert.equal(url.searchParams.get("provider"), "cardmarket");
  assert.equal(url.searchParams.get("finish"), "foil");
  assert.equal(pricingWorkspaceHref({}, "collection"), "/pricing");
});
