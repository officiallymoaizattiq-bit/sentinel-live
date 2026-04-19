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
      },
      animation: {
        aurora: "aurora 32s ease-in-out infinite",
        "aurora-alt": "auroraAlt 28s ease-in-out infinite",
        "pulse-ring": "pulseRing 2s cubic-bezier(0.4,0,0.6,1) infinite",
        shimmer: "shimmer 2.5s linear infinite",
        "float-in": "floatIn 0.5s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
