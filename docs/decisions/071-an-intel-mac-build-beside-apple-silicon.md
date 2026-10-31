# ADR-071: An Intel Mac build beside Apple silicon's

- **Status:** Accepted
- **Date:** 2026-10-31
- **Amends:** [ADR-024](024-signed-releases-and-updates.md), [ADR-033](033-adapters-on-a-node-of-their-own.md)
- **Owner:** Repository maintainers
- **Context:** ADR-024 shipped the Mac app for Apple silicon alone, and left
  Intel Macs without a build (Linear DEV-72's open question). The person
  wants friends and colleagues on older Macs to install it, so a release now
  carries an Intel build too. Most of the app's ~850 MB is the agents' own
  binaries, Node and Electron, and every one of them comes per processor.
- **Decision:**
  - **Two builds, not one universal app.** `bun run package --arch=arm64,x64`
    stages, packages, signs and notarizes each on its own, with only its own
    processor's Electron, Node, Codex, Claude Code and speech engine: npm
    installs the stage with `--cpu=<arch>`, `scripts/node.ts` fetches that
    processor's Node, and electron-builder fetches the other processor's
    Electron at the same version. A universal app would hold every binary
    twice, about double the download for everyone.
  - **Cross-built on the Apple silicon runner.** The `mac` job of
    `release.yml` builds both on `macos-26`, with the same certificate and
    notary key; nothing in either build is compiled there, only fetched and
    signed, and codesign and notarytool sign and notarize either processor's
    code. No Intel runner.
  - **Every program is checked for its processor.** After packaging, every
    Mach-O file in the app is read with `lipo -archs` (`scripts/archs.ts`);
    one without a slice for the build's processor fails the build.
  - **Names carry the processor:** `Althar-<version>-arm64.dmg` and
    `-arm64-mac.zip`, `Althar-<version>-x64.dmg` and `-x64-mac.zip`, x64's
    too, which electron-builder would leave out. The site and the cask link
    them by name.
  - **One `latest-mac.yml` lists both builds' packages**, joined from the
    two electron-builder writes (`joinFeeds` in `scripts/feed.ts`), its
    `path` Apple silicon's. electron-updater's MacUpdater picks its Mac's
    files by name: on Apple silicon, and in an Intel app under Rosetta, the
    ones with arm64 in their names; on an Intel Mac the others. So an Intel
    Mac never updates to the Apple silicon build, and an Apple silicon Mac
    stays on its own.
  - **Intel's Node may use unsigned executable memory.** On Intel, Node's
    V8 makes its code pages executable with mprotect rather than mapping
    them for JIT, which the hardened runtime refuses without
    `com.apple.security.cs.allow-unsigned-executable-memory`: Node stopped as
    it started. Everything else has the entitlements ADR-033 gives it.
  - **Checked under Rosetta.** `scripts/mac-smoke.ts --arch=x64` runs the
    Intel build's programs and opens the app with `arch -x86_64`, as an Intel
    Mac would, until its first screen finds the agents; the release run runs
    it for both builds before it uploads them.
  - **The cask** gives each processor its own url and sha256 (`arch arm:
    "arm64", intel: "x64"`, `sha256 arm:, intel:`), with no
    `depends_on arch:`; the tap's workflow fills in both dmgs' digests.
  - **The site's Download** gives an Intel Mac Intel's dmg where the browser
    says so (Chromium's `userAgentData`), Apple silicon's otherwise, and
    links the other build under the button.
- **Alternatives considered:**
  - **A universal app.** One file to pick, but twice the size for every Mac.
  - **An Intel runner.** Not needed: nothing is compiled.
    Rosetta stands in for an Intel Mac in the check; a real one is still
    the person's to try.
  - **Two feeds, one per processor.** electron-updater reads one
    `latest-mac.yml` per channel and picks by name; a second feed needs a
    channel per processor and its own updater setting.
- **Trade-off:** a Mac release takes about twice as long, with four
  notarizations. Safari and Firefox never say the chip, so an Intel Mac
  there gets Apple silicon's dmg first and has to take the link under it.
  The Intel build is checked under Rosetta, which is close to, not the
  same as, an Intel Mac.
- **Revisit when:** Apple stops Rosetta, or few enough Intel Macs open
  Althar that the build isn't worth its time.
