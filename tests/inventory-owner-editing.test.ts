import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const inventoryBrowser = fs.readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);
const inventoryPage = fs.readFileSync("app/inventory/page.tsx", "utf8");
const inventoryActions = fs.readFileSync("app/inventory/actions.ts", "utf8");

test("owner-editable inventory browser restores normal user edit controls", () => {
  assert.match(
    inventoryBrowser,
    /uiMode = isAdmin \? "admin-editable" : "owner-editable"/,
  );
  assert.match(
    inventoryBrowser,
    /function defaultCapabilities\(uiMode: InventoryUiMode\)/,
  );
  assert.match(
    inventoryBrowser,
    /const isAdminEditable = uiMode === "admin-editable"/,
  );
  assert.match(inventoryBrowser, /canEdit: true/);
  assert.match(inventoryBrowser, /canViewOwnerAdminFields: isAdminEditable/);
  assert.match(inventoryBrowser, /editing && capabilities\.canEdit/);
});

test("normal edit form hides admin-only owner and source controls", () => {
  assert.match(
    inventoryBrowser,
    /!capabilities\.canViewOwnerAdminFields \? \(/,
  );
  assert.match(inventoryBrowser, /name="currentOwnerId"/);
  assert.match(inventoryBrowser, /Admin correction reason/);
  assert.match(inventoryBrowser, /capabilities\.canViewOwnerAdminFields \? \(/);
  assert.match(inventoryBrowser, /name="language"/);
});

test("owners can correct printing and foil status on their own stacks", () => {
  assert.match(
    inventoryBrowser,
    /capabilities\.canEdit \? \([\s\S]*Current printing:[\s\S]*correct this printing or set/,
  );
  assert.match(inventoryBrowser, /name="newScryfallId"/);
  assert.match(inventoryBrowser, /name="foilStatus"/);
  assert.match(inventoryPage, /async function onSearchPrintings[\s\S]*requireLogin/);
  assert.doesNotMatch(
    inventoryPage,
    /async function onSearchPrintings[\s\S]{0,120}requireAdminMode/,
  );
});

test("inventory edit action authorizes normal users by item ownership server-side", () => {
  assert.match(inventoryPage, /const actionUser = await requireLogin\(\)/);
  assert.match(
    inventoryPage,
    /const actionIsAdmin = actionScope\?\.mode === "admin"/,
  );
  assert.match(
    inventoryPage,
    /before\.currentOwnerId !== actionUser\.playerId/,
  );
  assert.match(inventoryPage, /You can only edit inventory you own/);
  assert.match(
    inventoryPage,
    /submittedOwnerId[\s\S]*submittedOwnerId !== currentOwnerId/,
  );
  assert.match(inventoryPage, /Stack edits cannot change inventory owner/);
});

test("normal edit action delegates stack-safe fields to the inventory stack helper", () => {
  assert.match(inventoryPage, /language: String\(fd\.get\("language"\)/);
  assert.match(
    inventoryPage,
    /sourceType: actionIsAdmin[\s\S]*: before\.sourceType/,
  );
  assert.equal(
    (
      inventoryPage.match(
        /const newScryfallId = String\(fd\.get\("newScryfallId"\) \|\| ""\)/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(inventoryPage, /Invalid foil status/);
  assert.match(inventoryPage, /updateInventoryStack\(prisma/);
  assert.match(inventoryPage, /splitInventoryStack\(prisma/);
});

test("individual delete keeps owner authorization instead of admin-only access", () => {
  assert.match(inventoryActions, /const actionUser = await requireLogin\(\)/);
  assert.match(
    inventoryActions,
    /item\.currentOwnerId !== actionUser\.playerId/,
  );
  assert.match(inventoryActions, /You can only delete inventory you own/);
  assert.match(inventoryActions, /"user_delete_inventory"/);
  assert.match(inventoryActions, /"admin_delete_inventory"/);
});
