import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { palette, radius } from './theme';

/**
 * "● live" / "● connecting" pill. On the web the connecting state pulses
 * via animate-pulse; here we drive an Animated opacity loop so the user
 * gets the same visual cue that the SSE stream isn't yet established.
 */
export function LiveBadge({ connected }: { connected: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (connected) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [connected, pulse]);

  const color = connected ? palette.calm : palette.watch;
  const bg = connected ? 'rgba(52,211,153,0.10)' : 'rgba(251,191,36,0.10)';
  const border = connected ? 'rgba(52,211,153,0.40)' : 'rgba(251,191,36,0.40)';

  return (
    <Animated.View
      style={[
        styles.root,
        { backgroundColor: bg, borderColor: border, opacity: pulse },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color, shadowColor: color }]} />
      <Text style={[styles.text, { color }]}>
        {connected ? 'LIVE' : 'CONNECTING'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  text: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
});
