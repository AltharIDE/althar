# @althar/cli — Architecture

A thin in-process or attached client over the shared runtime API. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

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

## Attachment and remaining gaps

- Attached mode uses `@althar/transport-node` over private local sockets or SSH. `attachmentOptions`, `attachmentInput`, `attachmentPrinter` and `attachment` handle target validation, bounded input, sanitized cumulative text, checked feed recovery and commands. It keeps no database or provider credentials locally. Disconnecting cannot stop the host.
- Socket authority cannot answer permissions or questions ([ADR-048](../../docs/decisions/foundations.md#where-the-runtime-runs-and-who-may-reach-it)). Protected desktop pairing and rich remote files/previews remain later work.
- The terminal shows the newest 100 items. Full history navigation remains in the desktop interface.
