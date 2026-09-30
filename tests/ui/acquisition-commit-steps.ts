import { expect, type Page } from "@playwright/test";
/** Real recognition/review path in the fixture: one physical photo commits,
 * the other ten remain pending. Simulate loss of the successful response. */
export async function checkAcquisitionCommit(page: Page) {
  const card = page.getByTestId("capture-card-2");
  await card.scrollIntoViewIfNeeded();
  const dialog = card;
  await dialog.getByRole("radio", { name: /Krosan Vorine.*LGN #131/ }).check();
  await dialog
    .getByRole("combobox", { name: "Card condition", exact: true })
    .selectOption("LP");
  await dialog.getByRole("button", { name: "Save card review" }).click();
  await page
    .getByRole("checkbox", { name: "Select card 2 for Inventory", exact: true })
    .check();
  await page.getByRole("button", { name: "Stop capture", exact: true }).click();
  await page.getByRole("link", { name: "Go to Inventory confirmation" }).click();
  const panel = page.getByRole("region", {
    name: "Add reviewed cards to Inventory",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Preview selected cards", exact: true })
    .click();
  const confirm = panel.getByLabel("Confirm Inventory addition", {
    exact: true,
  });
  await expect(confirm).toContainText("Add 1 copy");
  await expect(confirm).toContainText("no capacity set");
  for (const width of [1366, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await confirm.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await confirm.screenshot({
    path: "test-results/acquisition-commit-phone.png",
  });
  let dropped = false,
    receipt: any = null;
  await page.route("**/api/acquisition/*/commit", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "commit" && !dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      receipt = await response.json();
      await route.abort("failed");
    } else await route.continue();
  });
  await confirm
    .getByRole("button", { name: "Add 1 copy to Inventory", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel
    .getByRole("button", { name: "Retry Inventory addition", exact: true })
    .click();
  await expect(panel).toContainText("Added 1 copy to Inventory.");
  await expect(card).toContainText("Added to Inventory");
  await expect(
    card.getByRole("button", { name: "Retake", exact: true }),
  ).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "Save card review", exact: true }),
  ).toHaveCount(0);
  const sessionId = new URL(page.url()).searchParams.get("batch")!;
  const state = await (
    await page.request.get(`/api/acquisition/${sessionId}`)
  ).json();
  expect(state.slots.filter((s: any) => s.committed)).toHaveLength(1);
  expect(state.slots.filter((s: any) => !s.committed)).toHaveLength(10);
  await page.reload();
  await expect(page.getByTestId("capture-card-2")).toContainText(
    "Added to Inventory",
  );
  await expect(panel).toContainText("1 already added");
  return receipt;
}
