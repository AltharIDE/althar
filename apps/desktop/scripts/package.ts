import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { build } from 'electron-builder'

/*
 * Packages the desktop app as Althar.app, from a build made with
 * `bun run build:package` (so without the end-to-end tests' hooks). The
 * bundles hold everything but the agent adapters, which run as processes of
 * their own and are found in node_modules, so the app is staged with the
 * bundles, the icons, and a flat install of the adapters alone. Electron
 * comes from the copy already installed, at the version the app is tested
 * on. There is no Developer ID yet: the app is signed ad hoc, which runs on
 * the Mac that built it.
 */

const desktop = join(import.meta.dirname, '..')
const out = join(desktop, 'out')
const stage = join(out, 'stage')
const own = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as {
  readonly productName: string
  readonly version: string
  readonly description: string
  readonly dependencies: Record<string, string>
}

/** The packages the runtime starts as processes, at the versions the app depends on. */
const ADAPTERS = ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp']

rmSync(out, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(join(desktop, 'dist'), join(stage, 'dist'), { recursive: true, filter: (path) => !path.endsWith('.map') })
cpSync(join(desktop, 'resources', 'icons'), join(stage, 'resources', 'icons'), { recursive: true, filter: (path) => !path.endsWith('.md') })
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'althar',
      productName: own.productName,
      version: own.version,
      description: own.description,
      type: 'module',
      main: 'dist/main/main.js',
      dependencies: Object.fromEntries(ADAPTERS.map((name) => [name, own.dependencies[name]])),
    },
    null,
    2,
  )}\n`,
)
// npm, for a flat node_modules the adapters' own lookups find their way through.
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: stage, stdio: 'inherit' })

const require = createRequire(import.meta.url)
const electron = dirname(require.resolve('electron/package.json'))
const electronVersion = readFileSync(join(electron, 'dist', 'version'), 'utf8').trim()

await build({
  projectDir: stage,
  config: {
    appId: 'dev.althar.app',
    productName: own.productName,
    copyright: 'Althar',
    directories: { output: join(out, 'dist') },
    electronVersion,
    electronDist: join(electron, 'dist'),
    // Plain files: the adapters run their own binaries, which can't be started from inside an archive.
    asar: false,
    npmRebuild: false,
    nodeGypRebuild: false,
    files: ['**/*'],
    mac: {
      target: [{ target: 'dir' }],
      icon: join(desktop, 'resources', 'icon.icns'),
      category: 'public.app-category.developer-tools',
      identity: null,
    },
  },
})

// electron-builder names the folder for the architecture, but for Intel's.
const app = join(out, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${own.productName}.app`)
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
process.stdout.write(`\n${app}\n`)
