# ADR-023: Signed releases on GitHub, and an app that updates itself

- **Status:** Accepted
- **Date:** 2026-10-11
- **Owner:** Repository maintainers
- **Context:** Althar goes to its first testers on 11 October (DEV-12, DEV-47,
  DEV-62). Until now `bun run package` made an app signed ad hoc, which opens
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
    variables, debugging, or Apple events.
  - **Notarized with notarytool, credentials from the environment.** An App
    Store Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`,
    `APPLE_API_ISSUER`) or a notarytool keychain profile
    (`APPLE_KEYCHAIN_PROFILE`). The signed app is notarized and stapled
    before the dmg and the zip are made of it; then the dmg is notarized and
    stapled too. Every submission's log is kept in `out/notary/`. Without
    credentials nothing is notarized, and the packaging says so.
  - **What a release holds.** For Apple silicon: a dmg to install from, a
    zip with `latest-mac.yml` for the updater, and their blockmaps for
    smaller downloads later.
  - **One command makes a release, another publishes it as a draft.**
    `bun run release` packages, signs, notarizes and checks; `bun run
    release --publish` takes what it made, with the notes in
    `apps/desktop/release-notes/<version>.md`, to a draft GitHub Release for
    `v<version>`. A person publishes the draft after a smoke run of the dmg;
    the tag is made then. Publishing asks for a Developer ID signature,
    notarization (unless told `--unnotarized`), and a clean tree at a commit
    on main as GitHub has it.
  - **One update track, from GitHub Releases.** electron-updater reads
    `latest-mac.yml` from the latest published release and downloads the
    zip it names; Squirrel.Mac takes it only if it is signed as the running
    app is, and puts it in place. Adapters ship inside the app, so an app
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
    stop running on Electron's binary (the runAsNode question).
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
- **Trade-off:**
  - `disable-library-validation` and `allow-unsigned-executable-memory`
    reach Electron's helpers too, since one file serves them all.
  - Electron's RunAsNode fuse stays on: the runtime starts the adapters on
    Althar's own binaries as Node (in a packaged app, on Althar Helper),
    with these entitlements. Settled separately, before launch.
  - Signing needs the Developer ID's private key in the keychain of the Mac
    that builds, and the keychain asks once before codesign may use it.
  - Apple silicon only; Intel, Windows and Linux follow with their packages.
  - No rollback: an update that breaks something is fixed by the next one.
    A migration in it can't be undone.
- **Revisit when:** testers need a beta channel; adapters need to update
  without an app release (DEV-46); Windows and Linux packages land (DEV-77,
  DEV-78); the adapters stop running on Electron's binary, so the helpers can
  drop the agents' entitlements; or a release has to be rolled back.
