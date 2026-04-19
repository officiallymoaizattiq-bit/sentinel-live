import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop, LinearGradient } from 'react-native-svg';
import { palette } from './theme';

/**
 * Full-screen blue aurora + canvas gradient. This is the mobile analogue of
 * the web's <Aurora /> + body canvas gradient from globals.css. We render it
 * as a single absolute-positioned SVG behind the screen content so all
 * screens share one consistent atmosphere.
 *
 * We use react-native-svg (already in the dep graph for the trajectory
 * chart) so we don't need to add expo-linear-gradient.
 */
export function AuroraBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <Defs>
          {/* Vertical canvas gradient — matches --canvas-gradient. */}
          <LinearGradient id="canvas" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.canvasTop} />
            <Stop offset="0.45" stopColor={palette.canvasMid} />
            <Stop offset="1" stopColor={palette.canvasBottom} />
          </LinearGradient>

          {/* Two soft radial blobs, blue-only, subtle. */}
          <RadialGradient id="blobA" cx="10%" cy="-5%" r="65%">
            <Stop offset="0" stopColor="rgba(37,99,235,0.35)" />
            <Stop offset="1" stopColor="rgba(37,99,235,0)" />
          </RadialGradient>
          <RadialGradient id="blobB" cx="95%" cy="25%" r="55%">
            <Stop offset="0" stopColor="rgba(30,64,175,0.28)" />
            <Stop offset="1" stopColor="rgba(30,64,175,0)" />
          </RadialGradient>
          <RadialGradient id="vignette" cx="50%" cy="0%" r="100%">
            <Stop offset="0" stopColor="rgba(15,23,42,0)" />
            <Stop offset="1" stopColor="rgba(15,23,42,0.45)" />
          </RadialGradient>
        </Defs>

        <Rect width="100%" height="100%" fill="url(#canvas)" />
        <Rect width="100%" height="100%" fill="url(#blobA)" />
        <Rect width="100%" height="100%" fill="url(#blobB)" />
        <Rect width="100%" height="100%" fill="url(#vignette)" />
      </Svg>
    </View>
  );
}
