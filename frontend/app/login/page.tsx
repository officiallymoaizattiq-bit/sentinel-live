"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Patient } from "@/lib/api";

function SentinelWordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-10 w-10 shrink-0">
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent-300 to-accent-600 shadow-glow" />
        <div className="absolute inset-[3px] rounded-[9px] bg-slate-950/80 backdrop-blur-sm" />
        <div className="absolute inset-0 grid place-items-center">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path
              d="M12 2L3 7v6c0 5 4 9 9 10 5-1 9-5 9-10V7l-9-5z"
              stroke="white"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
      <div className="leading-tight">
        <div className="text-base font-semibold tracking-tight text-white">
          Sentinel
        </div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
          Post-op monitor
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<"admin" | "patient">("admin");
  const [passkey, setPasskey] = useState("");
  const [patientId, setPatientId] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role === "patient") {
      fetch("/api/patients", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((ps) => setPatients(ps))
        .catch(() => setPatients([]));
    }
  }, [role]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { role, passkey };
      if (role === "patient") body.patient_id = patientId;
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        router.push(role === "admin" ? "/admin" : "/patient");
        return;
      }
      const j = await r.json().catch(() => ({}));
      setErr(j?.detail?.error ?? `login failed (${r.status})`);
    } catch (e) {
      setErr(`network: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const roleChip =
    role === "admin"
      ? "border-accent-400/40 bg-accent-500/10 text-accent-200"
      : "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  const roleLabel = role === "admin" ? "Clinician sign-in" : "Patient sign-in";

  return (
    <div className="flex min-h-[80vh] items-center justify-center safe-pb">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <SentinelWordmark />
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors duration-200 " +
              roleChip
            }
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            {roleLabel}
          </span>
        </div>

        <p className="text-sm text-slate-400">
          Sign in with your passkey to continue.
        </p>

        <div
          role="tablist"
          aria-label="Select role"
          className="flex gap-1 rounded-full border border-white/10 bg-slate-950/40 p-1 text-sm"
        >
          <button
            type="button"
            role="tab"
            aria-selected={role === "admin"}
            onClick={() => setRole("admin")}
            className={
              "flex-1 rounded-full py-1.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/60 " +
              (role === "admin"
                ? "bg-white/15 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200")
            }
          >
            Clinician
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={role === "patient"}
            onClick={() => setRole("patient")}
            className={
              "flex-1 rounded-full py-1.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/60 " +
              (role === "patient"
                ? "bg-white/15 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200")
            }
          >
            Patient
          </button>
        </div>

        {role === "patient" && (
          <label className="block">
            <span className="sr-only">Your name</span>
            <select
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-[16px] text-slate-200 transition-colors duration-200 focus:border-accent-400/50 focus:outline-none"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              required
              aria-label="Select your name"
            >
              <option value="">Choose your name…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="sr-only">Passkey</span>
          <input
            type="password"
            inputMode="text"
            autoComplete="current-password"
            placeholder="Passkey"
            // 16px font-size keeps iOS Safari from zooming into the input on focus.
            className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-[16px] text-slate-100 transition-colors duration-200 placeholder:text-slate-500 focus:border-accent-400/50 focus:outline-none"
            value={passkey}
            onChange={(e) => setPasskey(e.target.value)}
            required
            autoFocus
            aria-label="Passkey"
          />
        </label>

        {err && (
          <div
            role="alert"
            className="rounded-md border border-red-600/40 bg-red-950/40 p-2 text-xs text-red-300"
          >
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="tap-target w-full rounded-lg bg-accent-500/90 text-sm font-semibold text-white shadow-glow transition-colors duration-200 hover:bg-accent-400 active:bg-accent-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
