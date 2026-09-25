import { expect, test } from "@playwright/test";

function color(value: string) {
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  }
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Invalid color: ${value}`);
  return channels.slice(0, 3);
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
    const opacity = Number(rendered.highlight.match(/[\d.]+/g)?.[3] ?? 1);
    const highlight = color(rendered.highlight);
    for (const surface of rendered.surfaces) {
      const backdrop = color(surface);
      const background = highlight.map(
        (channel, index) => channel * opacity + backdrop[index] * (1 - opacity),
      );
      expect(
        contrast(color(rendered.text), background),
        `${theme} navigation brand hover over ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});
