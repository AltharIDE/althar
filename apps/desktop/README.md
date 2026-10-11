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
| `bun run release` | Packages, signs and notarizes a release, and checks it, as CI does on a version tag. Releases are published from CI only. See below |
| `bun run start` | Opens what was last built |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The window's view models and views against a fake client, and its client against the real runtime |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run test:e2e` | Builds the app and drives it with Playwright, with the fake agent: a project, a task, a thread, a call answered, and the runtime crashing and coming back; and, with the fake GitHub, connecting it and a task ending in a draft pull request. Arguments go to Playwright: `bun run test:e2e e2e/home.spec.ts` runs one file |
| `bun run verify` | Check and coverage |
| `bun run verify:all` | Check, coverage and the end-to-end tests, as CI runs them |

On a Mac, the end-to-end tests run quietly, so you can keep working while they run: the app never takes focus and has no Dock icon, its window and the island are see-through, and no notifications reach the system. At most three runs go at once on the computer, and one per worktree (`ALTHAR_E2E_SLOTS` changes how many); a waiting run says which ones it waits for. To watch the app as the tests drive it, run them in the foreground:

```bash
ALTHAR_E2E_FOREGROUND=1 bun run test:e2e
```

### The packaged app

The app is for Apple silicon, for now. Releases are made and published by CI alone, from a version tag on main ([ADR-024](../../docs/decisions/024-signed-releases-and-updates.md)).

- **Signing.** `bun run package` signs every executable in the app on its own, deepest first, with the hardened runtime and a secure timestamp: Althar's binary with `resources/entitlements.mac.plist`, and everything else (Electron's helpers, Claude Code's and Codex's binaries, the speech engine) with `entitlements.mac.inherit.plist`. It signs with `ALTHAR_MAC_IDENTITY` where that names a certificate; else with the Developer ID in `CSC_LINK` and `CSC_KEY_PASSWORD` (the certificate and its key as a base64 `.p12`), where they're set; else with Althar's Developer ID where a keychain has it. CI puts the release environment's certificate in a keychain of the job's own and points electron-builder at it (`CSC_KEYCHAIN`). Without any, or with `ALTHAR_MAC_IDENTITY=-`, the app is signed ad hoc, still hardened, and opens only on the Mac that built it. In CI that fails instead. On a Mac, the first time codesign uses the key, macOS asks for the login password: choose Always Allow, or signing waits for an answer.
- **Notarizing.** With Apple's credentials in the environment, the signed app is sent to Apple's notary service and stapled before the dmg and the zip are made of it, then the dmg is too. Every submission's log is kept in `out/notary/`; a rejected one names each file it found wrong. The credentials are an App Store Connect API key (`APPLE_API_KEY`, the path to its `.p8`, with `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`), or a profile notarytool keeps in the keychain (`APPLE_KEYCHAIN_PROFILE`). Without them nothing is notarized, macOS refuses the app on any other Mac, and in CI the run fails.
- **Updates.** A packaged app checks the latest published release ten seconds after it starts, every four hours, and from Check for Updates… in the app menu. A newer version downloads in the background, and Squirrel puts it in place only if it is signed as the running app is. Then a line in the window's bar and in Settings' foot says it is ready. Restart is there only while no work runs; otherwise it installs when Althar quits. Settings' foot shows the version, with What's new opening its release notes.
- **Trying an update.** Package one version and keep its app; package a newer one, serve its zip and `latest-mac.yml` from a folder (`python3 -m http.server 8765 --bind 127.0.0.1`), and open the older app with `ALTHAR_UPDATE_FEED=http://127.0.0.1:8765/`. Both must be signed by the same Developer ID.
- **Running as Node.** The runtime starts the agent adapters on Althar's own binaries as Node (`ELECTRON_RUN_AS_NODE`; in the packaged app, on Althar Helper), so Electron's `runAsNode` fuse stays on, and any process can run code as Althar's signed identity, the one its keychain entry trusts. Before launch, the adapters run on a Node of their own (bundled, or a utility process bridging their stdio) and the fuse goes off. `NODE_OPTIONS` and the inspector's flags are off already.

#### Cutting a release

[`release.yml`](../../.github/workflows/release.yml) runs on a tag `v<version>` pushed on a commit on main. It checks the tag against `package.json`'s version, waits for a reviewer to approve the `release` environment, then builds, signs, notarizes and checks Althar on GitHub's Apple silicon runner (`macos-26`), and leaves one draft GitHub Release with the dmg, the zip, their blockmaps and `latest-mac.yml`. It never runs on a pull request, and it is the only workflow that makes a desktop release: each platform's packaging is a job in it. When PR #78 lands, its packaging becomes the Linux job here, and its own publish job in `desktop.yml` goes, since it would publish a release of its own on the same tag.

1. On main: raise `version` in `apps/desktop/package.json`, and write a few plain lines for testers in `apps/desktop/release-notes/<version>.md`. No commit dump.
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
