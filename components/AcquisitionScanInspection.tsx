"use client";
import { useEffect, useRef, useState } from "react";
import {
  cropPoint,
  type AcquisitionReviewEvidence,
} from "@/lib/acquisition-review-evidence";
import type { AcquisitionPrinting } from "@/lib/acquisition-review";
import { filterButtonClass as button } from "./filterStyles";

export function AcquisitionScanImage({
  src,
  evidence,
  active,
  position,
}: {
  src: string;
  evidence: AcquisitionReviewEvidence;
  active: boolean;
  position: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<"original" | "crop" | "zones" | null>(null);
  // A whole-photo hint may come from outside a bad detected crop. Default to
  // the actual source while keeping explicit crop/zone inspection available.
  const displayView = view ?? (evidence?.photoText ? "original" : "crop");
  const [reverse, setReverse] = useState(false);
  const [error, setError] = useState("");
  const quad =
    evidence?.geometry.status === "PROPOSED"
      ? evidence.geometry.quad
      : undefined;
  const rotation = evidence?.rotation ?? (reverse ? 180 : 0);
  const declaredScan = evidence?.geometry.method === "declared-card-scan";
  const fullFrame = declaredScan || evidence?.geometry.method === "full-frame";
  const observation = evidence?.observations.find(
    (o) => o.rotationDegrees === rotation,
  );
  const readingZones = evidence?.readingZones;
  useEffect(() => {
    if (!active || !canvas.current) return;
    const target = canvas.current;
    let cancelled = false;
    const image = new Image();
    setError("");
    image.onload = () => {
      if (cancelled || !canvas.current) return;
      const ctx = target.getContext("2d")!;
      if (displayView === "original" || !quad) {
        const scale = Math.min(
          1,
          600 / Math.max(image.naturalWidth, image.naturalHeight),
        );
        target.width = Math.round(image.naturalWidth * scale);
        target.height = Math.round(image.naturalHeight * scale);
        ctx.drawImage(image, 0, 0, target.width, target.height);
        if (quad) {
          ctx.beginPath();
          quad.forEach(([x, y], i) =>
            i
              ? ctx.lineTo(x * scale, y * scale)
              : ctx.moveTo(x * scale, y * scale),
          );
          ctx.closePath();
          ctx.strokeStyle = "#00ffff";
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        return;
      }
      // Browser EXIF decoding matches the worker's EXIF-normalized coordinate frame.
      // Reconstruct at display resolution; do not store another private artifact.
      const source = document.createElement("canvas");
      const sampleScale = Math.min(
        1,
        2400 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      source.width = Math.round(image.naturalWidth * sampleScale);
      source.height = Math.round(image.naturalHeight * sampleScale);
      const sourceCtx = source.getContext("2d", { willReadFrequently: true })!;
      sourceCtx.drawImage(image, 0, 0, source.width, source.height);
      const pixels = sourceCtx.getImageData(
        0,
        0,
        source.width,
        source.height,
      ).data;
      target.width = 400;
      target.height = 559;
      const out = ctx.createImageData(target.width, target.height);
      for (let y = 0; y < target.height; y++)
        for (let x = 0; x < target.width; x++) {
          const u = x / (target.width - 1),
            v = y / (target.height - 1);
          const [originalX, originalY] = cropPoint(
            quad,
            rotation === 180 ? 1 - u : u,
            rotation === 180 ? 1 - v : v,
          );
          const sx = (originalX * source.width) / image.naturalWidth,
            sy = (originalY * source.height) / image.naturalHeight;
          const x0 = Math.floor(sx),
            y0 = Math.floor(sy),
            fx = sx - x0,
            fy = sy - y0;
          const offset = (y * target.width + x) * 4;
          for (let c = 0; c < 3; c++) {
            let value = 0;
            for (let j = 0; j < 2; j++)
              for (let i = 0; i < 2; i++) {
                const px = x0 + i,
                  py = y0 + j;
                if (
                  px >= 0 &&
                  py >= 0 &&
                  px < source.width &&
                  py < source.height
                )
                  value +=
                    pixels[(py * source.width + px) * 4 + c] *
                    (i ? fx : 1 - fx) *
                    (j ? fy : 1 - fy);
              }
            out.data[offset + c] = value;
          }
          out.data[offset + 3] = 255;
        }
      ctx.putImageData(out, 0, 0);
      source.width = source.height = 0;
      if (displayView === "zones" && readingZones) {
        ctx.fillStyle = "rgba(0,255,255,.18)";
        for (const zone of Object.values(readingZones))
          ctx.fillRect(
            0,
            (zone.top / 1397) * 559,
            400,
            ((zone.bottom - zone.top) / 1397) * 559,
          );
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = 1;
        for (const line of observation?.lines ?? []) {
          ctx.beginPath();
          line.polygon.forEach(([x, y], i) =>
            i
              ? ctx.lineTo(x * 0.4, (y * 559) / 1397)
              : ctx.moveTo(x * 0.4, (y * 559) / 1397),
          );
          ctx.closePath();
          ctx.stroke();
        }
      }
    };
    image.onerror = () => {
      if (!cancelled)
        setError(
          "Photo could not be loaded. Use Open original or retry this view.",
        );
    };
    image.src = src;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      image.src = "";
      target.width = target.height = 0;
    };
  }, [src, active, quad, observation, readingZones, displayView, rotation]);
  return (
    <figure className="min-w-0">
      <figcaption className="font-semibold mb-2 min-h-12 sm:min-h-0">
        Your scan
      </figcaption>
      <div className="aspect-[1000/1397] max-h-[75vh] flex items-center justify-center bg-black/10 rounded overflow-hidden">
        {active ? (
          <canvas
            ref={canvas}
            role="img"
            aria-label={`${displayView === "original" || !quad ? "Original scan" : fullFrame ? "Full card image" : "Detected card"} ${position}`}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <span className="text-sm">Scan {position}</span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-1 mt-2" aria-label="Scan view">
        {(
          [
            ["original", "Original"],
            ["crop", fullFrame ? "Full card image" : "Detected card"],
            ["zones", "Reading zones"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={button + " text-xs"}
            disabled={key !== "original" && !quad}
            aria-pressed={displayView === key}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
        {quad && evidence?.rotation === null && (
          <button
            className={button + " text-xs"}
            onClick={() => setReverse((v) => !v)}
          >
            Inspect other direction
          </button>
        )}
      </div>
      <p className="text-xs mt-2">
        {!quad
          ? "No detected outline available; showing original."
          : declaredScan
            ? "Card scan: full image retained; border detection skipped."
          : fullFrame
            ? `Full image retained; no crop. This tightly framed image is resized for reading${evidence?.rotation === null ? "; direction unresolved" : " and oriented using the reading result"}.`
            : displayView === "original"
              ? "Cyan outline: corners chosen by the worker."
              : `Reconstructed from the worker's saved corners${evidence?.rotation === null ? "; reading direction unresolved" : " and reading direction"}.`}
      </p>
      {displayView === "zones" && (
        <p className="text-xs">
          Cyan: title/footer areas attempted. Yellow: detected text boxes. Boxes
          do not establish a correct reading. Stamp evidence uses a separately
          aligned lower-left region. Set-symbol detection is not implemented.
        </p>
      )}
      <a
        className="text-xs underline"
        href={src}
        target="_blank"
        rel="noreferrer"
      >
        Open original photo
      </a>
    </figure>
  );
}

export function AcquisitionEvidenceFields({
  evidence,
  selected,
  reasons,
  status,
}: {
  evidence: AcquisitionReviewEvidence;
  selected: AcquisitionPrinting | null;
  reasons: string[];
  status: string;
}) {
  const observation = evidence?.observations.find(
    (o) => o.rotationDegrees === evidence.rotation,
  );
  const ids = evidence?.identifiers;
  const printing = evidence?.printing;
  const selectedStamp = printing?.candidates.find(c=>c.cardId === selected?.id);
  const expectationLabel = selectedStamp?.expectationSource === "CATALOG_LIST_REPRINT"
    ? "List reprint catalog identity"
    : selectedStamp?.expectationSource === "CATALOG_SOURCE_PRINTING"
      ? "Matching source-printing catalog identity"
      : selectedStamp?.expectationSource === "VERIFIED_REFERENCE"
        ? "Verified reference annotation" : "Unqualified";
  const stampStatus = printing?.conflictingObservations
    ? "Conflicting observations; review required"
    : printing?.observedStamp === "PRESENT" ? "Present"
    : printing?.observedStamp === "ABSENT" ? "Absent"
    : printing ? "Unreadable" : "Not checked";
  const printedPrefix = selected?.setCode === "plst"
    ? /^([a-z0-9]+)-(.+)$/i.exec(selected.collectorNumber) : null;
  const compare = (
    values: string[] | undefined,
    expected: string | undefined | null,
  ) =>
    !values?.length
      ? "Not read"
      : values.length > 1
        ? "Ambiguous"
        : expected && values[0].toLowerCase() !== expected.toLowerCase()
          ? "Differs from selection"
          : "Read";
  const rows = [
    [
      "Card name",
      observation?.text.title.join(" · ") || "—",
      reasons.includes("TITLE_EXACT") ||
      reasons.includes("TITLE_TEXT") ||
      reasons.includes("TITLE_AND_COLLECTOR_TEXT")
        ? "Read"
        : reasons.includes("TITLE_CONTRADICTION")
          ? "Conflicting"
          : observation?.text.title.length
            ? "Text found; verify name"
            : "Not read",
    ],
    [
      "Set code",
      ids?.setCodes.join(", ") || "—",
      compare(ids?.setCodes, printedPrefix?.[1] ?? selected?.setCode),
    ],
    [
      "Collector number",
      ids?.collectors.join(", ") || "—",
      compare(
        ids?.collectors,
        (printedPrefix?.[2] ?? selected?.collectorNumber)?.replace(/^0+(?=\d)/, ""),
      ),
    ],
    [
      "Language",
      ids?.languages.join(", ") || "—",
      compare(ids?.languages, selected?.lang),
    ],
    ["Planeswalker stamp",
      selectedStamp?.relation === "CONTRADICTS_STAMP_STATE"
        ? "Observed stamp differs from this printing; correct the selection or inspect the photo."
        : selectedStamp?.relation === "AGREES_WITH_STAMP_STATE"
          ? "Observed stamp agrees with this printing. Other printing details still need verification."
          : printing?.observedStamp === "UNREADABLE"
            ? "The lower-left region did not provide enough evidence. Inspect the original photo."
            : "Inspect the lower-left corner; this selection has no verified stamp comparison.", stampStatus],
    ["Printing stamp expectation", expectationLabel,
      selectedStamp?.expectedStampState ?? "Unknown (older result)"],
    ["Reference image stamp", "Annotation of the public comparison image; separate from the printing expectation",
      selectedStamp?.referenceStampState ?? "Not checked"],
    ["Set symbol", "Visual detection not implemented", "Not checked"],
    [
      "Card image",
      evidence?.imageMatches
        ? evidence.imageMatches.inputRegion === "CARD"
          ? "Whole card compared with catalog images"
          : "Whole photo compared; card outline was not established"
        : "Image comparison not available for this result",
      evidence?.imageMatches
        ? reasons.includes("VISUAL_MATCH") || reasons.includes("SIFT_CANDIDATE")
          ? "Image candidate; verify printing"
          : "Selection outside image candidates"
        : "Not checked",
    ],
  ];
  return (
    <section aria-label="Recognition evidence" className="mt-4">
      <h4 className="font-semibold">What the scanner read</h4>
      {!evidence ? (
        <p className="text-sm">
          {status === "WAITING"
            ? "Waiting for recognition evidence. Older results may not include diagnostics."
            : "Detailed evidence unavailable for this result."}
        </p>
      ) : (
        <>
          <p className="text-sm mb-2">
            {evidence.geometry.status !== "PROPOSED"
              ? evidence.photoText
                ? "Card outline not found. Whole-photo OCR is separate search evidence; title and footer regions are unverified."
                : "Card outline not found. Text recognition could not start."
              : evidence.rotation === null
                ? "Reading direction unresolved. Inspect both directions below; identifiers have not been combined."
                : "Observed photo text is shown below. A catalog suggestion is not proof that every field was read."}
          </p>
          <dl className="divide-y divide-[var(--app-border)] text-sm">
            {rows.map(([field, value, state], index) => (
              <div
                key={field}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 py-2"
              >
                <dt className="font-medium">
                  {field}
                  <span className="block text-xs font-normal">
                    {index < 4 && evidence.geometry.status !== "PROPOSED"
                      ? "Not attempted"
                      : index < 4 && evidence.rotation === null
                        ? "Direction unresolved"
                        : state}
                  </span>
                </dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {printedPrefix && (
            <p className="text-sm mt-2">
              Stamped reprints retain the original set and collector text;
              {" "}{printedPrefix[1].toUpperCase()} #{printedPrefix[2]} identifies
              that source printing within The List / Mystery Booster catalog.
            </p>
          )}
          {reasons.includes("STAMP_UNVERIFIED") && (
            <p className="text-sm mt-2">
              Check the lower-left Planeswalker stamp: the original and stamped
              reprint can have the same set and collector text.
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-sm underline">
              All OCR text and reading directions
            </summary>
            {evidence.observations.map((o) => (
              <div key={o.rotationDegrees} className="text-xs mt-2 break-words">
                <p className="font-semibold">
                  {o.rotationDegrees}° relative to detected crop
                  {o.rotationDegrees === evidence.rotation
                    ? " · selected direction"
                    : ""}
                </p>
                <p>Title: {o.text.title.join(" | ") || "Nothing read"}</p>
                <p>Footer: {o.text.footer.join(" | ") || "Nothing read"}</p>
              </div>
            ))}
          </details>
          {evidence.photoText && (
            <details className="mt-2" data-testid="unlocalized-photo-text">
              <summary className="cursor-pointer text-sm underline">Whole-photo OCR (unlocalized)</summary>
              <p className="text-sm mt-2">
                {evidence.photoText.status === "UNAVAILABLE"
                  ? "Whole-photo reading was unavailable within its bounded attempt. Original crop evidence and suggestions are retained."
                  : evidence.photoText.status === "PARTIAL"
                    ? "Only part of the whole-photo reading completed."
                    : "Whole-photo reading completed."}
                {" "}These lines can suggest names; they do not verify title, footer, language or stamp regions.
              </p>
              {evidence.photoText.readings.map(reading => (
                <div key={reading.rotationDegrees} className="text-xs mt-2 break-words">
                  <p className="font-semibold">{reading.rotationDegrees}° relative to the original photo</p>
                  <p>{reading.text.join(" | ") || "Nothing read"}</p>
                  {reading.truncated && <p>Reading truncated; review the original photo.</p>}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
