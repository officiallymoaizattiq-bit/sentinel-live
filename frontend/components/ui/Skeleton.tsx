import type { HTMLAttributes } from "react";

/**
 * Primitive shimmer placeholder. Composes with any size/rounded utility.
 * Respects `prefers-reduced-motion` (animation class is nulled in globals.css).
 */
export function Skeleton({
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  // `.skeleton-tile` (in globals.css) layers a shimmering highlight over a
  // fixed translucent base — see the @layer components block there.
  return (
    <div
      aria-hidden
      className={"skeleton-tile rounded-md " + className}
      {...rest}
    />
  );
}

/** Skeleton placeholder for a single patient card tile. */
export function PatientCardSkeleton() {
  return (
    <div
      aria-hidden
      className="glass-solid-lower relative overflow-hidden rounded-2xl p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3 rounded" />
          <Skeleton className="h-3 w-1/3 rounded" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-16 rounded" />
          <Skeleton className="h-7 w-20 rounded" />
          <Skeleton className="h-2.5 w-12 rounded" />
        </div>
        <Skeleton className="h-8 w-[108px] rounded" />
      </div>
      <div className="mt-3 border-t border-hairline-subtle pt-3">
        <Skeleton className="h-3 w-24 rounded" />
      </div>
    </div>
  );
}

/** Skeleton grid matching <PatientGrid/> layout. */
export function PatientGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {Array.from({ length: count }).map((_, i) => (
          <PatientCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** Skeleton for the call log / summary card. */
export function CallLogSkeleton() {
  return (
    <div className="glass overflow-hidden rounded-2xl p-4">
      <Skeleton className="mb-3 h-3 w-40 rounded" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-[92%] rounded" />
        <Skeleton className="h-3 w-[68%] rounded" />
      </div>
    </div>
  );
}

/** Skeleton for the wearable vitals panel (chart + header). */
export function VitalsPanelSkeleton() {
  return (
    <div className="glass overflow-hidden rounded-2xl p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-36 rounded" />
          <Skeleton className="h-3 w-64 rounded" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-32 rounded-xl" />
        </div>
      </div>
      <Skeleton className="mb-4 h-10 w-40 rounded" />
      <Skeleton className="h-[260px] w-full rounded-xl" />
    </div>
  );
}

/** Skeleton for the admin alert feed sidebar. */
export function AlertFeedSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="h-3 w-12 rounded" />
      </div>
      <ul className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-xl border border-hairline-subtle bg-white/[0.02] px-3 py-2"
          >
            <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-14 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-1/2 rounded" />
              <Skeleton className="h-2.5 w-3/4 rounded" />
            </div>
            <Skeleton className="h-6 w-10 shrink-0 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Skeleton for the KPI tile strip. */
export function KpiStripSkeleton() {
  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-56 rounded" />
          <Skeleton className="h-3 w-44 rounded" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="glass relative overflow-hidden rounded-2xl p-4"
          >
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="mt-3 h-8 w-16 rounded" />
            <Skeleton className="mt-2 h-3 w-24 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
