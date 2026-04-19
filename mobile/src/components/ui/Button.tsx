import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { palette, radius, space } from './theme';

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'success';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  style?: ViewStyle;
  size?: 'md' | 'lg';
};

/**
 * Shared pill-style button. Primary uses the app's accent blue to match the
 * web's bg-emerald/blue CTAs on the patient page, variants cover the other
 * roles the screens need (ghost links, outline secondaries, destructive).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  fullWidth,
  style,
  size = 'md',
}: Props) {
  const isDisabled = disabled || loading;
  const { bg, border, color } = VARIANT_STYLES[variant];
  const py = size === 'lg' ? 16 : 13;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled }}
      activeOpacity={0.85}
      style={[
        styles.root,
        {
          backgroundColor: bg,
          borderColor: border,
          paddingVertical: py,
        },
        fullWidth && styles.full,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator color={color} size="small" />
        ) : (
          <>
            {icon}
            <Text style={[styles.label, { color, fontSize: size === 'lg' ? 16 : 15 }]}>
              {label}
            </Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

const VARIANT_STYLES: Record<Variant, { bg: string; border: string; color: string }> = {
  primary: {
    bg: palette.accent500,
    border: palette.accent600,
    color: '#F8FAFF',
  },
  ghost: {
    bg: 'transparent',
    border: 'transparent',
    color: palette.accent300,
  },
  outline: {
    bg: 'rgba(255,255,255,0.03)',
    border: palette.glassBorderStrong,
    color: palette.text,
  },
  danger: {
    bg: 'rgba(244,63,94,0.10)',
    border: 'rgba(244,63,94,0.45)',
    color: '#FDA4AF',
  },
  success: {
    bg: palette.calm,
    border: '#059669',
    color: '#052E1F',
  },
};

const styles = StyleSheet.create({
  root: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  full: { alignSelf: 'stretch' },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
