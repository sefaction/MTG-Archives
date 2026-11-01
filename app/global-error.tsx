"use client";

import {PageLoadError} from "@/components/PageLoadError";

export default function GlobalError() {
  return (
    <html lang="en">
      <body style={{margin: 0}}><PageLoadError /></body>
    </html>
  );
}
