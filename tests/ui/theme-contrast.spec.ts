import { expect, test, type Locator, type Page } from "@playwright/test";

function color(value: string) {
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  }
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Invalid color: ${value}`);
  return value.startsWith("color(srgb")
    ? channels.slice(0, 3).map((channel) => channel * 255)
    : channels.slice(0, 3);
}

function opacity(value: string) {
  return Number(value.match(/[\d.]+/g)?.[3] ?? 1);
}

function contrast(foreground: number[], background: number[]) {
  const luminance = (rgb: number[]) => {
    const [red, green, blue] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function logIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(process.env.UI_ADMIN_USERNAME || "admin");
  await page.getByLabel(/^password$/i).fill(process.env.UI_ADMIN_PASSWORD || "admin123");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/dashboard/);
}

async function navigationContrast(element: Locator) {
  const rendered = await element.evaluate((node) => ({
    text: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
    rail: getComputedStyle(node.closest(".archive-rail")!).backgroundColor,
  }));
  const rail = color(rendered.rail);
  const transparent = rendered.background === "transparent";
  const background = transparent ? rail : color(rendered.background).map(
    (channel, index) => channel * opacity(rendered.background) +
      rail[index] * (1 - opacity(rendered.background)),
  );
  return contrast(color(rendered.text), background);
}

test("navigation labels and route states remain legible on desktop and phone in six themes", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/inventory");
  await page.addStyleTag({ content: "* { transition: none !important; }" });
  const minimum = new Map<string, number>();
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    if (width === 390)
      await page.locator(".archive-navigation > summary").click();
    const rail = page.locator(".archive-rail");
    await expect(rail).toBeVisible();
    const label = rail.locator(".archive-nav-group > p", { hasText: "Collection" });
    const current = rail.getByRole("link", { name: "Inventory", exact: true });
    const ordinary = rail.getByRole("link", { name: "Locations", exact: true });
    await expect(current).toHaveAttribute("aria-current", "page");
    for (const theme of ["golgari", "azorius", "izzet", "selesnya",
      "rakdos", "lotus"]) {
      await page.locator("html").evaluate((node, value) => {
        node.setAttribute("data-theme", value);
      }, theme);
      await page.mouse.move(0, 0);
      for (const [name, element] of [["group", label], ["current", current],
        ["ordinary", ordinary]] as const) {
        const ratio = await navigationContrast(element);
        minimum.set(name, Math.min(minimum.get(name) ?? Infinity, ratio));
        expect(ratio,
          `${theme} ${width}px ${name} navigation contrast`).toBeGreaterThanOrEqual(4.5);
      }
      await ordinary.hover();
      const hovered = await navigationContrast(ordinary);
      minimum.set("hovered", Math.min(minimum.get("hovered") ?? Infinity, hovered));
      expect(hovered,
        `${theme} ${width}px hovered navigation contrast`).toBeGreaterThanOrEqual(4.5);
    }
  }
  console.log("Navigation minimum contrast:", Object.fromEntries(minimum));
});

test("navigation brand hover text remains legible in all six themes", async ({
  page,
}) => {
  await page.goto("/public");
  await page.addStyleTag({ content: "* { transition: none !important; }" });
  const brand = page.locator(".app-nav-brand").first();
  await brand.hover();

  for (const theme of [
    "golgari",
    "azorius",
    "izzet",
    "selesnya",
    "rakdos",
    "lotus",
  ]) {
    await page.locator("html").evaluate((element, name) => {
      element.setAttribute("data-theme", name);
    }, theme);
    const rendered = await brand.evaluate((element) => {
      const style = getComputedStyle(element);
      const tokens = getComputedStyle(document.documentElement);
      return {
        text: style.color,
        highlight: style.backgroundColor,
        surfaces: ["--app-surface-2", "--app-bg"].map((token) =>
          tokens.getPropertyValue(token).trim(),
        ),
      };
    });
    const alpha = opacity(rendered.highlight);
    const highlight = color(rendered.highlight);
    for (const surface of rendered.surfaces) {
      const backdrop = color(surface);
      const background = highlight.map(
        (channel, index) => channel * alpha + backdrop[index] * (1 - alpha),
      );
      expect(
        contrast(color(rendered.text), background),
        `${theme} navigation brand hover over ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("primary actions remain legible across themes and hover states", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/settings");
  await page.addStyleTag({ content: "* { transition: none !important; }" });
  const action = page.getByRole("button", { name: "Save settings" });

  for (const theme of [
    "golgari",
    "azorius",
    "izzet",
    "selesnya",
    "rakdos",
    "lotus",
  ]) {
    await page.locator("html").evaluate((element, name) => {
      element.setAttribute("data-theme", name);
    }, theme);
    for (const state of ["normal", "hover"] as const) {
      if (state === "hover") await action.hover();
      else await page.mouse.move(0, 0);
      const rendered = await action.evaluate((element) => {
        const style = getComputedStyle(element);
        const tokens = getComputedStyle(document.documentElement);
        return {
          text: style.color,
          highlight: style.backgroundColor,
          surfaces: ["--app-surface", "--app-bg"].map((token) =>
            tokens.getPropertyValue(token).trim(),
          ),
        };
      });
      const alpha = opacity(rendered.highlight);
      const highlight = color(rendered.highlight);
      for (const surface of rendered.surfaces) {
        const backdrop = color(surface);
        const background = highlight.map(
          (channel, index) => channel * alpha + backdrop[index] * (1 - alpha),
        );
        expect(
          contrast(color(rendered.text), background),
          `${theme} primary action ${state} over ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

test("admin mode toggle keeps its label legible in both states", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/settings");
  for (const active of [false, true]) {
    await page.addStyleTag({ content: "* { transition: none !important; }" });
    const name = active ? "Exit Admin Mode" : "Enter Admin Mode";
    const action = page.getByRole("button", { name, exact: true });
    for (const theme of [
      "golgari",
      "azorius",
      "izzet",
      "selesnya",
      "rakdos",
      "lotus",
    ]) {
      await page.locator("html").evaluate((element, value) => {
        element.setAttribute("data-theme", value);
      }, theme);
      for (const state of ["normal", "hover"] as const) {
        if (state === "hover") await action.hover();
        else await page.mouse.move(0, 0);
        const rendered = await action.evaluate((element) => {
          const style = getComputedStyle(element);
          const tokens = getComputedStyle(document.documentElement);
          return {
            text: style.color,
            highlight: style.backgroundColor,
            surfaces: ["--app-surface", "--app-bg"].map((token) =>
              tokens.getPropertyValue(token).trim(),
            ),
          };
        });
        const alpha = opacity(rendered.highlight);
        const highlight = color(rendered.highlight);
        for (const surface of rendered.surfaces) {
          const backdrop = color(surface);
          const background = highlight.map(
            (channel, index) => channel * alpha + backdrop[index] * (1 - alpha),
          );
          expect(
            contrast(color(rendered.text), background),
            `${theme} ${name} ${state} over ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    if (!active) {
      await action.click();
      await expect(
        page.getByRole("button", { name: "Exit Admin Mode", exact: true }),
      ).toBeVisible();
    }
  }
});
