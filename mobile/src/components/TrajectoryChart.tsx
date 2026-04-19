import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Line as SvgLine,
  Text as SvgText,
} from 'react-native-svg';

export type TrajectoryPoint = { t: string; deterioration: number };

type Props = {
  points: TrajectoryPoint[];
  height?: number;
};

/**
 * Mobile equivalent of frontend/components/TrajectoryChart.tsx (Recharts).
 * Renders a single deterioration trajectory with the same threshold bands
 * the clinician dashboard uses:
 *   - 0.0–0.3 green  (stable)
 *   - 0.3–0.6 amber  (watch)
 *   - 0.6–1.0 red    (escalate)
 *
 * We hand-roll the SVG instead of pulling in victory-native or the
 * abandoned react-native-svg-charts. One area path + one stroke + dots
 * keeps the component < 200 lines and free of native build steps beyond
 * react-native-svg, which is already the standard Expo charting primitive.
 */
// Padding is a module-level constant so it's referentially stable and safe
// to reference inside useMemo without re-running on every render.
const PADDING = { top: 12, right: 8, bottom: 24, left: 32 } as const;

export function TrajectoryChart({ points, height = 200 }: Props) {
  // All hooks must run unconditionally and in the same order on every render.
  // Earlier we early-returned for the empty case before useMemo, which broke
  // the rules of hooks the moment the first data point arrived ("Rendered
  // more hooks than during the previous render"). Compute everything first,
  // branch on the result at the end.
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.max(280, screenWidth - 64);
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const computed = useMemo(() => {
    if (points.length === 0) return null;

    const xs = points.map((_, i) =>
      points.length === 1
        ? PADDING.left + innerW / 2
        : PADDING.left + (i / (points.length - 1)) * innerW,
    );
    const ys = points.map(
      (p) => PADDING.top + (1 - clamp01(p.deterioration)) * innerH,
    );

    const dots = xs.map((x, i) => ({
      x,
      y: ys[i],
      v: clamp01(points[i].deterioration),
    }));

    let linePath = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
    for (let i = 1; i < xs.length; i++) {
      linePath += ` L ${xs[i].toFixed(2)} ${ys[i].toFixed(2)}`;
    }

    const baselineY = PADDING.top + innerH;
    const areaPath =
      `M ${xs[0].toFixed(2)} ${baselineY.toFixed(2)} ` +
      `L ${xs[0].toFixed(2)} ${ys[0].toFixed(2)} ` +
      xs
        .slice(1)
        .map((x, i) => `L ${x.toFixed(2)} ${ys[i + 1].toFixed(2)}`)
        .join(' ') +
      ` L ${xs[xs.length - 1].toFixed(2)} ${baselineY.toFixed(2)} Z`;

    const gridY = [0, 0.3, 0.6, 1.0].map((v) => ({
      v,
      y: PADDING.top + (1 - v) * innerH,
    }));

    // Show first + last x-axis labels only — anything denser turns into
    // unreadable overlap on a phone screen.
    const xLabels =
      points.length === 1
        ? [{ x: xs[0], label: points[0].t }]
        : [
            { x: xs[0], label: points[0].t },
            { x: xs[xs.length - 1], label: points[points.length - 1].t },
          ];

    return { areaPath, linePath, dots, gridY, xLabels };
  }, [points, innerW, innerH]);

  if (!computed) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>No check-ins yet.</Text>
      </View>
    );
  }

  const { areaPath, linePath, dots, gridY, xLabels } = computed;
  const padding = PADDING;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="dashAreaFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#60A5FA" stopOpacity={0.55} />
          <Stop offset="60%" stopColor="#3B82F6" stopOpacity={0.18} />
          <Stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="dashStroke" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0%" stopColor="#93C5FD" />
          <Stop offset="50%" stopColor="#60A5FA" />
          <Stop offset="100%" stopColor="#3B82F6" />
        </LinearGradient>
      </Defs>

      {/* Threshold bands — match the web chart's ReferenceArea fills. */}
      <Rect
        x={padding.left}
        y={padding.top}
        width={innerW}
        height={innerH * 0.4}
        fill="rgba(244,63,94,0.06)"
      />
      <Rect
        x={padding.left}
        y={padding.top + innerH * 0.4}
        width={innerW}
        height={innerH * 0.3}
        fill="rgba(251,191,36,0.06)"
      />
      <Rect
        x={padding.left}
        y={padding.top + innerH * 0.7}
        width={innerW}
        height={innerH * 0.3}
        fill="rgba(52,211,153,0.05)"
      />

      {/* Y-axis grid + labels */}
      {gridY.map((g) => (
        <SvgLine
          key={`grid-${g.v}`}
          x1={padding.left}
          x2={padding.left + innerW}
          y1={g.y}
          y2={g.y}
          stroke="rgba(148,163,184,0.18)"
          strokeDasharray="3,4"
          strokeWidth={1}
        />
      ))}
      {gridY.map((g) => (
        <SvgText
          key={`y-${g.v}`}
          x={padding.left - 6}
          y={g.y + 3}
          fontSize={9}
          fill="#94A3B8"
          textAnchor="end"
        >
          {g.v.toFixed(1)}
        </SvgText>
      ))}

      {/* Area + line */}
      <Path d={areaPath} fill="url(#dashAreaFill)" />
      <Path
        d={linePath}
        stroke="url(#dashStroke)"
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dots */}
      {dots.map((d, i) => (
        <Circle
          key={`dot-${i}`}
          cx={d.x}
          cy={d.y}
          r={3.5}
          fill="#0A0F1F"
          stroke={dotStroke(d.v)}
          strokeWidth={1.8}
        />
      ))}

      {/* X-axis labels */}
      {xLabels.map((l, i) => (
        <SvgText
          key={`x-${i}`}
          x={l.x}
          y={padding.top + innerH + 14}
          fontSize={9}
          fill="#94A3B8"
          textAnchor={i === 0 ? 'start' : 'end'}
        >
          {l.label}
        </SvgText>
      ))}
    </Svg>
  );
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function dotStroke(v: number): string {
  if (v >= 0.6) return '#F43F5E';
  if (v >= 0.3) return '#FBBF24';
  return '#34D399';
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.05)',
    borderRadius: 12,
  },
  emptyText: { color: '#94A3B8', fontSize: 13 },
});
