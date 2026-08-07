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
      aria-hidden="true"
      role="presentation"
    />
  );
}

/** Label + input skeleton pair for form loading */
export function FieldSkeleton({ className = "" }: SkeletonProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  );
}
