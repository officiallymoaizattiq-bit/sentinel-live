"use client";

import { useState } from "react";
import { api } from "@/lib/api";

type Variant = "mild" | "sepsis" | "reset";

type Status =
  | { state: "idle" }
  | { state: "loading"; variant: Variant }
  | { state: "ok"; variant: Variant; inserted: number; deleted: number }
  | { state: "error"; variant: Variant; message: string };

type Props = {
  patientId: string;
};

const BUTTONS: {
  variant: Variant;
  minutesBack: number;
  label: string;
  hint: string;
  tone: string;
}[] = [
  {
    variant: "mild",
    minutesBack: 30,
    label: "Simulate mild decline",
    hint: "HR 78 to 92, SpO2 98 to 95",
    tone: "border-amber-400/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20",
  },
  {
    variant: "sepsis",
    minutesBack: 45,
    label: "Simulate sepsis trajectory",
    hint: "HR 80 to 115, SpO2 98 to 92, temp 37.0 to 38.3",
    tone: "border-red-400/40 bg-red-500/10 text-red-100 hover:bg-red-500/20",
  },
  {
    variant: "reset",
    minutesBack: 45,
    label: "Reset demo vitals",
    hint: "Remove seeded rows for this patient",
    tone: "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10",
  },
];

export function DemoHealthPanel({ patientId }: Props) {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const run = async (variant: Variant, minutesBack: number) => {
    setStatus({ state: "loading", variant });
    try {
      const res = await api.seedDemoVitals(patientId, variant, minutesBack);
      setStatus({
        state: "ok",
        variant,
        inserted: res.inserted,
        deleted: res.deleted,
      });
    } catch (e) {
      setStatus({
        state: "error",
        variant,
        message: e instanceof Error ? e.message : "seed failed",
      });
    }
  };

  return (
    <section className="rounded-2xl border border-dashed border-fuchsia-400/30 bg-fuchsia-950/20 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fuchsia-200">
          Demo health panel
        </h2>
        <span className="rounded-full border border-fuchsia-400/30 px-2 py-0.5 text-[10px] text-fuchsia-200/80">
          demo only
        </span>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Seed synthetic wearable vitals so the scorer has a trajectory to read
        during the next check-in call. Replaces the Android HealthKit / Health
        Connect bridge.
      </p>
      <div className="flex flex-col gap-2">
        {BUTTONS.map((b) => {
          const loading =
            status.state === "loading" && status.variant === b.variant;
          return (
            <button
              key={b.variant}
              type="button"
              disabled={loading}
              onClick={() => run(b.variant, b.minutesBack)}
              className={
                "rounded-xl border px-4 py-3 text-left text-sm font-medium transition disabled:opacity-60 " +
                b.tone
              }
            >
              <div className="flex items-center justify-between">
                <span>{b.label}</span>
                {loading && (
                  <span className="text-[11px] opacity-70">seeding…</span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] font-normal opacity-70">
                {b.hint}
              </div>
            </button>
          );
        })}
      </div>
      {status.state === "ok" && (
        <p className="mt-3 text-[11px] text-emerald-300">
          {status.variant === "reset"
            ? `Cleared ${status.deleted} demo rows.`
            : `Seeded ${status.inserted} vitals (cleared ${status.deleted} prior).`}
        </p>
      )}
      {status.state === "error" && (
        <p className="mt-3 text-[11px] text-red-300">
          Error: {status.message}
        </p>
      )}
    </section>
  );
}
