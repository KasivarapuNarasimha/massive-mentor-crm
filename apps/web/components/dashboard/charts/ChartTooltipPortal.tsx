"use client";

/**
 * Global dashboard chart tooltip — independent floating UI on document.body.
 * Prefers placement OUTSIDE the chart/card boundary so it never looks "inside"
 * or clipped by GlassCard / overflow parents.
 */

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ChartTooltipBoundary = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type ChartTooltipAnchor = {
  /** Viewport X (MouseEvent.clientX) */
  clientX: number;
  /** Viewport Y (MouseEvent.clientY) */
  clientY: number;
  /**
   * Chart/card rect in viewport coords. When provided, tooltip prefers to sit
   * fully outside this box (above/below/left/right of the card).
   */
  boundary?: ChartTooltipBoundary | null;
};

type Props = {
  open: boolean;
  anchor: ChartTooltipAnchor | null;
  children: ReactNode;
  className?: string;
  /** Fixed panel width so label + value columns never collapse (px) */
  width?: number;
};

const VIEW_PAD = 12;
/** Gap between tooltip edge and cursor / card edge */
const GAP = 16;
const Z = 10050;
/** Default fixed width — full Share / Revenue / Growth values */
const DEFAULT_WIDTH = 248;

type Placement = { left: number; top: number; score: number };

function fitsViewport(left: number, top: number, w: number, h: number, vw: number, vh: number) {
  return (
    left >= VIEW_PAD &&
    top >= VIEW_PAD &&
    left + w <= vw - VIEW_PAD &&
    top + h <= vh - VIEW_PAD
  );
}

/**
 * Build candidate positions: prefer completely outside the chart card, then
 * around the cursor. Higher score = better.
 */
function computePlacement(
  anchor: ChartTooltipAnchor,
  w: number,
  h: number,
  vw: number,
  vh: number
): Placement {
  const { clientX, clientY, boundary } = anchor;
  const candidates: Placement[] = [];

  const clampLeft = (left: number) =>
    Math.min(Math.max(VIEW_PAD, left), Math.max(VIEW_PAD, vw - VIEW_PAD - w));
  const clampTop = (top: number) =>
    Math.min(Math.max(VIEW_PAD, top), Math.max(VIEW_PAD, vh - VIEW_PAD - h));

  if (boundary) {
    const b = boundary;
    // Horizontal align toward cursor but stay within card width band when useful
    const preferLeft = clampLeft(clientX - w / 2);

    // 1) Fully above the card
    candidates.push({
      left: preferLeft,
      top: b.top - GAP - h,
      score: 100 + (clientY - b.top < b.height * 0.55 ? 20 : 0),
    });
    // 2) Fully below the card
    candidates.push({
      left: preferLeft,
      top: b.bottom + GAP,
      score: 90,
    });
    // 3) Fully to the right of the card (cursor on left half of card → prefer right)
    candidates.push({
      left: b.right + GAP,
      top: clampTop(clientY - h / 2),
      score: 85 + (clientX < b.left + b.width * 0.45 ? 15 : 0),
    });
    // 4) Fully to the left of the card (cursor near right edge)
    candidates.push({
      left: b.left - GAP - w,
      top: clampTop(clientY - h / 2),
      score: 85 + (clientX > b.left + b.width * 0.55 ? 15 : 0),
    });
  }

  // Cursor-relative fallbacks (still portal/fixed — never clipped by card)
  // Prefer above cursor
  candidates.push({
    left: clampLeft(clientX - w / 2),
    top: clientY - GAP - h,
    score: 50,
  });
  // Below cursor
  candidates.push({
    left: clampLeft(clientX - w / 2),
    top: clientY + GAP,
    score: 45,
  });
  // Left of cursor (near right edge of viewport / card)
  candidates.push({
    left: clientX - GAP - w,
    top: clampTop(clientY - h / 2),
    score: 40 + (clientX > vw * 0.55 ? 15 : 0),
  });
  // Right of cursor
  candidates.push({
    left: clientX + GAP,
    top: clampTop(clientY - h / 2),
    score: 40 + (clientX < vw * 0.45 ? 15 : 0),
  });

  let best: Placement | null = null;
  for (const c of candidates) {
    const left = clampLeft(c.left);
    const top = clampTop(c.top);
    const inView = fitsViewport(left, top, w, h, vw, vh);
    // After clamping, require true outside-card when boundary is known
    const outside = boundary
      ? top + h <= boundary.top - 2 ||
        top >= boundary.bottom + 2 ||
        left + w <= boundary.left - 2 ||
        left >= boundary.right + 2
      : true;

    let score = c.score;
    if (!inView) score -= 120;
    else score += 25;
    if (boundary) {
      // Strong preference: floating popup outside the chart card
      if (outside) score += 60;
      else score -= 55;
    }
    const placed = { left, top, score };
    if (!best || placed.score > best.score) best = placed;
  }

  return (
    best || {
      left: clampLeft(clientX - w / 2),
      top: clampTop(clientY - GAP - h),
      score: 0,
    }
  );
}

/**
 * Read chart/card surface for outside placement.
 * Prefer `data-chart-surface="card"` (GlassCard) so the popup sits fully
 * outside the whole card, not only the plot area.
 */
export function readChartSurfaceBoundary(
  from: EventTarget | null
): ChartTooltipBoundary | null {
  if (!from || typeof (from as Element).closest !== "function") return null;
  const el =
    ((from as Element).closest(
      '[data-chart-surface="card"]'
    ) as HTMLElement | null) ||
    ((from as Element).closest("[data-chart-surface]") as HTMLElement | null);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

/**
 * Floating chart tooltip. Always mounts on document.body with fixed position.
 */
export function ChartTooltipPortal({
  open,
  anchor,
  children,
  className = "",
  width = DEFAULT_WIDTH,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    left: 0,
    top: 0,
    width,
    zIndex: Z,
    visibility: "hidden",
    pointerEvents: "none",
  });
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;

    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = width;
    const h = Math.max(rect.height, 120);

    const { left, top } = computePlacement(anchor, w, h, vw, vh);

    setStyle({
      position: "fixed",
      left: Math.round(left),
      top: Math.round(top),
      width: w,
      zIndex: Z,
      visibility: "visible",
      pointerEvents: "none",
    });
  }, [open, anchor?.clientX, anchor?.clientY, anchor?.boundary, width, children]);

  if (!mounted || !open || !anchor || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      data-chart-tooltip="portal"
      style={style}
      className={[
        "pointer-events-none box-border",
        // Solid elevated panel — reads as floating popup, not in-chart chrome
        "rounded-2xl border border-white/15 bg-zinc-950/98 text-left",
        "px-3.5 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/10 backdrop-blur-md",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>,
    document.body
  );
}
