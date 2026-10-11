import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Cutting a release (ADR-023, Linear DEV-62), in two steps, each asked for
 * on its own:
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
const assets = [dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`, feed]

const args = new Set(process.argv.slice(2))
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

/** Checks what was made, and says how it stands. */
const check = () => {
  for (const path of [app, ...assets]) if (!existsSync(path)) fail(`${path} is missing. Run \`bun run release\` first.`)
  const fed = readFileSync(feed, 'utf8')
  if (!fed.startsWith(`version: ${version}\n`)) fail(`latest-mac.yml isn't for ${version}:\n${fed}`)
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
  if (branch !== 'main' || dirty)
    say(`Packaging ${version} from ${branch}${dirty ? ', with changes not committed' : ''}: fine to try, not to publish.`)
  const packaged = spawnSync('bun', ['run', 'package'], { cwd: desktop, stdio: 'inherit' })
  if (packaged.status !== 0) fail('Packaging failed; see above.')
  check()
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
