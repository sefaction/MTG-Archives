import "keyrune/css/keyrune.css";
import "mana-font/css/mana.css";
import "./globals.css";
import type { ReactNode } from "react";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "MTG Inventory";

export const metadata = {
  title: appName,
  description:
    "Multi-user Magic: The Gathering inventory and trading application",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
