import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { build } from 'electron-builder'

/*
 * Packages the desktop app from a build made with `bun run build:package`
 * (so without the end-to-end tests' hooks): Althar.app on macOS, and
 * AppImage, deb and rpm on Linux, built on the platform it runs on. The
 * bundles hold everything but the agent adapters, which run as processes of
 * their own and are found in node_modules, so the app is staged with the
 * bundles, the icons, the menu bar's pictures, and a flat install of the adapters and the speech engine alone, with the
 * packages that carry the agents' own binaries pinned to the versions the
 * workspace runs, so the app ships what dev and CI tested. Electron comes
 * from the copy already installed, at the version the app is tested on.
 * There is no Developer ID yet: on macOS the app is signed ad hoc, which
 * runs on the Mac that built it; it is signed only there.
 */

const desktop = join(import.meta.dirname, '..')
const out = join(desktop, 'out')
const stage = join(out, 'stage')
const mac = process.platform === 'darwin'
// The Linux packages are built on Linux: electron-builder has no deb, rpm or AppImage elsewhere, and left to it the three-package check below would fail without saying why.
if (!mac && process.platform !== 'linux') throw new Error(`The Linux packages are built on Linux, not on ${process.platform}.`)
const own = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as {
  readonly productName: string
  readonly version: string
  readonly description: string
  readonly dependencies: Record<string, string>
}

/** The packages the runtime starts as processes, at the versions the app depends on. */
const ADAPTERS = ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp']
/** Native addons the bundles load from node_modules: dictation's speech engine, with its binaries for this platform (ADR-017). */
const NATIVE = ['sherpa-onnx-node']

/** The packages that carry the agents' binaries, by the adapter that brings each; their platform packages are pinned by them. */
const BINARIES: Record<string, string> = {
  '@openai/codex': '@agentclientprotocol/codex-acp',
  '@anthropic-ai/claude-agent-sdk': '@agentclientprotocol/claude-agent-acp',
}

const require = createRequire(import.meta.url)
const versionAt = (path: string) => (JSON.parse(readFileSync(path, 'utf8')) as { readonly version: string }).version

/**
 * A package's version as the workspace has it, found from the adapter that
 * depends on it, as Node would find it: what dev and CI run. By the folders
 * Node looks in, since not every package lets its package.json be resolved.
 */
const installed = (name: string, adapter: string) => {
  const folders = createRequire(require.resolve(`${adapter}/package.json`)).resolve.paths(name) ?? []
  const found = folders.map((folder) => join(folder, name, 'package.json')).find((path) => existsSync(path))
  if (found === undefined) throw new Error(`The workspace has no ${name} for ${adapter}`)
  return versionAt(found)
}
const pinned = Object.fromEntries(Object.entries(BINARIES).map(([name, adapter]) => [name, installed(name, adapter)]))

rmSync(out, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(join(desktop, 'dist'), join(stage, 'dist'), { recursive: true, filter: (path) => !path.endsWith('.map') })
cpSync(join(desktop, 'resources', 'icons'), join(stage, 'resources', 'icons'), { recursive: true, filter: (path) => !path.endsWith('.md') })
cpSync(join(desktop, 'resources', 'tray'), join(stage, 'resources', 'tray'), { recursive: true })
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'althar',
      productName: own.productName,
      version: own.version,
      description: own.description,
      homepage: 'https://althar.ai',
      // Electron uses this as the window's app_id/WM_CLASS on Linux; kept the .desktop file's name, so windows associate with the entry.
      desktopName: 'althar.desktop',
      type: 'module',
      main: 'dist/main/main.js',
      dependencies: Object.fromEntries([...ADAPTERS, ...NATIVE].map((name) => [name, own.dependencies[name]])),
      overrides: pinned,
    },
    null,
    2,
  )}\n`,
)
// npm, for a flat node_modules the adapters' own lookups find their way through.
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: stage, stdio: 'inherit' })
for (const [name, version] of Object.entries(pinned)) {
  const staged = versionAt(join(stage, 'node_modules', name, 'package.json'))
  if (staged !== version) throw new Error(`The package has ${name} ${staged}, but the workspace runs ${version}`)
}

const electron = dirname(require.resolve('electron/package.json'))
// Electron's own installer is idempotent: it fetches the binary where it is missing and leaves a complete install alone. It runs every time, because bun can install Electron in CI without its postinstall, and a partial extraction can leave the metadata (path.txt, dist/version) without the executable.
execFileSync(process.execPath, ['install.js'], { cwd: electron, stdio: 'inherit' })
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
    /*
     * Nothing may steer Althar's binary through NODE_OPTIONS or the inspector:
     * the adapters use neither. Running as Node stays on, since that is how
     * the runtime starts them (see the README's "The packaged app: not done yet").
     */
    electronFuses: { enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false },
    files: ['**/*'],
    ...(mac
      ? {
          mac: {
            target: [{ target: 'dir' }],
            icon: join(desktop, 'resources', 'icon.icns'),
            category: 'public.app-category.developer-tools',
            identity: null,
            // What macOS shows as it asks for the microphone, the first time someone dictates.
            extendInfo: {
              NSMicrophoneUsageDescription:
                'Althar listens only while you dictate into a message, and turns what you say into text on this Mac.',
            },
          },
        }
      : {
          linux: {
            target: ['AppImage', 'deb', 'rpm'],
            icon: join(desktop, 'resources', 'icons', 'cobalt.png'),
            category: 'Development',
            maintainer: 'Althar <hello@althar.ai>',
            synopsis: 'Run software projects with AI coding agents',
            description: 'Althar is an environment for running software projects with AI coding agents.',
            // The .desktop file is named after desktopName, and its StartupWMClass follows it, matching the window's app_id.
            syncDesktopName: true,
          },
          // Sign-ins need a keyring to be sealed with (main/keyring.ts); electron-builder's own recommends list is replaced by this one.
          deb: {
            recommends: ['gnome-keyring | kwallet6 | kwallet'],
          },
          rpm: {
            // The rpm target has no recommends field: fpm's own tag carries the same hint, as a suggestion, not a requirement.
            fpm: ['--rpm-tag', 'Recommends: gnome-keyring'],
          },
        }),
  },
})

if (mac) {
  // electron-builder names the folder for the architecture, but for Intel's.
  const app = join(out, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${own.productName}.app`)
  // The microphone's entitlement, for when the app runs hardened: dictation records with it.
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--entitlements', join(desktop, 'resources', 'entitlements.mac.plist'), app],
    {
      stdio: 'inherit',
    },
  )
  process.stdout.write(`\n${app}\n`)
} else {
  const made = readdirSync(join(out, 'dist')).filter((name) => /\.(AppImage|deb|rpm)$/.test(name))
  if (made.length < 3) throw new Error(`The packages are missing: only ${made.length} were made (${made.join(', ')})`)
  for (const name of made) process.stdout.write(`${join(out, 'dist', name)}\n`)
}
