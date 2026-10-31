# ADR-024: Signed releases on GitHub, and an app that updates itself

- **Status:** Accepted
- **Date:** 2026-10-11
- **Amended:** 2026-10-31 ([ADR-077](077-the-coordinator-merges-and-releases-on-the-person-s-word.md), to build for 0.7.0): when the person asks for a release, the coordinator tags it, approves the run's `release` environment, and publishes the draft on their word to publish; `release.yml` doesn't change.
- **Owner:** Repository maintainers
- **Context:** Althar goes to its first testers on 11 October (DEV-12, DEV-47,
  DEV-62, DEV-81). Until now `bun run package` made an app signed ad hoc, which opens
  only on the Mac that built it, and nothing could update it: every fix
  would mean each tester downloading and reinstalling a 370 MB dmg by hand.
  macOS refuses an app from the internet unless it is signed with a
  Developer ID, under the hardened runtime, and notarized. The app holds 48
  Mach-O files: Electron, its helpers and frameworks (Squirrel, Mantle,
  ReactiveObjC), Claude Code's binary (a Bun executable), Codex's binaries
  and the GStreamer libraries of its voice, and sherpa-onnx's addon and
  libraries for dictation (ADR-017). The repository is public, so its
  GitHub Releases can serve downloads and an update feed without a server.
