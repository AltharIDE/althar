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
| `ALTHAR_FAIL_MIGRATION=1` | Off. Adds a migration that always fails, so the window shows what an update that couldn't move the data looks like. Run the app on a profile once without it first, so there is data to copy. Packaged builds leave it out |
| `ALTHAR_GITHUB_CLIENT_ID`, `ALTHAR_GITLAB_CLIENT_ID`, `ALTHAR_LINEAR_CLIENT_ID` | None. The public ids of Althar's apps on those services, for signing in through the browser; without one, the service takes a pasted token |
| `DO_NOT_TRACK=1` | Off. Keeps usage data off, whatever its switch in Settings says |
| `ALTHAR_POSTHOG_KEY`, `ALTHAR_POSTHOG_HOST` | None. Usage data's PostHog project, read by `bun run package` and `bun run release` only (also from `apps/desktop/.env`, see `.env.example`); every other build sends nothing. The release workflow takes them from the repository's variables of the same names |
| `ALTHAR_REPORT_URL` | What the build was given, else none. Where Report a problem posts: the reports Worker (`apps/report`), its address alone posting to `/reports`; `https:`, or a local `http:` for `wrangler dev`. Without one, a report is saved in Downloads as a zip and a message opens in the mail app. Set it when building (`ALTHAR_REPORT_URL=… bun run build:package`) to bake it in; the release workflow takes it from the repository's `ALTHAR_REPORT_URL` variable. Set at run time, it wins |
| `ALTHAR_REPORT_EMAIL` | `reports@althar.ai`. Where that message is addressed |
| `ALTHAR_UPDATE_FEED` | None. A packaged app reads updates from GitHub Releases; this points it at a feed on this Mac instead (an `http://127.0.0.1` address), to try an update. Any other address is ignored |

