import { expect, type Page } from "@playwright/test";

/** Uses the owned five-photo native fixture, preserving explicit Inventory commit. */
export async function checkAcquisitionCompactReview(page: Page) {
  const card = page.getByTestId("capture-card-5");
  await page.getByRole("button", { name: "Simple", exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 900 });
  await card.scrollIntoViewIfNeeded();
  const scan = card.getByRole("img", {
    name: "Full card image 5",
    exact: true,
  });
  const scanPainted = () =>
    scan.evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      return (
        canvas.width > 0 &&
        canvas.height > 0 &&
        canvas
          .getContext("2d")!
          .getImageData(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
          ).data[3] === 255
      );
    });
  await expect.poll(scanPainted).toBe(true);
  await expect(
    card.getByRole("heading", { name: "What the scanner read" }),
  ).toBeHidden();
  await expect(
    card.getByRole("button", { name: "Reading zones", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Confirm match", exact: true }),
  ).toBeEnabled();
  expect(
    await card.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThan(500);
  await page.screenshot({ path: "test-results/acquisition-simple-1366.png" });

  await card
    .getByRole("button", { name: /Correct proposed printing for Mountain/ })
    .click();
  await card
    .getByRole("combobox", { name: "Card condition", exact: true })
    .selectOption("LP");
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(
    card.getByRole("heading", { name: "What the scanner read" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simple", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Show cards", exact: true })
    .selectOption("ready");
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("combobox", { name: "Card condition", exact: true }),
  ).toHaveValue("LP");
  await expect(
    page.getByText("Unsaved edits stay visible when you change the filter."),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Show cards", exact: true })
    .selectOption("all");
  await card
    .getByRole("button", { name: "Cancel changes", exact: true })
    .click();
  await expect(
    card.getByRole("combobox", { name: "Card condition", exact: true }),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "Confirm match", exact: true })
    .click();
  await expect(card).toContainText("Review saved. Not yet added to Inventory.");
  await expect(page.getByTestId("scan-review-summary")).toContainText(
    "1 ready for Inventory",
  );
  await page
    .getByRole("combobox", { name: "Show cards", exact: true })
    .selectOption("ready");
  await expect(page.getByTestId("capture-card-1")).toHaveCount(0);
  await expect(card).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Simple", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // Review records and images intentionally load only near the viewport.
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText("FIN #304");
  await expect(
    card.getByRole("button", { name: "Confirm match", exact: true }),
  ).toHaveCount(0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await card.scrollIntoViewIfNeeded();
    await expect.poll(scanPainted).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      card.getByRole("img", { name: /^Printing: Mountain FIN 304/ }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/acquisition-simple-${width}.png`,
    });
  }
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
}
