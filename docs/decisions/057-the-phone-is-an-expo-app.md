# ADR-057: The phone app is an Expo app, built against the runtime's contract

- **Status:** Proposed
- **Date:** 2026-10-21
- **Owner:** Repository maintainers
- **Context:** A phone is coming (DEV-131). ADR-048 put it behind a relay
  the runtime dials out to, encrypted end to end, with the Mac canonical and
  the phone the one client that may answer for the person. Everything else in
  Althar is TypeScript; the API is one Effect RPC contract
  (`packages/contracts`) over a `PortLike`. The phone needs a few things only
  native code does: a key in the Secure Enclave behind Face ID, pushes it
  decrypts itself (a notification service extension), QR scanning, and a Live
  Activity. Of the agent tools with phone apps, Superset, Orca and Happy are
  Expo apps, and Superset adds its Live Activity as a Swift target.
- **Decision:**
  - The phone is an Expo app (SDK 58, React Native 0.88), in `apps/mobile`
    for now, with its own lockfile outside the Bun workspace, so Expo's exact
    React pin can't move the desktop's and the app can move to a repository of
    its own.
  - It's built against `@althar/contracts`: its client's calls are the
    runtime's, by name and shape, and the relay carries the same RPC, as JSON.
  - Native pieces are Expo modules and targets: the key, the notification
    service extension, the Live Activity (through `@bacons/apple-targets`).
  - It reuses the kit's tokens and words, not its components: the kit draws
    for a desktop window, with Radix and the DOM.
  - The design is [apps/mobile/docs/design.md](../../apps/mobile/docs/design.md).
- **Alternatives considered:**
  - **Capacitor around `@althar/ui`:** the most reuse on paper, but the kit
    is laid out for a pointer and a wide window, so the phone's screens are
    drawn again anyway, and WebKit becomes another engine to test the UI on.
  - **A web app:** the code holding the key would come from whoever serves
    it, the relay's operator, which undoes end-to-end encryption; and iOS web
    push can't carry actions.
  - **Swift and Kotlin:** the best feel, and the plainest path to the key
    and the extension, but two codebases, and the contract's schemas written
    twice and kept in step.
  - **Flutter:** Dart, and nothing shared (ADR-003 turned it down too).
- **Trade-off:** a second UI to keep in step with the desktop's words and
  rules (`model/calls.ts` mirrors the desktop's `shared/calls.ts`); and Effect
  must run on Hermes, React Native's engine, for the relay client.
- **Revisit when:** Effect can't run on Hermes for the relay client; or the
  phone grows past a remote into a main way to work, where native code
  would pay for itself.
