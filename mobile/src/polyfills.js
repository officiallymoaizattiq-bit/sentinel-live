// Bundled by Metro as a pre-modules polyfill (see metro.config.js
// `serializer.getPolyfills`). Runs before any other JS module is
// evaluated, *and* before Metro installs its `require` runtime.
//
// Why this exists:
//   The ElevenLabs SDK chain (@elevenlabs/react-native -> @elevenlabs/client
//   -> livekit-client) references the global DOMException class. Browsers
//   provide it. Hermes (the JS engine on RN) does not. Without this shim
//   the bundle throws `ReferenceError: Property 'DOMException' doesn't
//   exist` at module-load time, and the whole status route fails to mount.
//
// CRITICAL constraints for files in this slot:
//   1. No `require`, no `import`, no `module.exports` — the module system
//      is not running yet. Calling `require` here throws
//      `EarlyJsError: Property 'require' doesn't exist`.
//   2. Do NOT use modern JS that Babel will down-compile into helper
//      `require()` calls. That includes `class X extends Y`, default
//      parameters, spread, async/await, optional chaining in some
//      configs, etc. Babel's class-extends transform emits
//      `require('@babel/runtime/helpers/...')` at the top of the file,
//      which trips constraint #1 even though the source looks clean.
//      We also exclude this file from babel-preset-expo via
//      babel.config.js to belt-and-suspenders this.
//   3. Hermes runs ES2015+ natively, so plain ES5 constructor functions
//      with manual prototype wiring are safe and skipped by Babel.
//
// We intentionally use a tiny Error-like constructor instead of pulling
// in a full DOM polyfill — the SDK only uses `new DOMException(message,
// name)` to throw typed errors, never `.code` constants or
// `instanceof DOMException` checks against the platform-native class.

(function () {
  if (typeof globalThis.DOMException !== 'undefined') return;

  function DOMExceptionShim(message, name) {
    var err = Error.call(this, message);
    this.message = err.message;
    this.name = name || 'Error';
    this.code = 0;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DOMExceptionShim);
    } else {
      this.stack = err.stack;
    }
  }
  DOMExceptionShim.prototype = Object.create(Error.prototype);
  DOMExceptionShim.prototype.constructor = DOMExceptionShim;

  globalThis.DOMException = DOMExceptionShim;
})();
