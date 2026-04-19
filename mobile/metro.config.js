// Enable Node-style "exports" map resolution. The ElevenLabs SDK chain
// (`@elevenlabs/react-native`, `@elevenlabs/client`, `@elevenlabs/react`)
// has no top-level "main" field and only exposes its entry points + the
// `./internal` subpath via `package.json#exports`. Without this flag,
// Metro can't resolve `@elevenlabs/client/internal` and bails the bundle.
//
// The flag is also what lets Metro pick the package's `react-native`
// export condition over the browser default — that's how we end up
// loading `index.react-native.js` (which registers the LiveKit-based
// session strategy) instead of `index.js` (the web build that touches
// browser globals).
//
// Side effects we accepted by enabling this:
//   - Some packages reference `DOMException`, which Hermes doesn't expose.
//     We polyfill it via `setupFiles` so it's available before any route
//     or SDK module is evaluated. Importing the polyfill from
//     `app/_layout.tsx` is too late: expo-router eagerly walks the
//     `./app` tree at startup, and `status.tsx` -> `CallPanel.tsx` ->
//     `@elevenlabs/react-native` evaluates the SDK at that point.
//
// Reference:
//   https://reactnative.dev/blog/2023/06/21/package-exports-support
//   https://elevenlabs.io/docs/conversational-ai/libraries/react-native

const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;

const POLYFILLS = [path.resolve(__dirname, 'src/polyfills.js')];
const upstreamGetPolyfills = config.serializer.getPolyfills;
config.serializer.getPolyfills = (opts) => {
  const upstream = typeof upstreamGetPolyfills === 'function' ? upstreamGetPolyfills(opts) : [];
  return [...upstream, ...POLYFILLS];
};

module.exports = config;
