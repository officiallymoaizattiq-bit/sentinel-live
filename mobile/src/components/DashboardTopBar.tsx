import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { LiveBadge, palette, radius, space } from './ui';

type Props = {
  connected: boolean;
  profileInitials: string;
};

/**
 * Matches the web AppShell top bar: Sentinel mark + title, live pill,
 * static initials avatar. Background sync runs on an interval — no button.
 */
export function DashboardTopBar({ connected, profileInitials }: Props) {
  return (
    <View style={styles.bar}>
      <View style={styles.brand}>
        <SentinelLogoMark />
        <View style={styles.brandText}>
          <Text style={styles.brandTitle}>Sentinel</Text>
          <Text style={styles.brandSub}>POST-OP MONITOR</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <LiveBadge connected={connected} />
        <View
          style={styles.avatar}
          accessibilityRole="image"
          accessibilityLabel={`Patient ${profileInitials}`}
        >
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="avatarFill" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor={palette.accent500} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={palette.accent700} stopOpacity={0.2} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#avatarFill)" rx={10} ry={10} />
          </Svg>
          <Text style={styles.avatarText}>{profileInitials}</Text>
        </View>
      </View>
    </View>
  );
}

function SentinelLogoMark() {
  return (
    <View style={styles.markOuter}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="logoFill" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={palette.accent300} />
            <Stop offset="100%" stopColor={palette.accent600} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#logoFill)" rx={10} ry={10} />
      </Svg>
      <View style={styles.markInner}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path
            d="M12 2L3 7v6c0 5 4 9 9 10 5-1 9-5 9-10V7l-9-5z"
            stroke="white"
            strokeWidth={2}
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: palette.glassBg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
    minWidth: 0,
  },
  brandText: { flexShrink: 1 },
  brandTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.text,
    letterSpacing: -0.2,
  },
  brandSub: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.35,
    color: palette.textDim,
    marginTop: 1,
  },
  markOuter: {
    width: 36,
    height: 36,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markInner: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(5,7,13,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 0,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.glassBorderStrong,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#F8FAFF',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
