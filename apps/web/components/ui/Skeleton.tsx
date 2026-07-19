"use client";

interface SkeletonProps {
  className?: string;
}

/**
 * Reusable skeleton placeholder — shimmer for premium loading states.
 */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`mm-skeleton ${className}`}
      aria-hidden
      role="presentation"
    />
  );
}
