import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      screens: {
        /**
         * Extra-small breakpoint for iPhone SE / mini (≤ 375px logical width).
         * Tailwind's default `sm` starts at 640px — too wide for iPhones in
         * portrait. Use `xs:` for tweaks that matter on small-phone screens.
         */
        xs: "400px",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        canvas: {
          DEFAULT: "#05070D",
          deep: "#03050B",
          rise: "#0A0F1F",
        },
        accent: {
          50: "#EFF6FF",
          100: "#DBEAFE",
          200: "#BFDBFE",
          300: "#93C5FD",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
          glow: "rgba(96,165,250,0.45)",
        },
        severity: {
          calm: "#34D399",
          watch: "#FBBF24",
          warn: "#FB923C",
          crit: "#F43F5E",
        },
        /**
         * Semantic surface tokens layered over the canvas gradient.
         * Use these instead of raw `bg-white/[0.04]` when expressing intent
         * (panel background, hover state, subtle raise). Raw utilities stay
         * untouched for backwards compatibility.
         */
        surface: {
          1: "rgba(255,255,255,0.03)",
          2: "rgba(255,255,255,0.055)",
          3: "rgba(255,255,255,0.08)",
          hover: "rgba(255,255,255,0.06)",
          sunken: "rgba(6,13,26,0.85)",
        },
        hairline: {
          DEFAULT: "rgba(255,255,255,0.10)",
          strong: "rgba(255,255,255,0.16)",
          subtle: "rgba(255,255,255,0.06)",
        },
        ink: {
          /** Body copy default. */
          DEFAULT: "#E2E8F0",
          /** Muted / secondary label text. */
          muted: "#94A3B8",
          /** Faint tertiary (captions, timestamps). */
          faint: "#64748B",
          /** High-emphasis on glass. */
          on: "#F8FAFC",
        },
      },
      textColor: {
        /** Semantic text aliases. */
        muted: "#94A3B8",
        faint: "#64748B",
      },
      borderColor: {
        hairline: "rgba(255,255,255,0.10)",
        "hairline-strong": "rgba(255,255,255,0.16)",
        "hairline-subtle": "rgba(255,255,255,0.06)",
      },
      backgroundColor: {
        "surface-1": "rgba(255,255,255,0.03)",
        "surface-2": "rgba(255,255,255,0.055)",
        "surface-3": "rgba(255,255,255,0.08)",
        "surface-hover": "rgba(255,255,255,0.06)",
      },
      backdropBlur: {
        xs: "4px",
        glass: "16px",
        "glass-lg": "20px",
      },
      boxShadow: {
        glass:
          "0 1px 0 0 rgba(255,255,255,0.06) inset, 0 10px 30px -10px rgba(2,6,15,0.7), 0 4px 20px -8px rgba(2,6,15,0.5)",
        "glass-strong":
          "0 1px 0 0 rgba(255,255,255,0.1) inset, 0 20px 50px -20px rgba(2,6,15,0.8), 0 8px 30px -12px rgba(2,6,15,0.6)",
        glow: "0 0 24px 0 rgba(96,165,250,0.35)",
        "glow-lg": "0 0 48px 0 rgba(96,165,250,0.5)",
        "glow-crit": "0 0 32px 0 rgba(244,63,94,0.55)",
      },
      keyframes: {
        aurora: {
          "0%, 100%": {
            transform: "translate3d(0,0,0) scale(1)",
          },
          "33%": {
            transform: "translate3d(4%,-3%,0) scale(1.05)",
          },
          "66%": {
            transform: "translate3d(-3%,4%,0) scale(0.97)",
          },
        },
        auroraAlt: {
          "0%, 100%": {
            transform: "translate3d(0,0,0) scale(1)",
          },
          "50%": {
            transform: "translate3d(-5%,5%,0) scale(1.08)",
          },
        },
        pulseRing: {
          "0%": {
            boxShadow: "0 0 0 0 rgba(244,63,94,0.55)",
          },
          "70%": {
            boxShadow: "0 0 0 12px rgba(244,63,94,0)",
          },
          "100%": {
            boxShadow: "0 0 0 0 rgba(244,63,94,0)",
          },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        floatIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        liftIn: {
          "0%": { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        aurora: "aurora 32s ease-in-out infinite",
        "aurora-alt": "auroraAlt 28s ease-in-out infinite",
        "pulse-ring": "pulseRing 2s cubic-bezier(0.4,0,0.6,1) infinite",
        shimmer: "shimmer 2.5s linear infinite",
        "float-in": "floatIn 0.5s ease-out both",
        "fade-in": "fadeIn 0.35s ease-out both",
        "lift-in": "liftIn 0.35s ease-out both",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
