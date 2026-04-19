// Ambient bridge for `@elevenlabs/react-native`.
//
// The package itself ships proper .d.ts files at
// node_modules/@elevenlabs/react-native/dist/{index,index.react-native}.d.ts,
// but its package.json `exports` map only declares JavaScript paths
// (no "types" condition). With our project's TypeScript moduleResolution
// set to "node" (inherited from expo/tsconfig.base), the resolver doesn't
// honor `exports` at all and treats the import as an untyped module.
//
// Three options were considered:
//   1. Switch moduleResolution to "bundler" — works, but flips a global
//      flag that can change resolution for the entire app and is a much
//      bigger rabbit hole than the actual problem.
//   2. Patch the upstream package.json to add a `types` condition — works,
//      but breaks on `npm install` and requires a patch tool.
//   3. Re-declare the module locally and re-export from the actual .d.ts.
//      This file picks (3) — minimum-surface, no resolver changes, no
//      patch step, and the day the SDK adds a `types` condition we just
//      delete this file.

declare module '@elevenlabs/react-native' {
  export * from '@elevenlabs/react-native/dist/index';
}
