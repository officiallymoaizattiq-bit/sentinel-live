import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { palette, radius, space } from './theme';

type Tone = 'default' | 'strong' | 'accent' | 'crit' | 'calm' | 'watch';

type Props = {
  children: ReactNode;
  tone?: Tone;
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
};

/**
 * Mobile Glass card — RN can't do backdrop-filter, so we simulate the look
 * with a semi-transparent fill + hairline border + soft inner highlight.
 * The parent AuroraBackground provides the blue wash that the translucent
 * fill picks up, so these cards read "frosted" even without true blur.
 */
export function Glass({ children, tone = 'default', padded = true, style }: Props) {
  const toneStyle = TONE_STYLES[tone];
  const flatStyle = Array.isArray(style)
    ? style.reduce((acc, s) => ({ ...acc, ...(s ?? {}) }), {} as ViewStyle)
    : style ?? {};
  return (
    <View style={[styles.base, toneStyle, padded && styles.padded, flatStyle]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  padded: {
    padding: space.lg,
  },
});

const TONE_STYLES: Record<Tone, ViewStyle> = {
  default: {
    backgroundColor: palette.glassBg,
    borderColor: palette.glassBorder,
  },
  strong: {
    backgroundColor: palette.glassBgStrong,
    borderColor: palette.glassBorderStrong,
  },
  accent: {
    backgroundColor: palette.glassBgAccent,
    borderColor: 'rgba(96,165,250,0.25)',
  },
  crit: {
    backgroundColor: palette.critBg,
    borderColor: palette.critBorder,
  },
  calm: {
    backgroundColor: palette.calmBg,
    borderColor: palette.calmBorder,
  },
  watch: {
    backgroundColor: palette.watchBg,
    borderColor: palette.watchBorder,
  },
};
