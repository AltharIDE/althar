# Does Effect run on Hermes?

**Yes.** `effect@4.0.0-rc.118`, used as `@althar/contracts` uses it, runs on
the Hermes that React Native 0.88 ships: all 26 checks pass, and the same
bundle passes all 26 on Node as a control. Run 21 October 2026; rerun with
`spikes/hermes/run.sh` (it builds Hermes the first time, about 5 minutes).

This was the main risk behind choosing Expo
([ADR-057](../../../docs/decisions/057-the-phone-is-an-expo-app.md)).

## How it was run

- **Hermes, exactly React Native 0.88's.** The compiler is the
  `hermes-compiler` React Native installs (Hermes 1.0.0, bytecode 99). The
  virtual machine is built from source at the tag React Native 0.88 pins
  (`hermes-v260318099.0.4`, in
  `react-native/sdks/hermes-engine/version.properties`): Hermes V1, 0.88's
  default. No prebuilt command-line VM of that version exists.
- **Bundled as `expo export` would for a release:** Metro, platform `ios`,
  not dev, engine `hermes`, Expo's Babel preset, then `hermesc -O`.
- **The real contract:** the whole `Api` group (131 calls), `HomeSnapshot`,
  `AttentionRequest` and `TaskCard`, and the contract's own `clientProtocol`
  and `serverProtocol`, with the demo's records as data.

## What it checked

1. **Schemas:** a home encodes, survives JSON and decodes equal; calls and a
   task card decode; a broken home fails with an error naming each bad path.
2. **RPC over the contract's transport**, over an in-memory port pair:
   `GetHome`, `Answer`, a typed `ApiError`, a malformed command id refused,
   `Watch` streaming and stopping, calls answered while a `Watch` stays open.
3. **The same over a WebSocket carrying JSON, as the relay will**, with
   `RpcSerialization` json and ndjson; every frame the phone sends is JSON
   text.
4. **Scheduling:** whether a busy fiber lets timers run.

## What the app carries forward

1. **Keep Expo's Babel preset.** React Native's own preset can't bundle
   Effect 4 (`export * as` needs a plugin, and `hermesc` rejects
   `import.meta`). A `babel.config.js`, if the app ever needs one, extends
   `babel-preset-expo`.
2. **One copy of `effect` in the bundle.** Two copies, even of the same
   version, break Schema and RPC. `metro.config.js` resolves `effect` from the
   app for every file, the contract's included.
3. **Effect's scheduler yields with `setTimeout` on the phone.** React
   Native's `setImmediate` is a microtask shim, so a busy fiber's yields let
   no timer, touch or relay message run until it ends. The relay client runs
   everything on `src/client/relay/scheduler.ts`; `tests/scheduler.test.ts`
   shows the problem and the fix under React Native's shim.
4. **`crypto.getRandomValues` isn't installed by React Native or Expo.**
   `src/polyfills.ts` installs `expo-crypto`'s, for command ids.

Needed nothing else: React Native provides every global Effect uses
(`setTimeout` that keeps time is the only one it really needs; `TextEncoder`
is built into Hermes).

## Also seen

- **Size:** about 3.3 MB of bytecode for Effect, the contract and the test.
  Metro doesn't tree-shake, and `effect` and `effect/rpc` come in whole.
  Loading took 12–17 ms on desktop Hermes. If size matters: Expo's tree
  shaking, or narrower imports in the contract.
- **For the relay:** a socket must listen from the moment a connection opens,
  or the phone's first request can be lost (the spike's own in-memory socket
  did this at first).
- **Leave Effect's `SchemaJITCompiler` off** on the phone: it uses
  `new Function`.

## Not covered

A real device: React Native's Hermes with native timers, its `WebSocket` over
a real network, `Intl`, and a phone's speed. Settings › Diagnostics runs the
relay client's path inside the app, so a device shows it in one tap.