- **Decision:**
  - **Every executable is signed on its own, with Althar's Developer ID.**
    electron-builder signs the app deepest first, each file with the
    hardened runtime and a secure timestamp, never with `--deep`. Claude
    Code's and Codex's binaries, already signed by Anthropic and OpenAI, are
    signed again with Althar's, so the whole app has one signer and one
    team for library validation. The identity is
    `ALTHAR_MAC_IDENTITY`, else Althar's Developer ID where the keychain
    has it, else ad hoc (still hardened) for anyone building without it.
  - **Entitlements, two files.** Althar's own binary
    (`resources/entitlements.mac.plist`): `cs.allow-jit` for V8, and
    `device.audio-input` for dictation. Everything else
    (`entitlements.mac.inherit.plist`, which electron-builder gives every
    other executable alike): `cs.allow-jit` and
    `cs.allow-unsigned-executable-memory`, which Claude Code's Bun and Codex
    carry in their vendors' own signatures; `cs.disable-library-validation`,
    since Claude Code's binary writes out native addons of its own and loads
    them, signed by Anthropic and not Althar; and `device.audio-input`, for
    Chromium's audio process and Codex's voice. Nothing allows DYLD
    variables, debugging, or Apple events. Since ADR-033, each executable
    is signed with its own entitlements, and the two files are gone.
  - **Notarized with notarytool, credentials from the environment.** An App
    Store Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`,
    `APPLE_API_ISSUER`) or a notarytool keychain profile
    (`APPLE_KEYCHAIN_PROFILE`). The signed app is notarized and stapled
    before the dmg and the zip are made of it; then the dmg is notarized and
    stapled too. Every submission's log is kept in `out/notary/`. Without
    credentials nothing is notarized, and the packaging says so.
  - **What a release holds.** For Apple silicon, and for Intel since
    [ADR-075](075-an-intel-mac-build-beside-apple-silicon.md): a dmg to
    install from, a zip for the updater, their blockmaps for smaller
    downloads later, and one `latest-mac.yml` for both. For Linux: an AppImage with `latest-linux.yml`,
    a deb and an rpm (ADR-028). For Windows on x64 (DEV-78): an NSIS
    installer, `Althar-<version>-x64-setup.exe`, which installs for the
    person alone with no administrator's prompt, with a Start menu entry and
    an uninstaller, its blockmap, and `latest.yml` for the updater.
  - **Windows is unsigned for now** (DEV-78). The installer and the app carry
    no Authenticode signature yet, so SmartScreen warns on a download it
    doesn't know: More info, then Run anyway. The release workflow keeps a
    skipped "Sign" step, and `scripts/package.ts` a `WINDOWS_SIGNING` slot,
    naming what Azure Artifact Signing or an OV certificate needs; signing
    goes there, inside electron-builder, before the feed is written.
  - **CI makes releases, from a version tag on main** (DEV-81).
    `.github/workflows/release.yml` runs on a tag `v<version>` pushed on a
    commit on main, or by hand from main, never on a pull request. It checks
    the tag against `apps/desktop/package.json`'s version and that the notes
    in `apps/desktop/release-notes/<version>.md` are written, then runs `bun
    run release` on GitHub's Apple silicon runner (`macos-26`), which in CI
    fails unless the app is signed with a Developer ID, notarized, stapled
    and accepted by Gatekeeper. A last job puts every platform's files on
    ONE draft GitHub Release for the tag, made or brought up to date; a
    person publishes it after a smoke run of the dmg. It is the only
    workflow that makes a desktop release: Linux and Windows are jobs in it,
    each uploading its files for that last job, so nothing races it.
  - **Secrets live in a `release` environment,** with required reviewers and
    open only to `v*` tags (and main, for runs by hand): every job that uses
    one waits for a person to approve the run. The certificate comes as
    `CSC_LINK` (its `.p12`, base64) and `CSC_KEY_PASSWORD`, which the
    workflow puts in a keychain of the job's own, with its own password,
    with Apple's Developer ID intermediates, unlocked for codesign and
    deleted after (electron-builder's own import unlocks its keychain with
    the `.p12`'s password, which the macOS 26 runner refused); Apple's key as `APPLE_API_KEY` (the `.p8`'s
    contents, written to a file for the job), `APPLE_API_KEY_ID` and
    `APPLE_API_ISSUER`.
  - **Only CI publishes.** `bun run release` builds and checks a release
    the same way on a Mac, for trying one before it is tagged; it doesn't
    publish. If GitHub Actions is down, the files can go to a draft by hand
    with `gh release create --draft`.
  - **One update track, from GitHub Releases.** electron-updater reads
    `latest-mac.yml` from the latest published release and downloads the
    zip it names; Squirrel.Mac takes it only if it is signed as the running
    app is, and puts it in place. On Windows it reads `latest.yml` and
    downloads the installer, which runs silently as Althar quits or
    restarts; on Linux, `latest-linux.yml` and the AppImage. Off a Mac the
    update is ready once it is down. An unsigned Windows app checks no
    signature on its update; once releases are signed, the publisher's
    name goes into the app and later updates must carry it. Adapters ship inside the app, so an app
    update is an adapter update. Stable only: testers and everyone else
    share it.
  - **When.** A packaged app checks ten seconds after it starts, then every
    four hours, and from the app menu's Check for Updates…. A newer version
    downloads in the background. Once Squirrel has it in place, one quiet
    line in the window's bar (the kit's `UpdateReady`) and Settings' foot
    say so.
  - **Never restarted under running work.** Althar never restarts on its
    own. Restart is offered only while the runtime says no work runs (its
    `Working` nudge, as keeping the Mac awake reads it), and the main
    process refuses it otherwise. An update in place installs as Althar
    quits; quitting already stops every agent and records it, and the next
    launch reconciles as after any restart, so installing then adds nothing
    to what quitting does.
  - **The version shows in Settings' foot**, with What's new opening that
    version's release notes on GitHub.
  - **A test's own feed.** `ALTHAR_UPDATE_FEED`, an `http` address on this
    Mac only, points the updater at a local server instead, so an update can
    be tried end to end before a release. Squirrel's signature check still
    applies.
- **Alternatives considered:**
  - Keeping the vendors' signatures on Claude Code's and Codex's binaries
    (`signIgnore`): their entitlements exactly as shipped, but two other
    teams inside Althar's app, and notarization of code Althar didn't sign
    rests on theirs staying valid.
  - One entitlements file per binary, through a signing function of our
    own: Electron's helpers would go without `disable-library-validation`.
    electron-builder has no per-file setting; worth doing when the adapters
    stop running on Electron's binary (the runAsNode question). Done in
    ADR-033.
  - electron-builder's own notarize step: the same notarytool underneath,
    but a rejected submission's log isn't kept.
  - Restarting on its own once work stops, or prompting in a dialog: either
    interrupts the person. A line they can act on, or ignore until they
    quit, doesn't.
  - Installing on quit only when nothing runs: Squirrel puts an update in
    place ahead of time and installs it on any quit; holding it back to
    quit time would make quitting wait for a 370 MB unpack.
  - A feed of our own, or channels (stable and beta), and an adapter track
    apart from the app: more to run before there is a reason. See
    **Revisit when**.
  - Releasing from Balazs's Mac alone: no secrets in CI, but every release
    needs that machine and its keychain, and nobody else can ship.
  - Secrets in the repository rather than an environment: any workflow on
    any branch could read them, with no one approving.
  - Each platform publishing from its own workflow, as PR #78 began: those
    would race to make the release, and publish it before the Mac's files
    and a smoke run.
- **Trade-off:**
  - `disable-library-validation` and `allow-unsigned-executable-memory`
    reach Electron's helpers too, since one file serves them all. Since
    ADR-033, each executable has its own.
  - Electron's RunAsNode fuse stays on: the runtime starts the adapters on
    Althar's own binaries as Node (in a packaged app, on Althar Helper),
    with these entitlements. Since ADR-033 the adapters run on a Node the
    app ships, and the fuse is off.
  - The Developer ID's private key and Apple's API key sit in GitHub, behind
    the environment's reviewers. Revoking either means a new secret.
  - A Mac that releases needs the private key in its keychain, which asks
    once before codesign may use it.
  - ARM Linux and ARM Windows (which runs the x64 build emulated) have no
    build of their own. Intel Macs have one since ADR-075.
  - Windows' releases are unsigned until Althar has a certificate: each
    person gets past SmartScreen once, and an update isn't checked against
    a publisher.
  - No rollback: an update that breaks something is fixed by the next one.
    A migration in it can't be undone.
- **Revisit when:** testers need a beta channel; adapters need to update
  without an app release (DEV-46); Windows is signed (the rest of DEV-78); the adapters stop running on Electron's binary, so the helpers can
  drop the agents' entitlements; or a release has to be rolled back.
