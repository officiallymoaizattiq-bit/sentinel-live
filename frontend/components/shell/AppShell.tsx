"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  match: (path: string) => boolean;
};

const NAV: NavItem[] = [
  {
    href: "/admin",
    label: "Dashboard",
    match: (p) => p === "/admin",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path
          d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm9 0h7v-9h-7v9zm0-16v5h7V4h-7z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    href: "/admin?view=patients",
    label: "Patients",
    match: (p) => p.startsWith("/patients"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path
          d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.5 0-8 1.8-8 5v2h16v-2c0-3.2-4.5-5-8-5z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    href: "/admin?view=alerts",
    label: "Alerts",
    match: () => false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path
          d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6V11a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    href: "/admin?view=cohort",
    label: "Cohort",
    match: () => false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path
          d="M3 13h2v-2H3v2zm4 0h2v-2H7v2zm4 0h2v-2h-2v2zm4 0h2v-2h-2v2zm4 0h2v-2h-2v2zM3 9h2V7H3v2zm4 0h2V7H7v2zm4 0h2V7h-2v2zm4 0h2V7h-2v2zm4 0h2V7h-2v2zM3 17h2v-2H3v2zm4 0h2v-2H7v2zm4 0h2v-2h-2v2zm4 0h2v-2h-2v2zm4 0h2v-2h-2v2z"
          fill="currentColor"
        />
      </svg>
    ),
  },
];

function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="num hidden whitespace-nowrap text-sm text-slate-400 lg:inline">
      {now}
    </span>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="glass sticky top-4 hidden h-[calc(100vh-2rem)] w-60 shrink-0 flex-col rounded-2xl p-4 md:flex">
      <Link href="/admin" className="mb-6 flex items-center gap-2.5 px-2">
        <div className="relative h-8 w-8">
          <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-accent-300 to-accent-600 shadow-glow" />
          <div className="absolute inset-[3px] rounded-[7px] bg-canvas/80 backdrop-blur-sm" />
          <div className="absolute inset-0 grid place-items-center">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
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
          <div className="text-sm font-semibold tracking-tight text-white">
            Sentinel
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
            Post-op monitor
          </div>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => {
          const active = item.match(pathname ?? "");
          return (
            <Link
              key={item.label}
              href={item.href}
              className={
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition " +
                (active
                  ? "text-white"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100")
              }
            >
              {active && (
                <span className="absolute inset-0 -z-0 rounded-xl bg-gradient-to-r from-accent-500/20 to-accent-400/5 ring-1 ring-inset ring-accent-400/30" />
              )}
              <span
                className={
                  "relative " +
                  (active ? "text-accent-300" : "text-slate-500 group-hover:text-slate-300")
                }
              >
                {item.icon}
              </span>
              <span className="relative font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-medium text-slate-200">
            Pipeline online
          </span>
        </div>
        <div className="text-[10px] leading-relaxed text-slate-500">
          Twilio · ElevenLabs · Gemini
        </div>
      </div>
    </aside>
  );
}

function Topbar({ title, subtitle }: { title?: string; subtitle?: string }) {
  return (
    <header className="glass mb-6 flex items-center justify-between gap-3 rounded-2xl px-5 py-3.5">
      <div className="min-w-0 shrink">
        <div className="truncate text-base font-semibold tracking-tight text-white text-on-glass">
          {title ?? "Sentinel"}
        </div>
        <div className="truncate text-xs text-slate-400">
          {subtitle ?? "Post-op deterioration monitor"}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <div className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 lg:flex">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-slate-500">
            <path
              d="M21 21l-4.3-4.3M11 18a7 7 0 110-14 7 7 0 010 14z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="text"
            placeholder="Search patients, alerts..."
            className="w-48 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
            ⌘K
          </kbd>
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
          <span className="text-xs font-medium text-slate-200">Demo</span>
        </div>

        <Clock />

        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-accent-500/30 to-accent-700/20 text-xs font-semibold text-white">
          RN
        </div>
      </div>
    </header>
  );
}

export function AppShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] gap-6 p-4 lg:p-6">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <Topbar title={title} subtitle={subtitle} />
        <main className="animate-float-in pb-10">{children}</main>
      </div>
    </div>
  );
}
