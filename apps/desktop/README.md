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
| `bun run test:e2e` | Builds the app and drives it with Playwright, with the fake agent: a project, a task, a thread, a call answered, and the runtime crashing and coming back; and, with the fake GitHub, connecting it and a task ending in a draft pull request |
| `bun run verify` | Check, coverage and the end-to-end tests, as CI runs them |

### On Linux

`bun run package` makes an AppImage, a deb and an rpm of the app (Linux
only). Off a Mac the window is frameless and draws its own chrome: the tabs'
strip is the title bar, with the window's own buttons, and the screens with
no tabs carry them too. A trimmed menu is kept for its accelerators (text
zoom, full screen, quit; reload and devtools while developing), and its bar
is hidden on every window, as Electron would otherwise draw it above the
app's own chrome. Sign-ins are sealed in the desktop's keyring;
where Electron wouldn't find one, the app asks for libsecret, which
gnome-keyring, KeePassXC and KWallet all serve — see
[ADR-019](../../docs/decisions/019-linux-windows-packages-and-the-keyring.md).

The packaged app is checked on a real desktop, not under CI's Xvfb:
`scripts/x11-smoke.sh` needs `xdotool`, `xprop` and `wmctrl` on a running X11
session, `scripts/flatpak-smoke.sh` checks the Flatpak's own environment, and
[DEVELOPMENT.md](../../DEVELOPMENT.md#reviewing-on-linux) lists the legs
(X11, Wayland, packages, Flatpak, keyring).

### The Flatpak

**The Flatpak is experimental**: a task running under GNOME and KDE is still
being measured. `scripts/flatpak.sh` builds the Flatpak from what `bun run package` staged
and installs it for the user; `scripts/flatpak-smoke.sh` runs the checks that
are its own environment's (git inside, the device outside, the window's entry
and the narrow permissions). The sandbox is deliberately narrow — network, a
display, the GPU, the keyring, and through `org.freedesktop.Flatpak` the
person's own tools — and everything about what it reaches and what it does
not is in [ADR-018](../../docs/decisions/018-what-the-flatpak-reaches.md). In
short:

- The person's own agents and editors are found and run on the device through
  `flatpak-spawn`, with the environment an agent should have and no ssh agent
  or signed-in tool in it. Everything is gated on `FLATPAK_ID`; dev, macOS,
  AppImage, deb and rpm are unchanged.
- Codex's own sandbox cannot run inside the Flatpak (no user namespaces); its
  adapter drives the person's own Codex on the device instead
  (`flatpak/codex-host.sh`). Without one installed there, a session says so.
- Project folders reach the app through the document portal, and a path is
  translated only at the device boundary (`/run/flatpak/doc/<id>` ↔
  `/run/user/<uid>/doc/<id>`).
- The Flatpak keeps its own profile (`~/.var/app/dev.althar.app/data/althar`)
  with worktrees beside it, separate from the CLI's.

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
