import { forwardRef } from "react";

type GlassVariant = "default" | "strong" | "accent";

type GlassProps = {
  variant?: GlassVariant;
  /**
   * When false, skips backdrop-filter (opaque-ish panel). Use on dense grids
   * where Chromium mis-composites frosted glass into vertical streaks.
   */
  backdrop?: boolean;
  /** Used when `backdrop` is false: upper band (solid blue) vs main column (dark blue). */
  solidTone?: "upper" | "lower";
  className?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">;

const VARIANT_CLASS: Record<GlassVariant, string> = {
  default: "glass",
  strong: "glass-strong",
  accent: "glass-accent",
};

export const Glass = forwardRef<HTMLDivElement, GlassProps>(function Glass(
  {
    variant = "default",
    backdrop = true,
    solidTone = "upper",
    className = "",
    children,
    ...rest
  },
  ref
) {
  const surface = backdrop
    ? VARIANT_CLASS[variant]
    : solidTone === "lower"
      ? "glass-solid-lower"
      : "glass-solid-upper";
  return (
    <div
      ref={ref}
      className={`${surface} rounded-2xl ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});
