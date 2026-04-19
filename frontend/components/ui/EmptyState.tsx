import type { ReactNode } from "react";
import { Glass } from "@/components/ui/Glass";

type Tone = "neutral" | "accent" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-white/[0.04] ring-1 ring-white/10 text-slate-300",
  accent: "bg-accent-500/12 ring-1 ring-accent-400/30 text-accent-200",
  muted: "bg-white/[0.02] ring-1 ring-white/5 text-slate-400",
};

type Props = {
  /** Optional inline SVG icon rendered inside a circular halo. */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Primary CTA or helper row (Link / button). */
  action?: ReactNode;
  /** Supporting note shown in a smaller, dimmer line under description. */
  hint?: ReactNode;
  tone?: Tone;
  className?: string;
  /**
   * When true, omits the outer <Glass/> wrapper (for empty states that nest
   * inside another card / panel).
   */
  embedded?: boolean;
};

/**
 * "Nothing yet" placeholder. Keeps copy friendly and consistent across the
 * app so empty regions don't feel like failures.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  hint,
  tone = "neutral",
  className = "",
  embedded = false,
}: Props) {
  const inner = (
    <div
      className={
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center " +
        className
      }
    >
      {icon ? (
        <div
          className={
            "grid h-11 w-11 place-items-center rounded-full " + TONE_CLASS[tone]
          }
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div className="mt-1 text-sm font-medium text-slate-100">{title}</div>
      {description ? (
        <p className="max-w-sm text-xs leading-relaxed text-muted">
          {description}
        </p>
      ) : null}
      {hint ? (
        <p className="max-w-sm text-[11px] leading-relaxed text-faint">
          {hint}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );

  if (embedded) return inner;
  return (
    <Glass backdrop={false} solidTone="lower" className="overflow-hidden">
      {inner}
    </Glass>
  );
}
