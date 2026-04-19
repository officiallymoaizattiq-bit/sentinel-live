/**
 * Mobile design tokens. These mirror the web's globals.css + tailwind.config.ts
 * so a clinician switching between the clinician dashboard (web) and the
 * patient view (this app) sees one coherent design language.
 *
 * Optimised for a Pixel 9 Pro XL (412 × 892 dp logical viewport, 3x density),
 * but every size lives in `space` / `radius` / `font` maps so the layout
 * scales cleanly on narrower phones too.
 */

export const palette = {
  // Page canvas — matches the web's --canvas-gradient.
  canvasTop: '#070F1F',
  canvasMid: '#0B1E3D',
  canvasBottom: '#0C2748',
  canvasFlat: '#05070D',
  canvasRise: '#0A0F1F',

  // Text tiers.
  text: '#F1F5F9',      // slate-100
  textMuted: '#94A3B8', // slate-400
  textDim: '#64748B',   // slate-500
  textFaint: '#475569', // slate-600

  // Accent (blue).
  accent50: '#EFF6FF',
  accent300: '#93C5FD',
  accent400: '#60A5FA',
  accent500: '#3B82F6',
  accent600: '#2563EB',
  accent700: '#1D4ED8',
  accentGlow: 'rgba(96,165,250,0.45)',

  // Severity.
  calm: '#34D399',
  watch: '#FBBF24',
  warn: '#FB923C',
  crit: '#F43F5E',

  // Glass layers (semi-transparent white on a dark canvas).
  glassBg: 'rgba(255,255,255,0.055)',
  glassBgStrong: 'rgba(255,255,255,0.08)',
  glassBgAccent: 'rgba(59,130,246,0.10)',
  glassBorder: 'rgba(255,255,255,0.10)',
  glassBorderStrong: 'rgba(255,255,255,0.16)',
  glassInset: 'rgba(255,255,255,0.06)',

  // Severity-tinted panels.
  critBg: 'rgba(244,63,94,0.10)',
  critBorder: 'rgba(244,63,94,0.40)',
  critText: '#FDA4AF',
  calmBg: 'rgba(52,211,153,0.10)',
  calmBorder: 'rgba(52,211,153,0.40)',
  calmText: '#6EE7B7',
  watchBg: 'rgba(251,191,36,0.10)',
  watchBorder: 'rgba(251,191,36,0.40)',
  watchText: '#FDE68A',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16, // matches web rounded-2xl on phone scale
  xl: 20,
  pill: 999,
} as const;

export const font = {
  // Pixel 9 Pro XL has plenty of vertical room; we lean slightly larger than
  // the web for readability on a held device.
  kicker: { size: 11, weight: '700' as const, letterSpacing: 1.4 },
  label: { size: 11, weight: '600' as const, letterSpacing: 0.6 },
  caption: { size: 12, weight: '500' as const },
  body: { size: 14, weight: '400' as const },
  bodyStrong: { size: 14, weight: '600' as const },
  lead: { size: 16, weight: '500' as const },
  title: { size: 20, weight: '600' as const },
  h1: { size: 28, weight: '700' as const, letterSpacing: -0.3 },
  hero: { size: 34, weight: '700' as const, letterSpacing: -0.4 },
  numHero: { size: 44, weight: '700' as const, letterSpacing: -0.5 },
} as const;

export type Severity = 'calm' | 'watch' | 'warn' | 'crit';

export function severityMeta(s: Severity) {
  switch (s) {
    case 'calm':
      return {
        color: palette.calm,
        bg: palette.calmBg,
        border: palette.calmBorder,
        text: palette.calmText,
        label: 'Stable',
      };
    case 'watch':
      return {
        color: palette.watch,
        bg: palette.watchBg,
        border: palette.watchBorder,
        text: palette.watchText,
        label: 'Watch',
      };
    case 'warn':
      return {
        color: palette.warn,
        bg: 'rgba(251,146,60,0.10)',
        border: 'rgba(251,146,60,0.40)',
        text: '#FDBA74',
        label: 'Warn',
      };
    case 'crit':
      return {
        color: palette.crit,
        bg: palette.critBg,
        border: palette.critBorder,
        text: palette.critText,
        label: 'Critical',
      };
  }
}

export function scoreToSeverity(v: number): Severity {
  if (v >= 0.7) return 'crit';
  if (v >= 0.5) return 'warn';
  if (v >= 0.3) return 'watch';
  return 'calm';
}
