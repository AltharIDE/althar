# @charrette/desktop

Charrette's desktop app: Electron, with the runtime in a utility process and the interface in the window. It opens a folder as a project, starts tasks in worktrees of their own, and shows each task's thread as it happens: what the lead says and thinks, the tools it runs, its plan, and the calls the rules keep for you. You talk to the lead from the composer, interrupt it, change its model, hand the task to another agent, or stop it.

It is step 2 of the [MVP plan](../../docs/plans/mvp.md): the shell, showing a real thread. There is no coordinator or workflow graph yet; a task is its lead.

## Use it

```bash
bun run dev
```

That builds the app and opens it. Agents sign in with their own tools first (`claude auth login`, `codex login`, `opencode auth login`); the start screen shows which are ready.

The app shares its profile and worktrees with the command-line client (`apps/cli`), so both see the same projects. One runtime at a time can use a profile, so close one before opening the other.

| Environment | Default |
| --- | --- |
| `CHARRETTE_PROFILE` | `~/Library/Application Support/Charrette` on macOS |
| `CHARRETTE_WORKTREES` | `~/Charrette` |
| `CHARRETTE_FAKE_AGENTS=1` | Off. Runs the scripted fake agent under Claude Code's and Codex's names, for the end-to-end tests. Packaged builds leave it out |

## Work on it

From `apps/desktop`:

| Command | What it does |
| --- | --- |
| `bun run build` | Builds the main process, the runtime, the preload and the window into `dist/` |
| `bun run build:package` | The same, without the end-to-end tests' hooks, as a packaged app will be built |
| `bun run start` | Opens what was last built |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The window's view models and views against a fake client, and its client against the real runtime |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run test:e2e` | Builds the app and drives it with Playwright, with the fake agent: a project, a task, a thread, a call answered, and the runtime crashing and coming back |
| `bun run verify` | Check, coverage and the end-to-end tests, as CI runs them |

To run the end-to-end test against a real agent, signed in on this machine (it uses a little of its usage):

```bash
CHARRETTE_REAL_AGENT=claude-code bunx playwright test e2e/real.spec.ts
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is put together.
