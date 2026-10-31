import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium, type Page } from '@playwright/test'

import { LIPO_ARCH, macBuild, wrongArchs } from './archs.ts'

/*
 * The Mac smoke test, for a build bun run package made: every program in the
 * app is for the build's processor, the Node, Codex, Claude Code and speech
 * engine it bundles run on it, and Althar opens on a profile of its own and
 * its first screen finds the agents. For an Intel build on Apple silicon,
 * where no Intel Mac is at hand, all of it runs under Rosetta: `arch -x86_64`
 * starts each program as an Intel Mac would, and ps says Althar's processes
 * are translated. Run from apps/desktop, after bun run package:
 *
 *   node scripts/mac-smoke.ts --arch=x64
 *
 * It leaves a picture of the first screen in out/smoke. It says nothing of
 * signing in, a task, dictation or updating.
 */

const desktop = join(import.meta.dirname, '..')
const { productName, version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as {
  readonly productName: string
  readonly version: string
}
const arch = process.argv.find((arg) => arg.startsWith('--arch='))?.slice('--arch='.length) ?? process.arch
const lipo = LIPO_ARCH[arch]
if (process.platform !== 'darwin' || lipo === undefined) throw new Error(`The Mac smoke test is for an arm64 or x64 build on a Mac.`)
const app = join(desktop, 'out', 'dist', macBuild(productName, version, arch).folder, `${productName}.app`)
if (!existsSync(app)) throw new Error(`No ${app}: run bun run package --arch=${arch} first.`)
const modules = join(app, 'Contents', 'Resources', 'app', 'node_modules')
const node = join(app, 'Contents', 'Resources', 'node', 'bin', 'node')

let failed = 0
const ok = (line: string) => process.stdout.write(`PASS: ${line}\n`)
const bad = (line: string) => {
  failed += 1
  process.stdout.write(`FAIL: ${line}\n`)
}
/** A program, started as a Mac with the build's processor starts it: under Rosetta for x64 on Apple silicon, which translates a large library slowly the first time. */
const runAs = (program: string, list: ReadonlyArray<string>) =>
  execFileSync('arch', [`-${lipo}`, program, ...list], { encoding: 'utf8', timeout: 600_000 }).trim()
const tryTo = (what: string, run: () => string) => {
  try {
    ok(`${what}: ${run()}`)
  } catch (error) {
    bad(`${what}: ${String(error)}`)
  }
}

const { read, wrong } = wrongArchs(app, arch)
if (wrong.length === 0) ok(`all ${read} Mach-O files have ${lipo}`)
else for (const { path, archs } of wrong) bad(`${path} is ${archs.join(' ')}, not ${lipo}`)

// 1 on Apple silicon, even read under Rosetta; nothing on an Intel Mac.
const appleSilicon = execFileSync('sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1'
process.stdout.write(`This Mac is ${appleSilicon ? 'Apple silicon' : 'Intel'}; the build is ${arch}.\n`)
tryTo('Node', () => runAs(node, ['--version']))
const triple = arch === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin'
tryTo('Codex', () => runAs(join(modules, '@openai', `codex-darwin-${arch}`, 'vendor', triple, 'bin', 'codex'), ['--version']))
tryTo('Claude Code', () => runAs(join(modules, '@anthropic-ai', `claude-agent-sdk-darwin-${arch}`, 'claude'), ['--version']))

/*
 * The speech engine's addon is Node-API, so the app's Node loads it as
 * Electron's utility process does. Signed ad hoc, nothing in the app has a
 * team for library validation to match, so the Node, which may load only
 * its own team's libraries, can't load the engine's (Electron's processes
 * may load any there): it is loaded with a copy of the Node that may.
 */
// codesign describes a signature on stderr.
const signature = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' })
const adHoc = !/^TeamIdentifier=(?!not set)/m.test(`${signature.stdout}${signature.stderr}`)
const loader = (() => {
  if (!adHoc) return node
  const scratch = mkdtempSync(join(tmpdir(), 'althar-smoke-node-'))
  const copy = join(scratch, 'node')
  copyFileSync(node, copy)
  const entitlements = join(scratch, 'entitlements.plist')
  const keys = ['allow-jit', 'allow-unsigned-executable-memory', 'disable-library-validation']
  writeFileSync(
    entitlements,
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>${keys.map((key) => `<key>com.apple.security.cs.${key}</key><true/>`).join('')}</dict></plist>\n`,
  )
  execFileSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', entitlements, copy], { stdio: 'pipe' })
  process.stdout.write('The app is signed ad hoc: the speech engine is loaded with a copy of its Node that may load any library.\n')
  return copy
})()
tryTo('the speech engine loads', () =>
  runAs(loader, [
    '-e',
    "console.log(typeof require(process.argv[1]).OfflineRecognizer === 'function' ? 'yes' : 'no')",
    join(modules, 'sherpa-onnx-node'),
  ]),
)

// Althar itself, on a profile of its own, with the window reachable over Chromium's debugging port (the Node inspector's flags are off).
const profile = mkdtempSync(join(tmpdir(), 'althar-smoke-'))
const port = 9300 + Math.floor(Math.random() * 500)
const started = spawn('arch', [`-${lipo}`, join(app, 'Contents', 'MacOS', productName), `--remote-debugging-port=${port}`], {
  env: { ...process.env, ALTHAR_PROFILE: profile, ALTHAR_WORKTREES: join(profile, 'worktrees') },
  stdio: 'ignore',
})
// Rosetta translates each program the first time it runs, which takes minutes for Electron on a busy Mac.
const opening = arch === 'x64' && appleSilicon ? 900 : 120
const until = async (what: string, done: () => boolean | Promise<boolean>, seconds = opening) => {
  for (let i = 0; i < seconds; i += 1) {
    if (
      await Promise.resolve()
        .then(done)
        .catch(() => false)
    )
      return true
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  bad(`${what}, after ${seconds} s`)
  return false
}
try {
  const log = join(profile, 'logs', 'runtime.log')
  if (await until("Althar's runtime didn't get ready", () => existsSync(log) && readFileSync(log, 'utf8').includes('Runtime ready')))
    ok('Althar opens and its runtime is ready')
  if (
    !(await until('Chromium never answered on its debugging port', async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok))
  )
    throw new Error('Althar has no window to read.')
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  // Althar's window, among the menu bar's: the one whose first screen lists the agents, once it has found them.
  const agentsIn = (page: Page) => page.getByRole('list', { name: /^Agents on / }).getByRole('listitem')
  let page: Page | undefined
  await until('the first screen found no agent', async () => {
    for (const each of browser.contexts().flatMap((context) => context.pages())) if ((await agentsIn(each).count()) > 0) page = each
    return page !== undefined
  })
  if (page === undefined) bad('no window of Althar’s shows its first screen')
  else {
    ok(`the first screen finds ${(await agentsIn(page).allInnerTexts()).map((row) => row.split('\n')[0]).join(', ')}`)
    // Rosetta marks the processes it translates (P_TRANSLATED in ps's flags); Chromium's own answer names the Mac's chip, not the app's.
    const translated = execFileSync('ps', ['-axo', 'flags=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.includes(app))
      .map((line) => (Number.parseInt(line.trim().split(/\s+/)[0] ?? '0', 16) & 0x20000) !== 0)
    const rosetta = arch === 'x64' && appleSilicon
    if (translated.length > 0 && translated.every((it) => it === rosetta))
      ok(`all ${translated.length} of Althar's processes run ${rosetta ? 'under Rosetta, as on an Intel Mac' : 'natively'}`)
    else bad(`of Althar's ${translated.length} processes, ${translated.filter(Boolean).length} run under Rosetta`)
    const shots = join(desktop, 'out', 'smoke')
    mkdirSync(shots, { recursive: true })
    const shot = join(shots, `first-screen-${arch}.png`)
    await page.screenshot({ path: shot, scale: 'css' })
    process.stdout.write(`${shot}\n`)
  }
  await browser.close().catch(() => undefined)
} catch (error) {
  bad(String(error))
} finally {
  started.kill()
  rmSync(profile, { recursive: true, force: true })
}

process.stdout.write(failed === 0 ? `\nThe ${arch} build passes.\n` : `\n${failed} failed.\n`)
process.exit(failed === 0 ? 0 : 1)
