import {test, expect} from "@playwright/test";
test.skip(process.env.MTG_COLLECTOR_UI !== "1", "Requires the explicit disposable Collector fixture.");
test.use({baseURL: "http://127.0.0.1:13019"});
async function login(page: import("@playwright/test").Page, username = "collector-ui") {
  await page.goto("/login");
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByLabel(/^password$/i).fill("collector-fixture-only");
  await page.getByRole("button", {name: /^log in$/i}).click();
  await page.waitForURL(/\/dashboard/);
}
for (const viewport of [{width: 1366,height: 900},{width: 390,height: 844}]) {
  test(`Collector ${viewport.width}: counts, modes, paging, retry and navigation`, async ({page}) => {
    await page.setViewportSize(viewport); await login(page);
    if (viewport.width < 1100) await page.locator("summary").filter({hasText: /^Menu$/}).click();
    await page.getByRole("navigation", {name: "Archive navigation"}).getByRole("link", {name: "Collector", exact: true}).click();
    await page.waitForURL(/\/collector$/);
    await expect(page.getByRole("heading",{name:"Collector",exact:true})).toBeVisible();
    await expect(page.getByText("2 / 2 cards",{exact:true})).toBeVisible();
    await page.getByLabel("Completion view").selectOption("variants");
    await expect(page.getByText("2 / 6 variants",{exact:true})).toBeVisible();
    await expect(page.getByText("33.3%",{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    await page.screenshot({path:`.local-data/collector-${viewport.width}.png`,fullPage:true});
    await page.getByLabel("Only sets with English inventory").uncheck();
    await expect(page.locator("article")).toHaveCount(12);
    await page.getByRole("button",{name:"Next",exact:true}).click();
    await expect(page.locator("article")).toHaveCount(4);
    // Previous-page provider requests are deliberately delayed five seconds.
    // New uncached sets must progress instead of waiting for abandoned work.
    await expect(page.getByText("0 / 2 variants", {exact:true}).first()).toBeVisible({timeout:2000});
    await page.getByRole("button",{name:"Previous",exact:true}).click();
    await page.getByLabel("Find a set").fill("Incomplete");
    await expect(page.getByText(/Complete set catalog unavailable/)).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await page.getByRole("button",{name:"Retry INC"}).click();
    await expect(page.getByText(/Complete set catalog unavailable/)).toBeVisible();
    await page.getByLabel("Find a set").fill("Collector test");
    await expect(page.getByText("2 / 6 variants",{exact:true})).toBeVisible();
    await page.getByRole("link",{name:"Back to inventory",exact:true}).click();
    await page.waitForURL(/\/inventory$/);
    await expect(page.getByRole("link", {name: "Collector view", exact: true})).toBeVisible();
    await page.goBack(); await expect(page.getByRole("heading",{name:"Collector",exact:true})).toBeVisible();
    await expect(page.getByText("2 / 2 cards",{exact:true})).toBeVisible();
  });
}
test("API authentication, owner spoofing, peer privacy and unlinked accounts",async({page,request})=>{
  expect((await request.get("/api/collector?set=tst")).status()).toBe(401);
  await login(page);
  const own=await page.request.get("/api/collector?set=tst&ownerId=collector-peer");
  expect(own.headers()["cache-control"]).toBe("private, no-store");
  expect((await own.json()).variants.owned).toBe(2);
  expect((await page.request.get("/api/collector?set=bad%20set")).status()).toBe(400);
  await page.context().clearCookies();await login(page,"collector-peer");
  expect((await (await page.request.get("/api/collector?set=tst")).json()).variants.owned).toBe(3);
  await page.context().clearCookies();await login(page,"collector-unlinked");
  expect((await page.request.get("/api/collector?set=tst")).status()).toBe(403);
});
