module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // The DOMException polyfill is injected by Metro into the pre-modules
    // section of the bundle (see metro.config.js `serializer.getPolyfills`).
    // That section runs before the `require` runtime is installed, so any
    // helper `require()` calls Babel might emit (for class-extends,
    // default parameters, etc.) would crash with `EarlyJsError: Property
    // 'require' doesn't exist`. Keeping the file untouched by Babel
    // guarantees the source we authored is the source that ships, even
    // if babel-preset-expo's plugin set changes upstream.
    overrides: [
      {
        test: /[\\/]src[\\/]polyfills\.js$/,
        compact: false,
        sourceType: 'script',
        presets: [],
        plugins: [],
      },
    ],
  };
};
