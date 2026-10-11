import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { mismatches } from './feed.ts'

/*
 * Cutting a release (ADR-023, Linear DEV-62 and DEV-81). Releases come from
 * CI: .github/workflows/release.yml runs the first step below on a version
 * tag, with the certificate and Apple's credentials from the release
 * environment, and makes the draft itself. This script is also the way to
 * cut one from a Mac when CI can't, in two steps, each asked for on its own:
 *
 *   bun run release            packages, signs, notarizes and staples where
 *                              the credentials are given, makes the dmg, the
 *                              zip and latest-mac.yml in out/dist, and checks
 *                              them;
 *   bun run release --publish  takes those, as they are, to a draft GitHub
 *                              Release for v<version>, with the notes in
 *                              release-notes/<version>.md.
 *
 * Nothing reaches anyone until the draft is published on GitHub, after a
 * smoke run of the dmg: the updater and the site's Download read only
 * published releases. Publishing asks for a clean tree at a commit on main
 * as GitHub has it, a Developer ID signature, and notarization (--unnotarized to go
 * without, for a build that would only open where Gatekeeper is told to).
 *
 * In CI (CI=true) the first step is the whole of it, and strict: anything
 * but an app signed with a Developer ID, notarized, with its dmg stapled and
 * both accepted by Gatekeeper, fails the run.
 */

const REPOSITORY = 'AltharIDE/althar'

const desktop = join(import.meta.dirname, '..')
const dist = join(desktop, 'out', 'dist')
const { productName, version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as {
  readonly productName: string
  readonly version: string
}
const tag = `v${version}`
const app = join(dist, 'mac-arm64', `${productName}.app`)
const dmg = join(dist, `${productName}-${version}-arm64.dmg`)
const zip = join(dist, `${productName}-${version}-arm64-mac.zip`)
const feed = join(dist, 'latest-mac.yml')
const notes = join(desktop, 'release-notes', `${version}.md`)
const built = join(dist, 'build.json')
const assets = [dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`, feed]

const args = new Set(process.argv.slice(2))
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

if (!args.has('--publish')) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  const dirty = git('status', '--porcelain') !== ''
  if (!ci && (branch !== 'main' || dirty))
    say(`Packaging ${version} from ${branch}${dirty ? ', with changes not committed' : ''}: fine to try, not to publish.`)
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
    process.exit(0)
  }
  say(`\nNext: open the dmg, smoke-test Althar ${version}, write ${notes} if it isn't there, then \`bun run release --publish\`.`)
  process.exit(0)
}

// Publishing: what was made, as it is, to a draft release.
check()
const signedBy = signer()
if (!signedBy.startsWith('Developer ID Application:'))
  fail(`The app is signed by ${signedBy}, not a Developer ID: macOS would refuse it anywhere else.`)
if (!stapled() && !args.has('--unnotarized'))
  fail(
    'The dmg is not notarized, so macOS refuses it as it is downloaded. Notarize it (see the README), or pass --unnotarized to publish it anyway.',
  )
if (!existsSync(notes)) fail(`Write the release notes first, a few plain lines for testers: ${notes}`)
if (git('status', '--porcelain') !== '') fail('The tree has changes not committed: publish what a commit holds.')
const commit = git('rev-parse', 'HEAD')
// What was built, from where: the packages in out/dist outlive a checkout, so they must be this commit's, made clean.
if (!existsSync(built)) fail(`${built} is missing: package again with \`bun run release\`.`)
const from = JSON.parse(readFileSync(built, 'utf8')) as { readonly version?: string; readonly commit?: string; readonly dirty?: boolean }
if (from.version !== version || from.commit !== commit || from.dirty !== false)
  fail(
    `The packages were made from ${from.commit?.slice(0, 7) ?? 'an unknown commit'}${from.dirty === false ? '' : ' with changes not committed'}, not from ${commit.slice(0, 7)} as it is: package again here.`,
  )
if (!run('git', ['merge-base', '--is-ancestor', commit, 'origin/main']).ok)
  fail(`${commit.slice(0, 7)} isn't on main as GitHub has it: publish from main, pushed.`)
if (!run('gh', ['auth', 'status']).ok) fail('gh is not signed in: `gh auth login`.')
if (run('gh', ['release', 'view', tag, '--repo', REPOSITORY]).ok) fail(`${REPOSITORY} already has a release ${tag}.`)

execFileSync(
  'gh',
  [
    'release',
    'create',
    tag,
    '--repo',
    REPOSITORY,
    '--draft',
    '--target',
    commit,
    '--title',
    `${productName} ${version}`,
    '--notes-file',
    notes,
    ...assets,
  ],
  { stdio: 'inherit' },
)
say(`\nA draft release ${tag} is on GitHub, at ${commit.slice(0, 7)}. Smoke-test its dmg, then publish it there: the tag is made then.`)
