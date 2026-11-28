import { type Dirent, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { parseRemote, type Product, products } from '@althar/connectors'
import { runsOutside } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from './Instance'
import { recordedOf } from './recordedSetup'
import { installIn, managerIn, manifestsIn, runOf, scriptsIn } from './runCommand'
import { cachesOf, TOOL_PLACES } from './toolPlaces'

/*
 * What a lead's sandbox lets through from the start (docs/architecture/03):
 * the commands that run outside it rather than failing inside it first, as a
 * browser, Electron or a test runner does on a Mac, and the hosts it reaches
 * without asking, as a clone, a fetch from the code host or an install from
 * a registry otherwise does, one host at a time. Neither lets through what
 * the rules wouldn't: a command outside the sandbox still asks and meets the
 * project's rules, as it would on its second try, and a host is let through
 * only where the rules would let it through without anyone (Sessions).
 *
 * Both are worked out from the project: the tools its repositories' packages
 * name and their test scripts, what is kept for how it runs and is set up,
 * the code hosts its repositories are on, the registries its package
 * managers fetch from, and the trackers Althar is connected to. Beside
 * them, the caches the tools it installs with write to, and the hosts they
 * download from, which `toolPlaces.ts` lists. The person
 * adds to them and takes from them in the project's rules, and what they
 * changed holds over what is worked out later.
 */

/**
 * What a lead's sandbox lets through from the start: commands it runs
 * outside it, hosts it reaches without asking, and the tools' caches it
 * writes to (`toolPlaces.ts`).
 */
export interface Reach {
  readonly commands: ReadonlyArray<string>
  readonly hosts: ReadonlyArray<string>
  readonly deniedHosts?: ReadonlyArray<string>
  readonly writes: ReadonlyArray<string>
}

/** What the person added to a list Althar works out, and took from it. */
export interface Edits {
  readonly added: ReadonlyArray<string>
  readonly removed: ReadonlyArray<string>
}

const SERVERS_AND_TESTS = [
  'vite',
  'next dev',
  'next start',
  'astro dev',
  'nuxt dev',
  'storybook dev',
  'webpack serve',
  'react-scripts start',
  'vitest',
  'jest',
  'playwright',
  'electron',
  'vp dev',
  'vp test',
]

const MACOS_COMMANDS = ['open', 'osascript', 'docker', 'docker-compose']

/**
 * Default reach even without a repository match. Seatbelt blocks process
 * listing with `ps`, Launch Services and Apple Events, and container daemon
 * sockets. Desktop tests use `env -i` to start with a clean environment.
 */
export const ALWAYS: ReadonlyArray<string> = [
  'ps',
  'env -i',
  ...(process.platform === 'darwin' ? MACOS_COMMANDS : []),
  ...SERVERS_AND_TESTS.flatMap((command) => [command, ...['npx', 'bunx', 'pnpm exec', 'yarn'].map((runner) => `${runner} ${command}`)]),
  ...['npm', 'pnpm', 'yarn'].flatMap((manager) =>
    ['dev', 'start', 'test'].flatMap((script) => [`${manager} run ${script}`, `${manager} ${script}`]),
  ),
]

/** Tools a package names that start a browser, Electron or a test runner, which a Mac's sandbox stops: by the packages that bring them. */
const TOOLS: ReadonlyArray<{ readonly packages: ReadonlyArray<string>; readonly bin: string }> = [
  { packages: ['@playwright/test', 'playwright', 'playwright-core'], bin: 'playwright' },
  { packages: ['electron'], bin: 'electron' },
  { packages: ['vitest'], bin: 'vitest' },
  { packages: ['jest'], bin: 'jest' },
]

/** How each package manager runs a package's own command. */
const RUNNERS: Readonly<Record<string, string>> = { bun: 'bunx', npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn' }

const GRADLE_FILES = ['gradlew', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
const ANDROID_FILES = ['app/src/main/AndroidManifest.xml', 'src/main/AndroidManifest.xml']
const DEPENDENCY_DIRS = new Set(['node_modules', 'Pods', 'vendor'])

const hasFile = (folder: string, files: ReadonlyArray<string>) => files.some((file) => existsSync(join(folder, file)))

const entriesIn = (folder: string) => {
  try {
    return readdirSync(folder, { withFileTypes: true })
  } catch {
    return []
  }
}

const isIosProject = (entries: ReadonlyArray<Dirent>) =>
  entries.some(
    (entry) =>
      (entry.name === 'Podfile' && (entry.isFile() || entry.isSymbolicLink())) ||
      (entry.isDirectory() && /\.(xcodeproj|xcworkspace)$/.test(entry.name)),
  )

const projectDirectory = (entry: Dirent) => entry.isDirectory() && !entry.name.startsWith('.') && !DEPENDENCY_DIRS.has(entry.name)

/** A native checkout, a named app folder, or a project under ios/, such as ios/App. */
const hasIosProject = (folder: string) => {
  const entries = entriesIn(folder)
  return (
    isIosProject(entries) ||
    entries.filter(projectDirectory).some((entry) => {
      const child = join(folder, entry.name)
      const children = entriesIn(child)
      return (
        isIosProject(children) ||
        children.some(
          (sub) => (entry.name === 'ios' || sub.name === 'ios') && projectDirectory(sub) && isIosProject(entriesIn(join(child, sub.name))),
        )
      )
    })
  )
}

/** Native tools that need macOS services or their normal build caches, by the projects that use them. */
const nativeReachIn = (folder: string, root: string, packages: ReadonlySet<string>, runner: string) => {
  const folders = [...new Set([folder, root])]
  const androidFolders = folders.map((at) => join(at, 'android'))
  const expo = packages.has('expo')
  const reactNative = packages.has('@react-native-community/cli') || (!expo && packages.has('react-native'))
  const capacitorIos = packages.has('@capacitor/ios')
  const capacitorAndroid = packages.has('@capacitor/android')
  const ios = expo || reactNative || capacitorIos || packages.has('react-native-macos') || folders.some(hasIosProject)
  const android =
    expo ||
    reactNative ||
    capacitorAndroid ||
    folders.some((at) => hasFile(at, ANDROID_FILES)) ||
    androidFolders.some((at) => hasFile(at, [...GRADLE_FILES, ...ANDROID_FILES]))
  const gradle = android || folders.some((at) => hasFile(at, GRADLE_FILES))
  const withRunners = (commands: ReadonlyArray<string>) =>
    commands.flatMap((command) => [command, `npx ${command}`, `${runner} ${command}`])
  const capacitor = [
    ...(capacitorIos ? ['run ios'] : []),
    ...(capacitorAndroid ? ['run android'] : []),
    ...(capacitorIos || capacitorAndroid ? ['sync'] : []),
  ]
  const commands = [
    ...(ios ? ['xcrun simctl', 'xcodebuild', 'pod install', 'bundle exec pod install', 'xcrun devicectl', 'xcrun xctrace'] : []),
    ...(android ? ['emulator'] : []),
    ...(gradle ? ['gradle', './gradlew'] : []),
    ...(android ? ['./android/gradlew'] : []),
    ...(expo ? withRunners(['expo run:ios', 'expo run:android']) : []),
    ...(reactNative ? withRunners(['react-native', 'rnc-cli'].flatMap((bin) => [`${bin} run-ios`, `${bin} run-android`])) : []),
    ...(reactNative ? ['npx @react-native-community/cli run-ios', 'npx @react-native-community/cli run-android'] : []),
    ...withRunners(capacitor.map((command) => `cap ${command}`)),
  ]
  return { commands, ios, android }
}

/** A script that runs tests or drives a browser, by its name: `test`, `test:e2e`, `e2e`, `playwright`. */
const testing = (name: string) => /^(dev|start|serve|test)(:|$)/.test(name) || /e2e|playwright|screenshot/.test(name)

const nativeScript = (name: string, native: ReturnType<typeof nativeReachIn> | undefined) =>
  (native?.ios === true && /^ios(:|$)/.test(name)) || (native?.android === true && /^android(:|$)/.test(name))

const recordOf = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}

/** Every package a package.json depends on, by name. */
const dependenciesOf = (manifest: Readonly<Record<string, unknown>>) =>
  new Set([manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies].flatMap((field) => Object.keys(recordOf(field))))

/** Every package the package.json in `folder` and its workspaces' depend on. */
const packagesIn = (folder: string) => new Set(manifestsIn(folder).flatMap((manifest) => [...dependenciesOf(manifest)]))

/** A line's words with single spaces. */
const tidy = (line: string) => line.trim().replace(/\s+/g, ' ')

/**
 * The commands the repository in `folder` runs outside a lead's sandbox, as
 * what is in it says: its native tools, the tools its packages bring that
 * start a browser or test runner, and its test and end-to-end scripts, run
 * from where they are. Bun's scripts by what they
 * run, as Claude Code keeps a line that starts with `bun` in its sandbox:
 * `node scripts/e2e.ts`, `bunx vp test run`.
 */
export const commandsIn = (folder: string, root: string = folder, platform: NodeJS.Platform = process.platform): ReadonlyArray<string> => {
  const manager = managerIn(folder, root) ?? 'npm'
  const runner = RUNNERS[manager] ?? 'npx'
  const packages = packagesIn(folder)
  const native = platform === 'darwin' ? nativeReachIn(folder, root, packages, runner) : undefined
  const brought = TOOLS.filter((tool) => tool.packages.some((name) => packages.has(name)))
  const tools = [...brought.map((tool) => `${runner} ${tool.bin}`), ...(native?.commands ?? [])]
  // A package's own command as a lead types it, through the runner; anything else, `node scripts/e2e.ts`, as it is.
  const ownCommand = (program: string) =>
    packages.has(program) ||
    brought.some((tool) => tool.bin === program) ||
    [folder, root].some((at) => existsSync(join(at, 'node_modules', '.bin', program)))
  const startsWith = (command: string, start: string) => command === start || command.startsWith(`${start} `)
  const typed = (part: string) => {
    const throughRunner = `${runner} ${part}`
    return ownCommand(part.split(' ')[0] ?? '') || native?.commands.some((command) => startsWith(throughRunner, command))
      ? throughRunner
      : part
  }
  const scripts = scriptsIn(folder, root).flatMap((script) => {
    const isNative = nativeScript(script.name, native)
    if (!isNative && !testing(script.name)) return []
    if (manager === 'bun') return partsOf(script.body).map(typed)
    const local = `${manager} run ${script.name}`
    if (!isNative) return [local]
    return [local, script.command, ...(manager === 'yarn' || manager === 'pnpm' ? [`${manager} ${script.name}`] : [])]
  })
  // Without what a tool already covers: `bunx playwright test` runs outside as `bunx playwright` does.
  const covered = (command: string) => tools.some((tool) => command.startsWith(`${tool} `))
  return [...new Set([...tools, ...scripts])].filter((command) => runsOutside(command) && !covered(command))
}

/** Words that only test or change folder before what a line runs: `test -d node_modules ||`, `cd web &&`. */
const GUARDS = new Set(['test', '[', '[[', 'cd', 'if', 'true', 'exit'])

/** The commands a line runs, each whole, as a sandbox matches them one by one: without what only tests or changes folder first. */
const partsOf = (line: string): ReadonlyArray<string> =>
  line
    .split(/&&|\|\||;|\n/)
    .map((part) => tidy(part.replace(/^\s*if not exist \S+/i, '').replace(/[()]/g, ' ')))
    .filter((part) => part !== '' && !GUARDS.has(part.split(' ')[0] ?? ''))

/** The commands a kept run command implies: each it runs, whole, as it is what runs (`bun --filter @althar/ui storybook`). */
export const runCommandsOf = (line: string): ReadonlyArray<string> => partsOf(line)

/**
 * The commands a setup implies, by how each starts, as a lead would run it
 * again: `bun install` from `test -d node_modules || bun install --frozen-lockfile`.
 */
export const setupCommandsOf = (setup: string): ReadonlyArray<string> =>
  partsOf(setup).map((part) => {
    const [first = '', second] = part.split(' ')
    return second === undefined || second.startsWith('-') ? first : `${first} ${second}`
  })

const hostnameOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** The code hosts' own hosts beyond the one a remote names: their APIs, and where they serve archives, files and releases from. */
const CODE_HOSTS: Readonly<Record<string, ReadonlyArray<string>>> = {
  'github.com': [
    'github.com',
    'api.github.com',
    'codeload.github.com',
    'raw.githubusercontent.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
  ],
  'gitlab.com': ['gitlab.com'],
  'bitbucket.org': ['bitbucket.org', 'api.bitbucket.org'],
}

/** The host a remote names, by address (`https://host/…`, `ssh://git@host/…`) or as scp writes it (`git@host:…`). */
const remoteHostOf = (remote: string): string | undefined =>
  parseRemote(remote)?.host ??
  (/^[a-z+]+:\/\//i.test(remote)
    ? (hostnameOf(remote) ?? undefined)
    : /^(?:[^@/\s]+@)?([^:/\s]+\.[^:/\s]+):/.exec(remote)?.[1]?.toLowerCase())

/** The hosts a repository's remote reaches: its code host's, or the one it names. None for a remote that names no host. */
export const hostsOfRemote = (remote: string): ReadonlyArray<string> => {
  const host = remoteHostOf(remote)
  return host === undefined || host === '' ? [] : (CODE_HOSTS[host] ?? [host])
}

/** A tracker's own hosts beyond its address and its API's: where it keeps what is attached to issues. */
const TRACKER_HOSTS: Partial<Record<Product, ReadonlyArray<string>>> = { linear: ['uploads.linear.app'] }

/** The hosts a connection to a tracker reaches, where it is one and not a code host (whose hosts its repositories' remotes give). */
export const hostsOfTracker = (product: Product, webUrl: string, apiUrl: string): ReadonlyArray<string> => {
  const info = products[product]
  if (!info.tracker || info.host) return []
  return [...new Set([hostnameOf(webUrl), hostnameOf(apiUrl), ...(TRACKER_HOSTS[product] ?? [])])].filter((host) => host !== null)
}

/** The tools the repository in `folder` uses, as `TOOL_PLACES` tells them: a package manager by its files, a tool by its packages. */
const toolsIn = (folder: string, root: string = folder) => {
  const here = (file: string) => existsSync(join(folder, file)) || existsSync(join(root, file))
  const packages = packagesIn(folder)
  return TOOL_PLACES.filter((tool) => (tool.files ?? []).some(here) || (tool.packages ?? []).some((name) => packages.has(name)))
}

/** The hosts the repository in `folder` installs from: its package managers' registries, and what its packages download. */
export const hostsIn = (folder: string, root: string = folder): ReadonlyArray<string> =>
  toolsIn(folder, root).flatMap((tool) => tool.hosts ?? [])

/** The caches its tools write to, from the home folder as `~/…`, on this platform. */
export const writesIn = (folder: string, root: string = folder, platform: NodeJS.Platform = process.platform): ReadonlyArray<string> =>
  toolsIn(folder, root).flatMap((tool) => cachesOf(tool, platform))

/** What is worked out with what the person changed: what they took out goes, what they added comes after; each once. */
export const withEdits = (workedOut: ReadonlyArray<string>, edits: Edits | undefined): ReadonlyArray<string> => {
  const removed = new Set(edits?.removed ?? [])
  return [...new Set([...workedOut, ...(edits?.added ?? [])].map(tidy))].filter((each) => each !== '' && !removed.has(each))
}

/** Each once, in the order first met. */
const once = (lists: ReadonlyArray<ReadonlyArray<string>>) => [...new Set(lists.flat())]

/**
 * What a project's leads' sandboxes let through, as Althar works it out on
 * this device: from each repository's folder (a task's worktree, else its
 * checkout here) and what is kept for how it runs and is set up, its
 * remotes, and the trackers Althar is connected to.
 */
export const workedOutReach = (projectId: string, taskId: string | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const bindings = yield* sql<{
      id: string
      within: string | null
      repository: string
      runCommand: string | null
      runSetup: string | null
      recordedSetup: string | null
      remotes: string
    }>`
      SELECT b.id, b.folder AS within, l.path AS repository, b.run_command, b.run_setup, b.recorded_setup,
        l.observed_remotes AS remotes
      FROM repository_bindings b
      JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL
      ORDER BY b.created_at, b.rowid`
    const worktrees =
      taskId === null
        ? new Map<string, string>()
        : new Map(
            (yield* sql<{ bindingId: string; path: string }>`
              SELECT binding_id, path FROM workspaces WHERE task_id = ${taskId} AND device_id = ${instance.deviceId} AND access = 'write'`).map(
              (row) => [row.bindingId, row.path],
            ),
          )
    const kept = yield* sql<{ bindingId: string; command: string }>`
      SELECT binding_id, command FROM runnables
      WHERE project_id = ${projectId} AND dropped_at IS NULL AND command IS NOT NULL
      ORDER BY position, created_at, rowid`
    const trackers = yield* sql<{ product: Product; webUrl: string; apiUrl: string }>`
      SELECT product, web_url, api_url FROM connections WHERE device_id = ${instance.deviceId} AND state = 'ready'
      ORDER BY created_at, rowid`
    const places = bindings.map((binding) => {
      const root = worktrees.get(binding.id) ?? binding.repository
      return { binding, root, folder: binding.within === null ? root : join(root, binding.within) }
    })
    const remotesOf = (json: string): ReadonlyArray<string> => {
      try {
        const parsed: unknown = JSON.parse(json)
        return Array.isArray(parsed) ? parsed.filter((remote): remote is string => typeof remote === 'string') : []
      } catch {
        return []
      }
    }
    return {
      commands: once([
        ...places.map(({ folder, root }) => commandsIn(folder, root)),
        ...places.map(({ binding, folder, root }) => {
          const run = runOf({ command: binding.runCommand, setup: binding.runSetup }, folder, root)
          const setup = binding.runSetup ?? installIn(folder, root)
          const recorded = recordedOf(binding.recordedSetup)?.commands ?? []
          return [
            ...(run === null ? [] : runCommandsOf(run.command)),
            ...(setup === null ? [] : setupCommandsOf(setup)),
            ...recorded.flatMap(setupCommandsOf),
          ]
        }),
        ...kept.map((runnable) => runCommandsOf(runnable.command)),
        ALWAYS,
      ]).filter(runsOutside),
      hosts: once([
        ...places.map(({ binding }) => remotesOf(binding.remotes).flatMap(hostsOfRemote)),
        ...places.map(({ folder, root }) => hostsIn(folder, root)),
        ...trackers.map((tracker) => hostsOfTracker(tracker.product, tracker.webUrl, tracker.apiUrl)),
      ]),
      writes: once(places.map(({ folder, root }) => writesIn(folder, root))),
    } satisfies Reach
  })
