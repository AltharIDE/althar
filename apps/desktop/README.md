# @althar/desktop

Althar's desktop app: Electron, with the runtime in a utility process and the interface in the window. It opens a folder as a project, where you talk to the project's coordinator: it answers questions about the code and turns what you want changed into tasks. Each task shows in the conversation as a card: first its plan (who implements it, who reviews it), which starts on its own after 25 seconds unless you change or hold it, then where it stands. A task's own thread shows what the lead did, folded once each turn is over, with what each step reported: the lead's summary, and the review's findings. You talk to the lead from the composer, interrupt it, change its model, hand the task to another agent, or stop it. You can also plan a task yourself.

It is step 3 of the [MVP plan](../../docs/plans/mvp.md): the coordinator loop.

## Use it

```bash
bun run dev
```

That builds the app and opens it. Agents sign in with their own tools first (`claude auth login`, `codex login`, `opencode auth login`); the start screen shows which are ready.

The app shares its profile and worktrees with the command-line client (`apps/cli`), so both see the same projects. One runtime at a time can use a profile, so close one before opening the other.

| Environment | Default |
| --- | --- |
| `ALTHAR_PROFILE` | `~/Library/Application Support/Althar` on macOS |
| `ALTHAR_WORKTREES` | `~/Althar` |
| `ALTHAR_FAKE_AGENTS=1` | Off. Runs the scripted fake agent under Claude Code's and Codex's names, and a fake GitHub at `https://github.test`, keeping tokens in memory rather than the Keychain, for the end-to-end tests. Packaged builds leave it out |
| `ALTHAR_FAKE_REMOTE` | None. With the fakes, the bare repository that pushes to the fake GitHub land in |
| `ALTHAR_GITHUB_CLIENT_ID`, `ALTHAR_GITLAB_CLIENT_ID`, `ALTHAR_LINEAR_CLIENT_ID` | None. The public ids of Althar's apps on those services, for signing in through the browser; without one, the service takes a pasted token |
| `ALTHAR_REPORT_URL` | What the build was given, else none. Where Report a problem posts: the reports Worker (`apps/report`), its address alone posting to `/reports`; `https:`, or a local `http:` for `wrangler dev`. Without one, a report is saved in Downloads as a zip and a message opens in the mail app. Set it when building (`ALTHAR_REPORT_URL=… bun run build:package`) to bake it in; set at run time, it wins |
| `ALTHAR_REPORT_EMAIL` | `reports@althar.ai`. Where that message is addressed |

The app keeps its logs in the system's place for them, `~/Library/Logs/Althar` on a Mac, and a `logs` folder in the window's own data folder on Windows and Linux (`@althar/desktop` in the system's app data), or in the profile's `logs` folder when `ALTHAR_PROFILE` is given: `main.log`, `runtime.log` and `agents.log`, each turned over at a megabyte or two and kept about a week. Help → Report a problem, the link at the foot of Settings and Report this on a stuck step open the report dialog.

## Work on it

From `apps/desktop`:

| Command | What it does |
| --- | --- |
| `bun run build` | Builds the main process, the runtime, the preload and the window into `dist/` |
| `bun run build:package` | The same, without the end-to-end tests' hooks, as a packaged app will be built |
| `bun run package` | Builds that and packages it as `out/dist/mac-arm64/Althar.app`, with Cobalt as its icon, signed ad hoc so it opens on the Mac that built it. About 850 MB, most of it Claude Code's and Codex's own binaries, which the agent adapters bring |
| `bun run start` | Opens what was last built |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The window's view models and views against a fake client, and its client against the real runtime |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run test:e2e` | Builds the app and drives it with Playwright, with the fake agent: a project, a task, a thread, a call answered, and the runtime crashing and coming back; with the fake GitHub, connecting it and a task ending in a draft pull request; and the logs on disk and a report sent to a stand-in for the Worker |
| `bun run verify` | Check, coverage and the end-to-end tests, as CI runs them |

### The packaged app: not done yet

`bun run package` makes an app for the Mac that built it. Before one goes to anyone else:

- **Signing and notarization.** A Developer ID build signs each nested executable on its own, with the hardened runtime, rather than with `--deep`: Electron's helpers, Codex's binary and Claude Code's. Claude Code's is a Bun executable, which needs the JIT entitlements under the hardened runtime.
- **Running as Node.** The runtime starts the agent adapters on Althar's own binary as Node (`ELECTRON_RUN_AS_NODE`), so Electron's `runAsNode` fuse stays on, and any process can run code as Althar's signed identity, the one its keychain entry trusts. Before a signed build, the adapters run on a Node of their own (bundled, or a utility process bridging their stdio) and the fuse goes off. `NODE_OPTIONS` and the inspector's flags are off already.
- **A download and updates:** a dmg or zip, and auto-update.

To run the end-to-end test against a real agent, signed in on this machine (it uses a little of its usage):

```bash
ALTHAR_REAL_AGENT=claude-code bunx playwright test e2e/real.spec.ts
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is put together.
