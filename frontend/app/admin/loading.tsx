import {
  KpiStripSkeleton,
  PatientGridSkeleton,
} from "@/components/ui/Skeleton";

/** Streamed loading UI for the clinician dashboard. */
export default function AdminLoading() {
  return (
    <div className="animate-fade-in space-y-6" aria-busy="true" aria-live="polite">
      <KpiStripSkeleton />
      <section className="min-w-0 space-y-4">
        <PatientGridSkeleton count={4} />
      </section>
    </div>
  );
}
