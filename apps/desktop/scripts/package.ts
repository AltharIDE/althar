import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'electron-builder'

import { entitlementsFor } from './entitlements.ts'
import { refresh } from './feed.ts'
import { fetchNode, NODE_IN_APP } from './node.ts'
import { NOT_NOTARIZING, notarize, notaryAuth } from './notarize.ts'

/*
 * Packages the desktop app from a build made with `bun run build:package`
 * (so without the end-to-end tests' hooks): on macOS, Althar.app, signed with
 * Althar's Developer ID under the hardened runtime and notarized where the
 * credentials are given, as a dmg and a zip with latest-mac.yml; on Linux,
 * an AppImage, deb and rpm, with latest-linux.yml for AppImage updates. All
 * artifacts go to out/dist (ADR-024). The bundles hold
 * everything but the agent adapters, which run as processes of their own and
 * are found in node_modules, so the app is staged with the bundles, the
 * icons, the menu bar's pictures, and a flat install of the adapters, the
 * speech engine and the updater alone, with the packages that carry the agents' own binaries
 * pinned to the versions the workspace runs, so the app ships what dev and
 * CI tested. Electron comes from the copy already installed, at the version
 * the app is tested on. The adapters run on a Node the app ships in its
 * resources (ADR-033, scripts/node.ts), as Althar's binary doesn't run as
 * Node: its `runAsNode` fuse is off.
 *
 * Signing: every executable in the app is signed on its own, deepest first,
 * with the hardened runtime and a secure timestamp, and given only the
 * entitlements it needs (scripts/entitlements.ts). The identity is ALTHAR_MAC_IDENTITY;
 * else, given CSC_LINK and CSC_KEY_PASSWORD (the certificate and its key as
 * a base64 .p12), the Developer ID electron-builder finds in the keychain of
 * its own it makes of them; else Althar's Developer ID where a keychain has
 * it: in CI, the keychain the release workflow made of the certificate
 * (CSC_KEYCHAIN). Without any, or
 * with ALTHAR_MAC_IDENTITY=-, the app is signed ad hoc, still hardened, and
 * opens only on the Mac that built it; in CI that, or a release without
 * Apple's notary credentials, fails instead. On Linux it makes an AppImage,
 * deb and rpm on the platform it runs on. The staged app includes the agent
 * adapters, speech engine and updater at the versions the workspace runs,
 * so the packages carry what dev and CI tested.
 */

const desktop = join(import.meta.dirname, '..')
const out = join(desktop, 'out')
const stage = join(out, 'stage')
const mac = process.platform === 'darwin'
// The Linux packages are built on Linux: electron-builder has no deb, rpm or AppImage elsewhere, and left to it the three-package check below would fail without saying why.
if (!mac && process.platform !== 'linux') throw new Error(`The Linux packages are built on Linux, not on ${process.platform}.`)
const dist = join(out, 'dist')
const resources = join(desktop, 'resources')
const own = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as {
  readonly productName: string
  readonly version: string
  readonly description: string
  readonly dependencies: Record<string, string>
}

/** Althar's Developer ID Application certificate, by the name electron-builder finds it by. */
const ALTHAR_IDENTITY = 'Balazs Otakomaiya (59A9XM7G7P)'
/** Where updates come from: the repository's GitHub Releases (ADR-024). */
const RELEASES = { provider: 'github', owner: 'AltharIDE', repo: 'althar' } as const

/** The packages the runtime starts as processes, at the versions the app depends on. */
const ADAPTERS = ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp']
/** What the bundles load from node_modules: dictation's speech engine, with its binaries for this platform (ADR-017), and the updater (ADR-024). */
const NATIVE = ['sherpa-onnx-node', 'electron-updater']

/** The packages that carry the agents' binaries, by the adapter that brings each; their platform packages are pinned by them. */
const BINARIES: Record<string, string> = {
  '@openai/codex': '@agentclientprotocol/codex-acp',
  '@anthropic-ai/claude-agent-sdk': '@agentclientprotocol/claude-agent-acp',
}

/** In CI (GitHub Actions sets CI=true), a release is signed and notarized, or it fails. */
const ci = process.env.CI === 'true'

/**
 * Who signs: the identity asked for; else, given a certificate in CSC_LINK,
 * whichever Developer ID electron-builder finds in the keychain it imports
 * it into (undefined); else Althar's where this Mac's keychain has it; else
 * nobody in particular ('-', ad hoc). electron-builder takes a certificate's
 * name without its kind.
 */
const signer = (): string | undefined => {
  const asked = process.env.ALTHAR_MAC_IDENTITY?.trim()
  if (asked !== undefined && asked !== '') return asked.replace(/^Developer ID Application:\s*/, '')
  if (process.env.CSC_LINK !== undefined && process.env.CSC_LINK !== '') return undefined
  const found = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  if (found.includes(`Developer ID Application: ${ALTHAR_IDENTITY}`)) return ALTHAR_IDENTITY
  if (ci) throw new Error('Nothing to sign with: in CI, give the Developer ID certificate as CSC_LINK and CSC_KEY_PASSWORD.')
  process.stdout.write(`This Mac's keychain has no Developer ID Application: ${ALTHAR_IDENTITY}, so the app is signed ad hoc.\n`)
  return '-'
}
const identity = mac ? signer() : undefined
const adHoc = mac && identity === '-'
if (mac && ci && adHoc) throw new Error('A release from CI is signed with a Developer ID, not ad hoc.')
const auth = mac && !adHoc ? notaryAuth(process.env) : null
if (mac && ci && auth === null) throw new Error(NOT_NOTARIZING)
if (mac && !adHoc && auth === null) process.stdout.write(`${NOT_NOTARIZING}\n`)

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
cpSync(join(resources, 'icons'), join(stage, 'resources', 'icons'), { recursive: true, filter: (path) => !path.endsWith('.md') })
cpSync(join(resources, 'tray'), join(stage, 'resources', 'tray'), { recursive: true })
// The default skill catalog, with its licences and THIRD_PARTY.md, as packages/skills built it (its CURATION.md stays in the repository).
cpSync(join(desktop, '..', '..', 'packages', 'skills', 'catalog'), join(stage, 'resources', 'skills-catalog'), {
  recursive: true,
  filter: (path) => !path.endsWith('CURATION.md'),
})
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

