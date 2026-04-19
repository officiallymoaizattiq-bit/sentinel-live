import { CallLogSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** Streamed loading UI for the patient check-in surface. */
export default function PatientLoading() {
  return (
    <div
      className="animate-fade-in mx-auto max-w-lg space-y-6 p-4 safe-pb safe-pt"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-7 w-44 rounded" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
      <CallLogSkeleton />
      <Skeleton className="h-[180px] rounded-2xl" />
    </div>
  );
}
