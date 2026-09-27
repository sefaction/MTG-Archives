import { expect, type Page } from "@playwright/test";

/** Runs inside the owned real-photo intake fixture; never commits Inventory. */
export async function checkAcquisitionReview(page: Page) {
  await page
    .getByRole("combobox", { name: "Batch finish", exact: true })
    .selectOption("NONFOIL");
  await page
    .getByRole("combobox", { name: "Batch condition", exact: true })
    .selectOption("NM");
  await page.getByRole("button", { name: "Save batch defaults" }).click();
  await expect(page.getByText("Batch defaults saved.")).toBeVisible();
  const card = page.getByTestId("capture-card-2");
  const open = card.getByRole("button", { name: "Review card", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "Card condition", exact: true }),
  ).toHaveValue("NM");
  await expect(
    dialog.getByRole("button", { name: "Save card review" }),
  ).toBeDisabled();
  await dialog.getByRole("radio", { name: /Krosan Vorine · LGN #131/ }).check();
  await dialog
    .getByRole("combobox", { name: "Card condition", exact: true })
    .selectOption("LP");
  for (const width of [1366, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await dialog
    .getByRole("button", { name: "Save card review" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/acquisition-review-phone.png" });
  await dialog.getByRole("button", { name: "Save card review" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText("LP");
  await page.reload();
  await expect(card).toContainText("Krosan Vorine");
  await expect(page.getByText(/11 photos prepared/)).toBeVisible();
  await page
    .getByRole("combobox", { name: "Batch condition", exact: true })
    .selectOption("HP");
  await page.getByRole("button", { name: "Save batch defaults" }).click();
  await expect(page.getByText("Batch defaults saved.")).toBeVisible();
  const edit = card.getByRole("button", { name: "Edit review" });
  await edit.click();
  await expect(
    dialog.getByRole("combobox", { name: "Card condition", exact: true }),
  ).toHaveValue("LP");
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
  await edit.click();
  await dialog.getByText("Find another printing", { exact: true }).click();
  await dialog.getByLabel("Set code", { exact: true }).fill("lgn");
  await dialog.getByLabel("Collector number", { exact: true }).fill("0131");
  await dialog
    .getByRole("button", { name: "Find printing", exact: true })
    .click();
  await expect(
    dialog
      .locator("details")
      .getByRole("radio", { name: /Krosan Vorine · LGN #131/ }),
  ).toBeVisible();

  // A second tab changes the saved decision while this dialog is open.
  const sessionId = new URL(page.url()).searchParams.get("batch")!;
  const endpoint = `/api/acquisition/${sessionId}/review`;
  const progress = await (
    await page.request.get(`/api/acquisition/${sessionId}`)
  ).json();
  const photoId = progress.slots[1].photos[0].id;
  const record = await (
    await page.request.get(`${endpoint}?photoId=${photoId}`)
  ).json();
  const result = await page.request.post(endpoint, {
    headers: { origin: "http://127.0.0.1:13001" },
    data: {
      action: "accept",
      photoId,
      revision: record.revision,
      decision: {
        cardId: record.printing.id,
        language: "en",
        finish: "NONFOIL",
        condition: "MP",
      },
    },
  });
  expect(result.ok()).toBe(true);
  await dialog
    .getByRole("combobox", { name: "Card condition", exact: true })
    .selectOption("NM");
  await dialog.getByRole("button", { name: "Save card review" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Capture card changed");
  await dialog.getByRole("button", { name: "Reload review" }).click();
  await expect(
    dialog.getByRole("combobox", { name: "Card condition", exact: true }),
  ).toHaveValue("MP");
  await dialog.getByRole("button", { name: "Keep pending" }).click();
  await expect(open).toBeVisible();
  await expect(page.getByRole("heading", { name: /11 cards$/ })).toBeVisible();
  await expect(page.getByText(/11 photos prepared/)).toBeVisible();
  await open.click();
  await expect(
    dialog.getByRole("combobox", { name: "Card condition", exact: true }),
  ).toHaveValue("HP");
  await page.keyboard.press("Escape");
  const anonymous = await page
    .context()
    .browser()!
    .newContext({ baseURL: "http://127.0.0.1:13001" });
  expect(
    (await anonymous.request.get(`${endpoint}?photoId=${photoId}`)).status(),
  ).toBe(403);
  await anonymous.close();
}
