"use client";

import {navigatePageRecovery} from "@/lib/page-load-recovery";

/** The root layout may have failed before application CSS or user theme loaded.
 * Keep this fallback self-contained and independent of authentication/data. */
export function PageLoadError() {
  return (
    <main style={{minHeight: "100vh", boxSizing: "border-box", padding: "32px 20px",
      background: "var(--app-bg, #101614)", color: "var(--app-text, #edf2ee)",
      fontFamily: "system-ui, sans-serif", lineHeight: 1.5}}>
      <section aria-labelledby="page-load-error-title" style={{maxWidth: 560, margin: "48px auto"}}>
        <h1 id="page-load-error-title" style={{fontSize: 28, lineHeight: 1.2, margin: "0 0 16px"}}>
          This page couldn’t load
        </h1>
        <p>Reload the page to try again.</p>
        <p>Check your latest changes before repeating a save or Inventory addition.</p>
        <button type="button" onClick={() => navigatePageRecovery(window.location,window.history)}
          style={{marginTop: 12, padding: "12px 20px", borderRadius: 8,
            border: "2px solid currentColor", background: "transparent", color: "inherit",
            font: "inherit", cursor: "pointer"}}>
          Reload page
        </button>
      </section>
    </main>
  );
}
