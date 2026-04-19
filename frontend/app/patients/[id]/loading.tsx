import {
  CallLogSkeleton,
  Skeleton,
  VitalsPanelSkeleton,
} from "@/components/ui/Skeleton";

/** Streamed loading UI for an individual patient detail page. */
export default function PatientDetailLoading() {
  return (
    <div className="animate-fade-in space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
      <CallLogSkeleton />
      <Skeleton className="h-[280px] rounded-2xl" />
      <VitalsPanelSkeleton />
      <Skeleton className="h-[160px] rounded-2xl" />
    </div>
  );
}
