# @althar/cli — Architecture

A thin client over `@althar/runtime`. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Dependency direction:** depends on `@althar/runtime`, `@althar/provider-adapters` for the agents' sign-in checks, and the two bundled agent adapters, which it ships.

## What it holds

| Module | What it does |
| --- | --- |
| `options.ts` | Reads the command line, and where the profile and worktrees live by default |
| `input.ts` | What a typed line asks for |
| `printer.ts` | What happens on the thread, as terminal output |
| `main.ts` | Wires them to the runtime and the terminal |

## Principles

- **Decisions live in the runtime.** The CLI turns lines into runtime calls and live events into text; it keeps no state of its own beyond the question waiting for an answer.
- **Pure modules, tested; one entry point, not.** `options`, `input` and `printer` are pure and fully tested. `main.ts` only wires them together and is left out of coverage.
- **Built into one file.** Node can't run the workspace's TypeScript as it is, and Bun lacks `node:sqlite`, so Vite+ builds `dist/althar.js` with everything but Node's own modules inlined. The agent adapters stay as packages, since they run as processes of their own.

## Gaps

- The runtime runs inside the CLI's process, so it can't run while the app has the profile open. It will attach to a running runtime over the local socket instead (DEV-128), and there it can't answer permissions or questions ([ADR-048](../../docs/decisions/048-where-the-runtime-runs-and-who-may-reach-it.md)).
- It starts a new task each run. Listing and resuming tasks come later.