The app keeps its logs in the system's place for them, `~/Library/Logs/Althar` on a Mac, and a `logs` folder in the window's own data folder on Windows and Linux (`@althar/desktop` in the system's app data), or in the profile's `logs` folder when `ALTHAR_PROFILE` is given: `main.log`, `runtime.log` and `agents.log`, each turned over at a megabyte or two and kept about a week. Help → Report a problem (on a Mac, where the menu has a bar), the link at the foot of the quick settings, About Althar in Settings, and Report this on a stuck step or on the page an update that couldn't move the data shows open the report dialog.

## Work on it

From `apps/desktop`:

| Command | What it does |
| --- | --- |
| `bun run build` | Builds the main process, the runtime, the preload and the window into `dist/` |
| `bun run build:package` | The same, without the end-to-end tests' hooks, as a packaged app will be built |
| `bun run package` | Builds that and packages it in `out/dist`: on macOS, `mac-arm64/Althar.app`, signed and notarized where credentials are given, with a dmg, zip and `latest-mac.yml`; on Linux, an AppImage, `.deb`, `.rpm` and `latest-linux.yml`. About 850 MB unpacked, most of it Claude Code's and Codex's own binaries, which the agent adapters bring |
| `bun run release` | Packages, signs and notarizes a release, and checks it, as CI does on a version tag. Releases are published from CI only. See below |
| `bun run start` | Opens what was last built |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The window's view models and views against a fake client, and its client against the real runtime |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run test:e2e` | Builds the app and drives it with Playwright, with the fake agent: a project, a task, a thread, a call answered, and the runtime crashing and coming back; with the fake GitHub, connecting it and a task ending in a draft pull request; an update whose migration fails, and reporting it; and the logs on disk and a report sent to a stand-in for the Worker. Arguments go to Playwright: `bun run test:e2e e2e/home.spec.ts` runs one file |
| `bun run verify` | Check and coverage |
| `bun run verify:all` | Check, coverage and the end-to-end tests, as CI runs them |

On a Mac, the end-to-end tests run quietly, so you can keep working while they run: the app never takes focus and has no Dock icon, its window and the island are see-through, and no notifications reach the system. At most three runs go at once on the computer, and one per worktree (`ALTHAR_E2E_SLOTS` changes how many); a waiting run says which ones it waits for. To watch the app as the tests drive it, run them in the foreground:

```bash
ALTHAR_E2E_FOREGROUND=1 bun run test:e2e
```

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
[ADR-028](../../docs/decisions/028-linux-windows-packages-and-the-keyring.md).

The packaged app is checked on a real desktop, not under CI's Xvfb:
`scripts/x11-smoke.sh` needs `xdotool`, `xprop` and `wmctrl` on a running X11
session, `scripts/flatpak-smoke.sh` checks the Flatpak's own environment, and
[DEVELOPMENT.md](../../DEVELOPMENT.md#reviewing-on-linux) lists the legs
(X11, Wayland, packages, Flatpak, keyring).

The AppImage is the Linux package that can update itself. The `.deb` and
`.rpm` still need later install, menu-entry, icon and keyring checks on real
Debian- and RPM-based desktops; see the Linux review table in
`DEVELOPMENT.md`.

### The Flatpak

**The Flatpak is experimental**: a task running under GNOME and KDE is still
being measured. `scripts/flatpak.sh` builds the Flatpak from what `bun run package` staged
and installs it for the user; `scripts/flatpak-smoke.sh` runs the checks that
are its own environment's (git inside, the device outside, the window's entry
and its permissions). The permission to talk to `org.freedesktop.Flatpak` is
broad: it lets the app run commands on the device, which is how the app
reaches the person's tools. The other permissions cover network, display,
GPU and the keyring. What the Flatpak reaches and what it does not is in
[ADR-027](../../docs/decisions/027-what-the-flatpak-reaches.md). In short:

- The person's own OpenCode and Codex, and editors, are found and run on the
  device through `flatpak-spawn`, with the environment an agent should have
  and no ssh agent or signed-in tool in it. Claude Code's sessions use the
  bundled adapter, and its usual account keeps one persistent home under the
  profile, so a host `claude`'s status and sign-in inspect what its sessions
  use. Everything is gated on `FLATPAK_ID`; dev, macOS, AppImage, deb and rpm
  are unchanged.
- Codex's own sandbox cannot run inside the Flatpak (no user namespaces); its
  adapter drives the person's own Codex on the device instead
  (`flatpak/codex-host.sh`). Without one installed there, a session says so.
- Project folders reach the app through the document portal, and a path is
  translated only at the device boundary (`/run/flatpak/doc/<id>` ↔
  `/run/user/<uid>/doc/<id>`).
- The Flatpak keeps its own profile (`~/.var/app/dev.althar.app/data/althar`)
  with worktrees beside it, separate from the CLI's.

### The packaged app

The app is packaged for Apple silicon on macOS and x86_64 Linux. Releases are made and published by CI alone, from a version tag on main ([ADR-024](../../docs/decisions/024-signed-releases-and-updates.md)).

- **Signing.** `bun run package` signs every executable in the app on its own, deepest first, with the hardened runtime and a secure timestamp, each with only the entitlements it needs (`scripts/entitlements.ts`, ADR-033). It signs with `ALTHAR_MAC_IDENTITY` where that names a certificate; else with the Developer ID in `CSC_LINK` and `CSC_KEY_PASSWORD` (the certificate and its key as a base64 `.p12`), where they're set; else with Althar's Developer ID where a keychain has it. CI puts the release environment's certificate in a keychain of the job's own and points electron-builder at it (`CSC_KEYCHAIN`). Without any, or with `ALTHAR_MAC_IDENTITY=-`, the app is signed ad hoc, still hardened, and opens only on the Mac that built it. In CI that fails instead. On a Mac, the first time codesign uses the key, macOS asks for the login password: choose Always Allow, or signing waits for an answer.
- **Notarizing.** With Apple's credentials in the environment, the signed app is sent to Apple's notary service and stapled before the dmg and the zip are made of it, then the dmg is too. Every submission's log is kept in `out/notary/`; a rejected one names each file it found wrong. The credentials are an App Store Connect API key (`APPLE_API_KEY`, the path to its `.p8`, with `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`), or a profile notarytool keeps in the keychain (`APPLE_KEYCHAIN_PROFILE`). Without them nothing is notarized, macOS refuses the app on any other Mac, and in CI the run fails.
- **Updates.** The macOS app and Linux AppImage check the latest published release ten seconds after they start and every four hours. On macOS, Check for Updates… in the app menu checks on demand. A newer version downloads in the background and is offered in the window's bar and Settings. The `.deb` and `.rpm` are updated by their package managers.
- **Trying an update.** Package one version and keep its app; package a newer one, serve its zip and `latest-mac.yml` from a folder (`python3 -m http.server 8765 --bind 127.0.0.1`), and open the older app with `ALTHAR_UPDATE_FEED=http://127.0.0.1:8765/`. Both must be signed by the same Developer ID.
- **Node.** The packaged app ships Node for the agent adapters, at Electron's Node version, in `Contents/Resources/node/bin/node` (ADR-033). `bun run package` fetches it from nodejs.org once, into `node_modules/.cache/althar-node`, and checks it against the digests in `scripts/node.ts`; raise those with Electron, and for Node's security releases. Electron's `runAsNode` fuse is off, with `NODE_OPTIONS` and the inspector's flags, so nothing can run Althar's binary as Node: `ELECTRON_RUN_AS_NODE=1` starts the app instead. In dev the adapters run on Electron's binary as Node.

#### Cutting a release

[`release.yml`](../../.github/workflows/release.yml) runs on a tag `v<version>` pushed on a commit on main. It checks the tag against `package.json`'s version, waits for a reviewer to approve the `release` environment, builds macOS and Linux packages in platform jobs, and leaves one draft GitHub Release with each platform's files. It never runs on a pull request, and it is the only workflow that publishes a desktop release; `desktop.yml` checks Linux packages on pull requests but does not publish them.

1. On main: raise `version` in `apps/desktop/package.json`, and write a few plain lines for testers in `apps/desktop/release-notes/<version>.md`, under the headings New, Improved and Fixed (leave out one with nothing in it). No commit dump.
2. Tag that commit and push the tag: `git tag v0.1.1 && git push origin v0.1.1`.
3. In Actions, open the release run and approve it (Review deployments). Notarizing takes from a few minutes to an hour.
4. In Releases, open the draft, download its dmg, and try it on a Mac: it should open with only the usual "downloaded from the internet" question.
5. Publish the draft. Then the updater and the site's Download see it.

Run by hand (Actions → release → Run workflow, on main), it makes the same draft without a tag; publishing it makes the tag. Run again, a release's run brings its draft up to date, and never touches a published release. Where notarizing fails, the run's `notary-logs` artifact names each file Apple found wrong.

#### The release environment (once)

In the repository's Settings → Environments, make an environment named `release`:

- **Required reviewers:** the people who may let a release use the certificate (Balazs, Taari). Turn on "Prevent self-review" if a second person should always approve.
- **Deployment branches and tags:** Selected branches and tags; add a tag rule `v*`, and add the branch `main` only if releases may also be run by hand. Nothing else can reach the secrets.
- **Secrets,** in the environment, not the repository. Keep each file and password in Bitwarden too, and delete the copies on the Mac once they are set.

| Secret | What it is | How to make it |
| --- | --- | --- |
| `CSC_LINK` | The Developer ID Application certificate and its private key, as a base64 `.p12` | In Keychain Access, login keychain, My Certificates: select "Developer ID Application: …" with its key, File → Export Items…, save as `cert.p12` with a password. Then `base64 -i cert.p12 \| pbcopy`, and paste |
| `CSC_KEY_PASSWORD` | The `.p12`'s password | The one chosen as it was exported |
| `APPLE_API_KEY` | An App Store Connect API key: the `.p8` file's contents | App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys: generate a key with Developer access, and download its `.p8` (it downloads once). `pbcopy < AuthKey_<id>.p8`, and paste |
| `APPLE_API_KEY_ID` | That key's ID | Beside the key in Team Keys |
| `APPLE_API_ISSUER` | The team's issuer ID | Above the keys in Team Keys |

Also turn on **release immutability** (Settings → General → Releases): once a release is published, its files and tag can't be changed. A run brings only a draft up to date, but it can't stop someone publishing the draft while that run is uploading to it; with immutability on, such an upload fails rather than replacing files people already download.

With `gh`, each is one command, for example `base64 -i cert.p12 | gh secret set CSC_LINK --env release --repo AltharIDE/althar`, or `gh secret set APPLE_API_KEY --env release --repo AltharIDE/althar < AuthKey_<id>.p8`.

#### Trying a release on a Mac

Releases are published from CI only. To try one before tagging it, with the certificate in the login keychain and Apple's credentials in the environment:

```bash
APPLE_API_KEY=~/keys/AuthKey_ABC123.p8 APPLE_API_KEY_ID=ABC123 APPLE_API_ISSUER=<issuer id> bun run release
```

It makes and checks the release in `out/dist`, as CI does; open its dmg to try it. `APPLE_KEYCHAIN_PROFILE=<profile>` does instead of the key, for a profile stored once with `xcrun notarytool store-credentials`. If GitHub Actions is down on a release day, the same files can go to a draft by hand: `gh release create v<version> --draft --title "Althar <version>" --notes-file release-notes/<version>.md` with the dmg, the zip, their blockmaps and `latest-mac.yml`.

To run the end-to-end test against a real agent, signed in on this machine (it uses a little of its usage):

```bash
ALTHAR_REAL_AGENT=claude-code bunx playwright test e2e/real.spec.ts
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is put together.
