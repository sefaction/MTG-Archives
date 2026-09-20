import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test.skip(
  process.env.MTG_LOCAL_PILOT_TEST !== "1",
  "Local disposable snapshot only",
);
function database<T>(body: string): T {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
      input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`,
      encoding: "utf8",
      timeout: 60_000,
    }),
  );
}

test("email preferences, queued test, recipient isolation and phone layout", async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(60_000);
  expect(baseURL).toBe("http://127.0.0.1:13001");
  const tag = `ui-email-${randomUUID()}`;
  const address = `${tag}@example.test`;
  const password = randomUUID();
  // Refuse any environment that could deliver to an actual SMTP provider.
  const capture = database<boolean>(
    `return process.env.SMTP_HOST==='smtp-capture' && process.env.SMTP_PORT==='1025' && process.env.SMTP_ENABLED==='true';`,
  );
  test.skip(
    !capture,
    "Requires docker-compose.smtp-test.yml local capture overlay",
  );
  let userId = "";
  let otherUserId = "";
  const captureUrl = `http://127.0.0.1:18025/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`;
  try {
    userId = database<string>(
      `const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);const user=await p.user.create({data:{username:${JSON.stringify(tag)},displayName:'Email fixture',email:${JSON.stringify(address)},passwordHash:hash}});return user.id;`,
    );
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.goto("/settings/email");
    await expect(
      page.getByRole("heading", { name: "Email notifications" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email trade activity")).not.toBeChecked();
    await page.getByLabel("Email trade activity").check();
    await page.getByRole("button", { name: "Save email preferences" }).click();
    await expect(page.getByText("Email preferences saved.")).toBeVisible();
    await expect(page.getByLabel("Email trade activity")).toBeChecked();
    await page.getByRole("button", { name: "Send test email" }).click();
    await expect(page.getByText(/Test email queued\./)).toBeVisible();
    await expect
      .poll(
        () =>
          database<string | null>(
            `const job=await p.notificationDeliveryJob.findFirst({where:{destinationKey:${JSON.stringify(`email:${userId}`)},transport:'email'},orderBy:{createdAt:'desc'}});return job?.status??null;`,
          ),
        { timeout: 20_000 },
      )
      .toBe("SENT");
    await page.getByRole("link", { name: "Refresh delivery history" }).click();
    await expect(
      page.getByRole("region", { name: "Email delivery history" }),
    ).toContainText("SENT");
    const messages = await (await request.get(captureUrl)).json();
    expect(messages.messages).toHaveLength(1);
    const mail = await (
      await request.get(
        `http://127.0.0.1:18025/api/v1/message/${messages.messages[0].ID}`,
      )
    ).json();
    expect(mail.Text).toContain("email delivery is working");
    expect(mail.HTML).toContain("http://127.0.0.1:13001/settings/email");
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("heading", { name: "Email notifications" })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
    await page.screenshot({ path: "test-results/email-settings-phone.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "test-results/email-settings-desktop.png" });
    database(
      `await p.user.update({where:{id:${JSON.stringify(userId)}},data:{email:null}});return true;`,
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Send test email" }),
    ).toBeDisabled();
    await expect(page.getByText("Account email: Not set")).toBeVisible();
    otherUserId = database<string>(
      `const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);const user=await p.user.create({data:{username:${JSON.stringify(`${tag}-other`)},displayName:'Other email fixture',passwordHash:hash}});return user.id;`,
    );
    await page.context().clearCookies();
    await page.goto("/settings/email");
    await expect(page).toHaveURL(/login/);
    await page.getByLabel(/username or email/i).fill(`${tag}-other`);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL(/dashboard/);
    await page.goto("/settings/email");
    await expect(page.getByText("No email deliveries yet.")).toBeVisible();
    await expect(page.getByLabel("Email trade activity")).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Send test email" }),
    ).toBeDisabled();
  } finally {
    if (userId)
      database(
        `await p.notificationDeliveryJob.deleteMany({where:{destinationKey:${JSON.stringify(`email:${userId}`)},transport:'email'}});await p.user.delete({where:{id:${JSON.stringify(userId)}}});return true;`,
      );
    await request.delete(captureUrl);
    if (otherUserId)
      database(
        `await p.user.delete({where:{id:${JSON.stringify(otherUserId)}}});return true;`,
      );
  }
});
