import { isIP } from "node:net";
import { z } from "zod";

export const EMAIL_TRANSPORT = "email";
export const EMAIL_CATEGORIES = ["trades", "wishlist_digest"] as const;
export type EmailConfig = {
  host: string;
  port: number;
  security: "starttls" | "tls" | "plain";
  from: string;
  appUrl: string;
  user: string;
  password: string;
};

export function validEmailAddress(
  value: string | null | undefined,
): value is string {
  return (
    !!value &&
    value.length <= 254 &&
    !/[\r\n]/.test(value) &&
    z.string().email().safeParse(value).success
  );
}

// Errors deliberately contain configuration key names only, never supplied values.
export function getEmailConfig(
  env: Record<string, string | undefined> = process.env,
): EmailConfig {
  if (env.SMTP_ENABLED !== "true")
    throw new Error(
      "Email delivery is disabled. Set SMTP_ENABLED=true to enable it.",
    );
  const host = env.SMTP_HOST?.trim() ?? "";
  if (
    !host ||
    host.length > 253 ||
    (!isIP(host) && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host))
  )
    throw new Error(
      "Set SMTP_HOST to a valid mail-server hostname or IP address.",
    );
  const security = env.SMTP_SECURITY || "starttls";
  if (!["starttls", "tls", "plain"].includes(security))
    throw new Error("SMTP_SECURITY must be starttls, tls, or plain.");
  if (security === "plain" && env.SMTP_ALLOW_INSECURE !== "true")
    throw new Error(
      "Plain SMTP requires SMTP_ALLOW_INSECURE=true; use it only for a trusted local test relay.",
    );
  const port = Number(env.SMTP_PORT || (security === "tls" ? "465" : "587"));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP_PORT must be between 1 and 65535.");
  const from = env.SMTP_FROM?.trim() ?? "";
  if (!validEmailAddress(from))
    throw new Error("SMTP_FROM must contain one valid sender email address.");
  const user = env.SMTP_USER ?? "";
  const password = env.SMTP_PASSWORD ?? "";
  if (!!user !== !!password)
    throw new Error(
      "Set both SMTP_USER and SMTP_PASSWORD, or leave both empty for an unauthenticated relay.",
    );
  let appUrl: URL;
  try {
    appUrl = new URL(env.APP_BASE_URL || "");
  } catch {
    throw new Error(
      "Set APP_BASE_URL to the browser-visible HTTP or HTTPS origin.",
    );
  }
  if (
    !["http:", "https:"].includes(appUrl.protocol) ||
    appUrl.username ||
    appUrl.password ||
    appUrl.search ||
    appUrl.hash ||
    appUrl.pathname !== "/"
  )
    throw new Error(
      "APP_BASE_URL must be an HTTP or HTTPS origin without credentials, path, query, or fragment.",
    );
  return {
    host,
    port,
    security: security as EmailConfig["security"],
    from,
    user,
    password,
    appUrl: appUrl.origin,
  };
}

export function emailConfigurationStatus(
  env: Record<string, string | undefined> = process.env,
) {
  try {
    getEmailConfig(env);
    return {
      ready: true,
      message: "SMTP is configured. A queued test verifies actual delivery.",
    };
  } catch (error) {
    return {
      ready: false,
      message:
        error instanceof Error
          ? error.message
          : "SMTP configuration is unavailable.",
    };
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function buildNotificationEmail(
  appUrl: string,
  category: string,
  href?: string | null,
) {
  const subject =
    category === "test"
      ? "MTG Archives test email"
      : category === "trades"
        ? "MTG Archives trade activity"
        : "MTG Archives wishlist digest";
  const summary =
    category === "test"
      ? "Your MTG Archives email delivery is working."
      : category === "trades"
        ? "There is new activity on one of your trades. Sign in to review the update."
        : "There is new interest in your cards. Sign in to review your wishlist activity.";
  let url = new URL("/notifications", appUrl);
  if (
    href?.startsWith("/") &&
    !href.startsWith("//") &&
    !/[\\\r\n]/.test(href)
  ) {
    const candidate = new URL(href, appUrl);
    if (candidate.origin === url.origin) url = candidate;
  }
  const link = url.toString();
  return {
    subject,
    text: `${summary}\n\nOpen MTG Archives: ${link}\n\nManage email preferences in Settings → Email notifications.`,
    html: `<h1>${escapeHtml(subject)}</h1><p>${escapeHtml(summary)}</p><p><a href="${escapeHtml(link)}">Open MTG Archives</a></p><p>Manage email preferences in Settings &rarr; Email notifications.</p>`,
  };
}

export function safeSmtpError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "EAUTH")
    return "SMTP authentication failed. Check the server-side credentials.";
  if (
    ["ETIMEDOUT", "ECONNECTION", "ESOCKET", "EDNS", "ECONNREFUSED"].includes(
      code,
    )
  )
    return "SMTP connection or TLS negotiation failed. Check the server, security mode and network.";
  if (code === "EENVELOPE")
    return "SMTP rejected the sender or recipient address.";
  return "SMTP delivery failed. Check the mail-server configuration and delivery history.";
}
