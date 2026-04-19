import type { ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  type ScrollViewProps,
  type ViewStyle,
} from 'react-native';
import { AuroraBackground } from './AuroraBackground';
import { palette, space } from './theme';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  padded?: boolean;
  topInset?: number;
  bottomInset?: number;
} & Pick<ScrollViewProps, 'keyboardShouldPersistTaps'>;

/**
 * Full-bleed dark-themed screen container with the blue aurora background
 * and safe paddings tuned for a Pixel 9 Pro XL. Every mobile screen should
 * mount this as the root so the design language is consistent.
 */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  style,
  contentStyle,
  padded = true,
  topInset = 56,
  bottomInset = 40,
  keyboardShouldPersistTaps,
}: Props) {
  const pad: ViewStyle = padded
    ? {
        paddingHorizontal: space.xl,
        paddingTop: topInset,
        paddingBottom: bottomInset,
      }
    : {};

  return (
    <View style={[styles.root, style]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <AuroraBackground />
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, pad, contentStyle]}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={palette.accent400}
                colors={[palette.accent400]}
                progressBackgroundColor={palette.canvasRise}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, pad, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.canvasFlat,
  },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    gap: space.lg,
  },
});
