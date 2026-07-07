"use client";

import { useCallback, useRef, useState, type PointerEvent } from "react";

type DeckBannerEditorProps = {
  imageUrl: string;
  initialPositionX: number;
  initialPositionY: number;
  initialZoom: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function DeckBannerEditor({
  imageUrl,
  initialPositionX,
  initialPositionY,
  initialZoom,
}: DeckBannerEditorProps) {
  const [positionX, setPositionX] = useState(initialPositionX);
  const [positionY, setPositionY] = useState(initialPositionY);
  const [zoom, setZoom] = useState(initialZoom);
  const dragStart = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
  } | null>(null);

  const backgroundPosition = `${positionX}% ${positionY}%`;
  const foregroundSize = `auto ${zoom}%`;

  const beginDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStart.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        positionX,
        positionY,
        width: bounds.width,
        height: bounds.height,
      };
    },
    [positionX, positionY],
  );

  const drag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const xDelta = ((event.clientX - start.clientX) / start.width) * 100;
    const yDelta = ((event.clientY - start.clientY) / start.height) * 100;
    setPositionX(clamp(Math.round(start.positionX + xDelta), 0, 100));
    setPositionY(clamp(Math.round(start.positionY + yDelta), 0, 100));
  }, []);

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current?.pointerId === event.pointerId) {
      dragStart.current = null;
    }
  }, []);

  return (
    <div className="space-y-3">
      <input type="hidden" name="bannerPositionX" value={positionX} />
      <input type="hidden" name="bannerPositionY" value={positionY} />
      <input type="hidden" name="bannerZoom" value={zoom} />
      <div
        className="relative aspect-[5/1] min-h-36 cursor-grab touch-none overflow-hidden rounded-md border border-[#2a332d] bg-[#080c0a] active:cursor-grabbing"
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="application"
        aria-label="Drag to reposition the deck banner image"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 scale-110 opacity-75 blur-2xl saturate-150"
          style={{
            backgroundImage: `url(${imageUrl})`,
            backgroundPosition,
            backgroundSize: "cover",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(8,12,10,.92), rgba(12,18,15,.48) 42%, rgba(8,12,10,.88))",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${imageUrl})`,
            backgroundPosition,
            backgroundRepeat: "no-repeat",
            backgroundSize: foregroundSize,
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(8,12,10,.10)_58%,rgba(8,12,10,.62)_100%)]" />
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Zoom
          <input
            type="range"
            min="60"
            max="500"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="mt-2 w-full accent-cyan-500"
          />
        </label>
        <button
          type="button"
          className="rounded-md border border-[#2a332d] px-3 py-2 text-sm text-zinc-200 hover:bg-[#16211c]"
          onClick={() => {
            setPositionX(50);
            setPositionY(50);
            setZoom(100);
          }}
        >
          Reset banner
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Drag the preview to set the crop. The blurred backdrop uses the same
        card art so narrow crops fade into image-derived color instead of an
        empty edge.
      </p>
    </div>
  );
}
