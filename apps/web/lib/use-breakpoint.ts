"use client";

import { useEffect, useState } from "react";

/** Tailwind-aligned breakpoints */
export const BP = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type DeviceTier = "mobile" | "tablet" | "desktop";

/**
 * Automatic device tier from viewport width (no manual mode switch).
 * mobile  < 768
 * tablet  768–1023
 * desktop ≥ 1024
 */
export function useDeviceTier(): DeviceTier {
  const [tier, setTier] = useState<DeviceTier>("desktop");

  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      if (w < BP.md) setTier("mobile");
      else if (w < BP.lg) setTier("tablet");
      else setTier("desktop");
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  return tier;
}

export function useMediaMin(minPx: number): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minPx}px)`);
    const apply = () => setMatch(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [minPx]);
  return match;
}
