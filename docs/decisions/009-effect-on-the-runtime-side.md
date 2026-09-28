# ADR-009: Effect on the runtime side

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** The runtime supervises agents and processes for a long time,
  and the architecture asks a lot of it:
  - every retry and poll has a bound, and cancellation happens in stages;
  - it owns process trees, and interrupt-and-continue must work;
  - failures fall into named classes;
  - adapters sit behind ports, with fakes in CI;
  - anything untrusted is validated at runtime;
  - one operation can be traced across processes.

  Plain promises give none of these by default.
- **Decision:**
  - Runtime-side code is written with [Effect](https://effect.website), version
    4, pinned to an exact release candidate and upgraded deliberately. Every
    Effect package in the repository is on the same version.
  - Where: `domain` (schemas for IDs, entities, commands and events; the code
    stays pure), `persistence-sqlite` (Effect's SQL client and migrator on
    `node:sqlite`), `runtime`, `provider-adapters`, the workflow kernel, the
    contract between the desktop app and the runtime (Effect RPC over
    `MessagePort`), and the CLI.
  - Where not: nowhere in `@charrette/ui`, whose components take props and
    report through callbacks. In the desktop app, only in its data layer
    ([ADR-010](010-desktop-app-mvvm.md)). Not in the pitch or landing sites.
  - Promise-based APIs (the ACP SDK, Electron, `gh`) are wrapped at the edge.
  - Conventions:
    - `Effect.gen`, which reads like async/await, rather than long pipes.
    - One service per port, with its implementations as layers, and the
      layers composed only in the runtime's composition root.
    - Tagged errors for each failure class.
    - `Schema` at every boundary, instead of a separate validation library.
    - Tests with fake layers and a test clock.
  - Our own workflow kernel stays. Effect's durable-workflow packages bring
    their own persistence model, and [05](../architecture/05-workflow-engine.md)
    keeps engines behind a port.
- **Alternatives considered:**
  - Plain promises with small helpers: each requirement above becomes custom
    code, written once per place it is needed.
  - Effect 3, the stable line: its SQLite driver needs `better-sqlite3`, a
    native module rebuilt for Electron, and moving to 4 later would touch
    every file.
- **Trade-off:**
  - Effect is a style of its own, which contributors must learn.
  - AI agents know Effect 3 better and will sometimes write it; type checks
    catch this, and agents are pointed at the version 4 documentation.
  - A release candidate may still have bugs.
  - Effect 4's core has no dependencies of its own, but it is one large one.
- **Revisit when:** Effect 4 is stable (move to the stable release); the
  style slows contributors down more than it saves; a release candidate
  regresses something we rely on.
