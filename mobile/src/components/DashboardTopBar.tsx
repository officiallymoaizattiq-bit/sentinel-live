import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button, LiveBadge, palette, radius, space } from './ui';

type Props = {
  connected: boolean;
  onSyncPress: () => void | Promise<void>;
  syncing: boolean;
  profileInitials: string;
  onProfilePress: () => void;
};

/**
 * Matches the web AppShell top bar: Sentinel mark + title, live pill, compact Sync, profile.
 */
export function DashboardTopBar({
  connected,
  onSyncPress,
  syncing,
  profileInitials,
  onProfilePress,
}: Props) {
  return (
    <View style={styles.bar}>
      <View style={styles.brand}>
        <SentinelLogoMark />
        <View style={styles.brandText}>
          <Text style={styles.brandTitle}>Sentinel</Text>
          <Text style={styles.brandSub}>Post-op monitor</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <LiveBadge connected={connected} />
        <Button
          label="Sync"
          onPress={() => void onSyncPress()}
          loading={syncing}
          variant="outline"
          compact
        />
        <TouchableOpacity
          onPress={onProfilePress}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          activeOpacity={0.85}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>{profileInitials}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SentinelLogoMark() {
  return (
    <View style={styles.markOuter}>
      <View style={styles.markGlow} />
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
  markGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.accent500,
    opacity: 0.95,
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
    backgroundColor: 'rgba(59,130,246,0.22)',
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
