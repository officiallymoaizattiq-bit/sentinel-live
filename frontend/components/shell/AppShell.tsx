"use client";

import Link from "next/link";

function SentinelLogoMark() {
  return (
    <div className="relative h-9 w-9 shrink-0">
      <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-accent-300 to-accent-600 shadow-glow" />
      <div className="absolute inset-[3px] rounded-[7px] bg-canvas/80 backdrop-blur-sm" />
      <div className="absolute inset-0 grid place-items-center">
        <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
          <path
            d="M12 2L3 7v6c0 5 4 9 9 10 5-1 9-5 9-10V7l-9-5z"
            stroke="white"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

function Topbar() {
  return (
    <header className="glass mb-6 flex items-center justify-between gap-4 rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5">
      <Link
        href="/admin"
        className="flex shrink-0 items-center gap-2.5 rounded-xl py-0.5 pr-2 text-left transition hover:bg-white/[0.04]"
      >
        <SentinelLogoMark />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-white">
            Sentinel
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
            Post-op monitor
          </div>
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-accent-500/30 to-accent-700/20 text-xs font-semibold text-white">
          RN
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-[1400px] p-4 lg:p-6">
        <Topbar />
        <main className="animate-float-in pb-10">{children}</main>
      </div>
    </>
  );
}