// Kept beside the workspace's packages, so it is fetched once, not for every package.
const node = await fetchNode(join(desktop, 'node_modules', '.cache', 'althar-node'))

/*
 * electron-builder gives every executable but Althar's own binary the same
 * entitlements. This signs as it would, with @electron/osx-sign, but gives
 * each its own.
 */
const osxSign = createRequire(createRequire(require.resolve('electron-builder')).resolve('app-builder-lib')).resolve('@electron/osx-sign')
type SignOptions = { readonly app: string; readonly optionsForFile?: (file: string) => Record<string, unknown> }
const signEach = async (options: SignOptions) => {
  const { signAsync } = (await import(pathToFileURL(osxSign).href)) as { signAsync: (options: SignOptions) => Promise<void> }
  await signAsync({
    ...options,
    optionsForFile: (file) => ({
      ...options.optionsForFile?.(file),
      entitlements: [...entitlementsFor(relative(options.app, file), adHoc)],
    }),
  })
}

const electron = dirname(require.resolve('electron/package.json'))
// Electron's own installer is idempotent: it fetches the binary where it is missing and leaves a complete install alone. It runs every time, because bun can install Electron without its postinstall, and a partial extraction can leave the metadata (path.txt, dist/version) without the executable.
execFileSync(process.execPath, ['install.js'], { cwd: electron, stdio: 'inherit' })
const electronVersion = readFileSync(join(electron, 'dist', 'version'), 'utf8').trim()

await build({
  projectDir: stage,
  // Packages are made here; they reach GitHub only through the release workflow, as a draft.
  publish: 'never',
  config: {
    appId: 'dev.althar.app',
    productName: own.productName,
    copyright: 'Althar',
    directories: { output: dist },
    electronVersion,
    electronDist: join(electron, 'dist'),
    // Plain files: the adapters run their own binaries, which can't be started from inside an archive.
    asar: false,
    npmRebuild: false,
    nodeGypRebuild: false,
    /*
     * Nothing may run Althar's binary as Node, or steer it through
     * NODE_OPTIONS or the inspector (ADR-033): the adapters run on the Node
     * the app ships, and need none of these.
     */
    electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false },
    files: ['**/*'],
    // The Node the adapters run on, with its license: `resources/node/bin/node`, where the window's process names it to the runtime.
    extraResources: [{ from: node, to: NODE_IN_APP, filter: ['bin/node', 'LICENSE'] }],
    // The provider written into app-update.yml and the platform's latest*.yml feed; publication itself stays in the release workflow.
    publish: [RELEASES],
    ...(mac
      ? {
          mac: {
            target: [
              { target: 'dmg', arch: ['arm64'] },
              { target: 'zip', arch: ['arm64'] },
            ],
            icon: join(resources, 'icon.icns'),
            category: 'public.app-category.developer-tools',
            ...(identity === undefined ? {} : { identity }),
            hardenedRuntime: true,
            gatekeeperAssess: false,
            sign: signEach,
            notarize: false,
            extendInfo: {
              NSMicrophoneUsageDescription:
                'Althar listens only while you dictate into a message, and turns what you say into text on this Mac.',
              ElectronSquirrelPreventDowngrades: true,
            },
          },
          dmg: { sign: !adHoc },
          afterSign: (context) => {
            if (auth !== null)
              notarize(join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`), auth, join(out, 'notary'))
          },
        }
      : {
          linux: {
            target: ['AppImage', 'deb', 'rpm'],
            icon: join(resources, 'icons', 'cobalt.png'),
            category: 'Development',
            maintainer: 'Althar <hello@althar.ai>',
            synopsis: 'Run software projects with AI coding agents',
            description: 'Althar is an environment for running software projects with AI coding agents.',
            syncDesktopName: true,
          },
          deb: { recommends: ['libappindicator3-1', 'gnome-keyring | kwallet6 | kwallet'] },
          rpm: { fpm: ['--rpm-tag', 'Recommends: gnome-keyring'] },
        }),
  },
})

if (mac) {
  const made = (suffix: string) => join(dist, `${own.productName}-${own.version}-arm64${suffix}`)
  const dmg = made('.dmg')
  if (auth !== null) {
    notarize(dmg, auth, join(out, 'notary'))
    refresh(join(dist, 'latest-mac.yml'), dmg)
  }
  const app = join(dist, process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${own.productName}.app`)
  for (const path of [app, dmg, made('-mac.zip'), join(dist, 'latest-mac.yml')])
    if (!existsSync(path)) throw new Error(`The package is missing ${path}`)
  process.stdout.write(`\n${app}\n${dmg}\n${made('-mac.zip')}\n${join(dist, 'latest-mac.yml')}\n`)
} else {
  const made = readdirSync(dist).filter((name) => /\.(AppImage|deb|rpm)$/.test(name))
  if (made.length < 3) throw new Error(`The packages are missing: only ${made.length} were made (${made.join(', ')})`)
  const feed = join(dist, 'latest-linux.yml')
  if (!existsSync(feed)) throw new Error(`The package is missing ${feed}`)
  for (const name of made) process.stdout.write(`${join(dist, name)}\n`)
  process.stdout.write(`${feed}\n`)
}
