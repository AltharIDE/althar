# ADR-003: Electron shell, with the runtime in a utility process

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** Charrette is a native desktop app from day one. The candidates
  were Electron, Tauri, and Flutter. All code is TypeScript, and the runtime
  needs Node to run ACP adapters.
- **Decision:**
  - The shell is Electron.
  - The runtime runs in an Electron utility process, started and supervised by
    main, with `MessagePort` channels to each renderer.
  - The runtime package imports nothing from Electron, so it also runs under
    plain Node for tests, a diagnostic CLI, or a later daemon.
  - Bundled adapters written for Node run on Electron's own Node.
  - Details: [02](../architecture/02-desktop-runtime.md).
- **Alternatives considered:**
  - Tauri: a Rust core plus a bundled Node or Bun for the runtime means two
    runtimes, and each platform's web view means testing the UI on three
    engines.
  - Flutter: slower UI work, and no reuse of `@charrette/ui`.
  - A native Swift app: macOS only, and no reuse of the UI kit.
  - Electrobun: too young to build a product on today.
  - A separate runtime executable: a utility process already gives a separate,
    supervised process; keeping the runtime free of Electron keeps the option.
- **Trade-off:** a larger download and more memory than Tauri; Electron
  hardening is Charrette's job; Chromium updates arrive with Electron
  releases.
- **Revisit when:** size or memory becomes a real complaint, or work must
  outlive the app and a daemon is needed.
