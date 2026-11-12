import "keyrune/css/keyrune.css";
import "mana-font/css/mana.css";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getRenderUser } from "@/lib/render-context";
import { getRenderUnreadCount } from "@/lib/render-context";
import { normalizeAppTheme } from "@/lib/themes";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";

export async function generateMetadata(): Promise<Metadata> {
  const user = await getRenderUser();
  const unreadCount = user ? await getRenderUnreadCount(user.id) : 0;
  return {
    title: unreadCount > 0 ? `(${unreadCount}) ${appName}` : appName,
    description:
      "Multi-user Magic: The Gathering inventory and trading application",
  };
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getRenderUser();
  const theme = normalizeAppTheme(user?.theme);

  return (
    <html lang="en" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
