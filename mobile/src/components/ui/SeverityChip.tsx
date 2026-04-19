import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { radius, severityMeta, type Severity } from './theme';

type Props = {
  severity: Severity;
  label?: string;
  size?: 'sm' | 'md';
  /** When true, the chip gently pulses to signal a critical escalation. */
  pulse?: boolean;
};

/**
 * Mirror of the web SeverityChip — a pill with a colored dot + uppercase
 * label, tinted by severity band. Used for the patient status signal.
 */
export function SeverityChip({ severity, label, size = 'md', pulse = false }: Props) {
  const meta = severityMeta(severity);
  const sz = size === 'sm' ? SIZES.sm : SIZES.md;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);

  return (
    <Animated.View
      style={[
        styles.root,
        {
          backgroundColor: meta.bg,
          borderColor: meta.border,
          paddingHorizontal: sz.px,
          paddingVertical: sz.py,
          opacity: pulse ? opacity : 1,
        },
      ]}
    >
      <View
        style={[
          styles.dot,
          {
            backgroundColor: meta.color,
            shadowColor: meta.color,
          },
        ]}
      />
      <Text
        style={[
          styles.label,
          { color: meta.text, fontSize: sz.font, letterSpacing: sz.ls },
        ]}
      >
        {label ?? meta.label}
      </Text>
    </Animated.View>
  );
}

const SIZES = {
  sm: { px: 8, py: 3, font: 10, ls: 0.8 },
  md: { px: 10, py: 5, font: 11, ls: 1.0 },
};

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  label: {
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
