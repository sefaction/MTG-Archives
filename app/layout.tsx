import "keyrune/css/keyrune.css";
import "mana-font/css/mana.css";
import "./globals.css";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { normalizeAppTheme } from "@/lib/themes";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";

export const metadata = {
  title: appName,
  description:
    "Multi-user Magic: The Gathering inventory and trading application",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  const theme = normalizeAppTheme(user?.theme);

  return (
    <html lang="en" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
