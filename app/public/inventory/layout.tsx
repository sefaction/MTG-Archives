import type { ReactNode } from "react";

export default function PublicInventoryLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <noscript>
        <style>{`.public-inventory-interactive { display: none !important; }`}</style>
        <main className="p-8 space-y-4">
          <h1 className="text-2xl font-semibold">Public inventory requires JavaScript</h1>
          <p>
            Enable JavaScript in your browser, then reload this page to browse and
            search public cards.
          </p>
          <a className="inline-block underline" href="">
            Reload this page
          </a>
        </main>
      </noscript>
      <div className="public-inventory-interactive">{children}</div>
    </>
  );
}
