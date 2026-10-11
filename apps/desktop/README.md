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
| `ALTHAR_UPDATE_FEED` | None. A packaged app reads updates from GitHub Releases; this points it at a feed on this Mac instead (an `http://127.0.0.1` address), to try an update. Any other address is ignored |

## Work on it

From `apps/desktop`:

| Command | What it does |
| --- | --- |
| `bun run build` | Builds the main process, the runtime, the preload and the window into `dist/` |
| `bun run build:package` | The same, without the end-to-end tests' hooks, as a packaged app will be built |
| `bun run package` | Builds that and packages it in `out/dist`: `mac-arm64/Althar.app`, with Cobalt as its icon, signed with Althar's Developer ID under the hardened runtime and notarized where the credentials are given; a dmg and a zip of it, about 370 MB each; and `latest-mac.yml`, the updater's feed. About 850 MB unpacked, most of it Claude Code's and Codex's own binaries, which the agent adapters bring |
| `bun run release` | Packages, signs and notarizes a release, and checks it; `bun run release --publish` makes a draft GitHub Release of what it made. See below |
| `bun run start` | Opens what was last built |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The window's view models and views against a fake client, and its client against the real runtime |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run test:e2e` | Builds the app and drives it with Playwright, with the fake agent: a project, a task, a thread, a call answered, and the runtime crashing and coming back; and, with the fake GitHub, connecting it and a task ending in a draft pull request |
| `bun run verify` | Check, coverage and the end-to-end tests, as CI runs them |

### The packaged app

The app is for Apple silicon, for now ([ADR-023](../../docs/decisions/023-signed-releases-and-updates.md)).

- **Signing.** `bun run package` signs every executable in the app on its own, deepest first, with the hardened runtime and a secure timestamp: Althar's binary with `resources/entitlements.mac.plist`, and everything else (Electron's helpers, Claude Code's and Codex's binaries, the speech engine) with `entitlements.mac.inherit.plist`. It signs with Althar's Developer ID where this Mac's keychain has it. `ALTHAR_MAC_IDENTITY` names another certificate; without one, or with `ALTHAR_MAC_IDENTITY=-`, the app is signed ad hoc, still hardened, and opens only on the Mac that built it. The first time codesign uses the key, macOS asks for the login password: choose Always Allow, or signing waits for an answer.
- **Notarizing.** With credentials in the environment, the signed app is sent to Apple's notary service and stapled before the dmg and the zip are made of it, then the dmg is too. Every submission's log is kept in `out/notary/`; a rejected one names each file it found wrong. Without credentials nothing is notarized, and macOS refuses the app on any other Mac. Either an App Store Connect API key:

  ```bash
  APPLE_API_KEY=~/keys/AuthKey_ABC123.p8 APPLE_API_KEY_ID=ABC123 APPLE_API_ISSUER=<issuer id> bun run release
  ```

  or a profile notarytool keeps in the keychain, stored once:

  ```bash
  xcrun notarytool store-credentials althar-notary --key ~/keys/AuthKey_ABC123.p8 --key-id ABC123 --issuer <issuer id>
  APPLE_KEYCHAIN_PROFILE=althar-notary bun run release
  ```

- **Releasing.** Raise `version` in `package.json`, write a few plain lines for testers in `release-notes/<version>.md`, then from a clean `main`, pushed: `bun run release` makes and checks the release in `out/dist`; open its dmg and try it; `bun run release --publish` makes a draft GitHub Release for `v<version>` with the dmg, the zip, their blockmaps and `latest-mac.yml`. Nothing reaches anyone until the draft is published on GitHub, which makes the tag. Publishing refuses a build that isn't signed with a Developer ID, or isn't notarized (`--unnotarized` to publish one anyway).
- **Updates.** A packaged app checks the latest published release ten seconds after it starts, every four hours, and from Check for Updates… in the app menu. A newer version downloads in the background, and Squirrel puts it in place only if it is signed as the running app is. Then a line in the window's bar and in Settings' foot says it is ready. Restart is there only while no work runs; otherwise it installs when Althar quits. Settings' foot shows the version, with What's new opening its release notes.
- **Trying an update.** Package one version and keep its app; package a newer one, serve its zip and `latest-mac.yml` from a folder (`python3 -m http.server 8765 --bind 127.0.0.1`), and open the older app with `ALTHAR_UPDATE_FEED=http://127.0.0.1:8765/`. Both must be signed by the same Developer ID.
- **Running as Node.** The runtime starts the agent adapters on Althar's own binaries as Node (`ELECTRON_RUN_AS_NODE`; in the packaged app, on Althar Helper), so Electron's `runAsNode` fuse stays on, and any process can run code as Althar's signed identity, the one its keychain entry trusts. Before launch, the adapters run on a Node of their own (bundled, or a utility process bridging their stdio) and the fuse goes off. `NODE_OPTIONS` and the inspector's flags are off already.

To run the end-to-end test against a real agent, signed in on this machine (it uses a little of its usage):

```bash
ALTHAR_REAL_AGENT=claude-code bunx playwright test e2e/real.spec.ts
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is put together.
