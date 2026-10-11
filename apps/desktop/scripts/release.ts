import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { mismatches } from './feed.ts'

/*
 * Building a release (ADR-024, Linear DEV-62 and DEV-81). Releases are
 * published from CI alone: .github/workflows/release.yml runs this on a
 * version tag, with the certificate and Apple's credentials from the release
 * environment, then makes the draft GitHub Release itself.
 *
 *   bun run release   packages, signs, notarizes and staples where the
 *                     credentials are given, makes the dmg, the zip and
 *                     latest-mac.yml in out/dist, and checks them: the feed
 *                     against the packages, and the app inside the zip.
 *
 * On a Mac it is for trying a release before tagging it. In CI (CI=true) it
 * is strict: anything but an app signed with a Developer ID, notarized, with
 * its dmg stapled and both accepted by Gatekeeper, fails the run.
 */

const desktop = join(import.meta.dirname, '..')
const dist = join(desktop, 'out', 'dist')
const { productName, version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as {
  readonly productName: string
  readonly version: string
}
const app = join(dist, 'mac-arm64', `${productName}.app`)
const dmg = join(dist, `${productName}-${version}-arm64.dmg`)
const zip = join(dist, `${productName}-${version}-arm64-mac.zip`)
const feed = join(dist, 'latest-mac.yml')
const assets = [dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`, feed]

const ci = process.env.CI === 'true'
const say = (line: string) => process.stdout.write(`${line}\n`)
const fail = (why: string): never => {
  process.stderr.write(`\n${why}\n`)
  process.exit(1)
}
/** A command's output, or what it said as it failed: for the checks, which report rather than throw. */
const run = (command: string, list: ReadonlyArray<string>) => {
  const done = spawnSync(command, list, { encoding: 'utf8' })
  return { ok: done.status === 0, said: `${done.stdout}${done.stderr}`.trim() }
}
const git = (...list: ReadonlyArray<string>) => execFileSync('git', list, { cwd: desktop, encoding: 'utf8' }).trim()

/** Who signed the app: its Developer ID, or ad hoc. */
const signer = () => /^Authority=(.+)$/m.exec(run('codesign', ['-dvv', app]).said)?.[1] ?? 'nobody (ad hoc)'
/** Whether a ticket is stapled to the dmg. */
const stapled = () => run('xcrun', ['stapler', 'validate', dmg]).ok

/**
 * The app inside the zip, which is what the updater installs: unpacked, it
 * must hold its signature, be Althar at this version, and, where the release
 * is notarized, carry its ticket.
 */
const checkZipped = (notarized: boolean) => {
  const into = mkdtempSync(join(tmpdir(), 'althar-zip-'))
  try {
    execFileSync('ditto', ['-x', '-k', zip, into])
    const inside = join(into, `${productName}.app`)
    if (!existsSync(inside)) fail(`${basename(zip)} holds no ${productName}.app.`)
    const verified = run('codesign', ['--verify', '--deep', '--strict', inside])
    if (!verified.ok) fail(`The app in ${basename(zip)} doesn't hold its signature:\n${verified.said}`)
    const plist = join(inside, 'Contents', 'Info.plist')
    const read = (key: string) => run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).said
    if (read('CFBundleIdentifier') !== 'dev.althar.app') fail(`The app in ${basename(zip)} isn't dev.althar.app.`)
    if (read('CFBundleShortVersionString') !== version) fail(`The app in ${basename(zip)} isn't ${version}.`)
    if (notarized && !run('xcrun', ['stapler', 'validate', inside]).ok) fail(`The app in ${basename(zip)} has no notarization ticket.`)
  } finally {
    rmSync(into, { recursive: true, force: true })
  }
}

/** Checks what was made, and says how it stands. */
const check = () => {
  for (const path of [app, ...assets]) if (!existsSync(path)) fail(`${path} is missing. Run \`bun run release\` first.`)
  const fed = readFileSync(feed, 'utf8')
  if (!fed.startsWith(`version: ${version}\n`)) fail(`latest-mac.yml isn't for ${version}:\n${fed}`)
  const wrong = mismatches(fed, dist, [basename(zip), basename(dmg)])
  if (wrong.length > 0) fail(`latest-mac.yml doesn't match the packages:\n${wrong.join('\n')}`)
  checkZipped(stapled())
  const verified = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  if (!verified.ok) fail(`The app's signature doesn't hold:\n${verified.said}`)
  say(`\nSigned by ${signer()}; codesign --verify --deep --strict passes.`)
  say(`Gatekeeper on the app: ${run('spctl', ['-a', '-vvv', '-t', 'exec', app]).said}`)
  say(`Gatekeeper on the dmg: ${run('spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', dmg]).said}`)
  say(stapled() ? 'The dmg has its notarization ticket.' : 'The dmg is not notarized.')
  for (const path of assets) say(`  ${path}`)
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
const dirty = git('status', '--porcelain') !== ''
if (!ci && (branch !== 'main' || dirty)) say(`Packaging ${version} from ${branch}${dirty ? ', with changes not committed' : ''}, to try.`)
const packaged = spawnSync('bun', ['run', 'package'], { cwd: desktop, stdio: 'inherit' })
if (packaged.status !== 0) fail('Packaging failed; see above.')
check()
if (ci) {
  const signedBy = signer()
  if (!signedBy.startsWith('Developer ID Application:')) fail(`The app is signed by ${signedBy}, not a Developer ID.`)
  if (!stapled()) fail('The dmg has no notarization ticket stapled to it.')
  for (const [what, list] of [
    ['app', ['-a', '-t', 'exec', app]],
    ['dmg', ['-a', '-t', 'open', '--context', 'context:primary-signature', dmg]],
  ] as const)
    if (!run('spctl', list).ok) fail(`Gatekeeper refuses the ${what}.`)
  say(`\nAlthar ${version}: signed by ${signedBy}, notarized, and accepted by Gatekeeper.`)
} else say(`\nOpen the dmg and try Althar ${version}. Releases are published from CI: tag v${version} on main (see the README).`)
