/*
 * What a change needs from CI, so a pull request runs only what it reaches (.github/workflows/harness.yml, desktop.yml
 * and ui.yml), and its entry in the merge queue only what it and what landed beneath it could break together
 * (queuePlan):
 *
 * - The unit tests whose imports reach a changed file, in whichever package they are, and the checks of the packages
 *   it changes and of those that build on them. A file no test or the app reaches (a script run by its path, a file
 *   deleted) stands for its whole package, and so does a package's own config, test setup or fixtures. A change any
 *   test may rest on (the lockfile, the root's config, the lint rules, @althar/testing, the workflows) runs everything.
 * - The app's end-to-end run when the change reaches the app. A change to specs alone is stress.yml's, which runs
 *   those specs over.
 * - Windows' smoke test when what reaches the app is code that behaves differently there: the runtime and the packages
 *   it runs, the desktop app's main process, preload and scripts. Not the renderer, the UI kit, copy or docs.
 * - On a draft, nothing heavy: the end-to-end runs wait for ready for review. The merge queue has no drafts, and no
 *   end-to-end runs.
 * - On a ready pull request, the coverage gate of every package it reaches that has one (`gated`): each runs its whole
 *   suite with coverage, as post-merge.yml does, and its selected tests run there (`covered`). Not in the merge queue,
 *   where two changes that each held their coverage on their own pull requests make no measurement of their own.
 * - The guard that follows the specs' imports (packages/testing's tests/e2eImports.test.ts) reads them by their paths,
 *   from a package the desktop app's run doesn't test: desktop runs it too, whenever the change reaches a spec.
 *
 * Reaching is read from the source: imports, re-exports, `require`, Vitest's mocks, `import.meta.glob`, CSS's
 * `@import`, `url()` and `composes`, `new URL('./…', import.meta.url)`, and a path joined to `import.meta.dirname`;
 * not imports of types alone, which nothing runs. A file that builds a path some other way from where it is reaches
 * its whole package. Vitest's own `--changed` reads imports only, so it misses a test that starts the fake agent by
 * its path, or reads the UI kit's sources to check them.
 *
 * `bun select.ts plan <workflow> <changed>` writes the plan for the file of changed paths to GITHUB_OUTPUT (a line `*`
 * means what changed isn't known: everything runs), or with QUEUE_ENTRIES, the merge group's entries; `bun select.ts
 * run` runs the jobs in PLAN.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path/posix'

/** The files at the change's head, from the repository's root, and how to read one. */
export interface Repository {
  readonly files: ReadonlyArray<string>
  readonly read: (path: string) => string
}

/** One package's share of a job: its checks or not, and all its tests, some, or none. */
export interface Part {
  readonly dir: string
  readonly check: boolean
  readonly tests: 'all' | ReadonlyArray<string>
  readonly shard?: string
}

/** A job of the workflow's matrix: its name, after the workflow's job name, and its parts. */
export interface Job {
  readonly name: string
  readonly parts: ReadonlyArray<Part>
}

export interface Plan {
  /** Why it runs what it runs, a line each, for the run's log and summary. */
  readonly why: ReadonlyArray<string>
  readonly jobs: ReadonlyArray<Job>
  readonly e2e: boolean
  readonly windowsE2e: boolean
}

export type Workflow = 'harness' | 'desktop' | 'ui' | 'windows'

/** A job's packages, and whether its tests are split by file into machines of their own. */
interface Group {
  readonly name: string
  readonly dirs: ReadonlyArray<string>
  readonly sharded?: true
}

const LAYOUT: Record<Workflow, { readonly jobs: ReadonlyArray<Group>; readonly e2e: boolean }> = {
  harness: {
    jobs: [
      {
        name: 'packages',
        dirs: [
          'packages/connectors',
          'packages/contracts',
          'packages/transport-node',
          'packages/domain',
          'packages/persistence-sqlite',
          'packages/provider-adapters',
          'packages/skills',
          'packages/testing',
          'apps/cli',
        ],
      },
      { name: 'packages/runtime', dirs: ['packages/runtime'], sharded: true },
    ],
    e2e: false,
  },
  desktop: { jobs: [{ name: 'apps/desktop', dirs: ['apps/desktop'] }], e2e: true },
  ui: { jobs: [{ name: 'packages/ui', dirs: ['packages/ui'] }], e2e: false },
  windows: {
    jobs: [
      { name: 'desktop', dirs: ['apps/desktop'] },
      { name: 'packages/runtime', dirs: ['packages/runtime'], sharded: true },
      {
        name: 'packages',
        dirs: [
          'packages/connectors',
          'packages/contracts',
          'packages/transport-node',
          'packages/domain',
          'packages/persistence-sqlite',
          'packages/provider-adapters',
          'packages/skills',
          'packages/testing',
          'packages/ui',
          'apps/cli',
        ],
      },
    ],
    e2e: false,
  },
}

/** About a quarter of the runtime's tests: a machine's worth, a few minutes. More take more machines, up to four. */
const PER_SHARD = 50
const SHARDS = 4

/** What every test may rest on: the lockfile, the root's config, lint rules and patches, @althar/testing, the workflows. */
const EVERYTHING =
  /^(?:\*$|package\.json$|bun\.lock$|vite\.config\.ts$|\.bun-version$|\.node-version$|\.gitattributes$|lint\/|patches\/|packages\/testing\/|\.github\/(?:workflows|actions)\/)/
/** What all of a package's tests rest on, from its folder: its config, test setup and fixtures. */
const PACKAGE_WIDE = /^(?:package\.json|[^/]*\.config\.[cm]?ts|tsconfig[^/]*\.json|tests\/setup\.tsx?|(?:.*\/)?fixtures(?:\/|\.tsx?$))/
/** Read by no tool that checks or tests, unless a test reads it by its path. */
const INERT = /\.md$/

const TEST = /^(?:(?:packages|apps)\/[^/]+|brand)\/(?:tests|src)\/.+\.test\.tsx?$/
/* Tests that drive real agents or real accounts, which CI doesn't have (as in stress.ts). */
const REAL = /\/tests\/(?:agents|real)\//
const TESTLIKE = /\/tests\/|\.(?:test|spec)\.tsx?$/
/** What the end-to-end run builds and drives: the desktop app's files, but its unit tests, notes, Linux packaging and specs. */
const APP = /^apps\/desktop\/(?!tests\/|release-notes\/|flatpak\/|e2e\/[^/]+\.spec\.ts$|.*\.md$)/
const SPEC = /^apps\/desktop\/e2e\/[^/]+\.spec\.ts$/
/** What the end-to-end run loads in Node: its specs and their support. */
const E2E = /^apps\/desktop\/e2e\//
/** The guard that follows what they import, which Node can't load (#217), as @althar/testing's test. */
const E2E_GUARD = { dir: 'packages/testing', test: 'tests/e2eImports.test.ts' }
/** The spec Windows runs: the app starts and makes a project. */
const SMOKE = 'apps/desktop/e2e/smoke.spec.ts'
/**
 * What behaves differently by OS (paths, processes, files, the keyring): the runtime and the packages it runs, and the
 * desktop app but its renderer.
 */
const BY_OS =
  /^(?:packages\/(?:runtime|provider-adapters|persistence-sqlite|connectors|skills|transport-node)\/|apps\/cli\/|apps\/desktop\/(?!src\/renderer\/))/

const MODULE = /\.(?:[cm]?[jt]sx?|css)$/
const SCRIPT = /\.[cm]?jsx?$/
const EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '/index.ts',
  '/index.tsx',
  '/index.js',
]

interface Package {
  readonly dir: string
  readonly name: string
  readonly exports: Readonly<Record<string, ReadonlyArray<string>>>
  /** What it depends on, by name: workspace packages and others. */
  readonly uses: ReadonlyArray<string>
}

/** What a file names: the specifiers it imports, and the prefixes of the paths it reads from where it is. */
interface Names {
  readonly specifiers: ReadonlyArray<string>
  readonly prefixes: ReadonlyArray<string>
  /** It builds a path from where it is in a way this can't follow, so it may read anything in its package. */
  readonly anywhere: boolean
}

/** Imports of types only, which nothing runs: what they name is the checks' to read. */
const TYPES_ONLY = /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+)\s*from\s*(['"`])[^'"`\n]+\1/g
/** Imports and re-exports, `require`, Vitest's mocks, CSS's `@import`, `url()` and `composes … from`. */
const NAMED = /(?:\bfrom\s*|\bimport\s*\(?\s*|\b(?:require|mock|doMock|importActual|importMock|url)\s*\(\s*)(['"`])([^'"`$\n]+)\1/g
/** `import(` of something that isn't a string. */
const DYNAMIC = /\bimport\s*\(\s*(?![\s'"`])/
/** An import statement's specifier, at the start of a line: what the repository's own imports are, not words in a string. */
const STATEMENT = /^[ \t]*(?:(?:import|export)\b[^'"`;]*?\bfrom|import)\s*(['"])([^'"\n]+)\1/gm
const URL_HERE = /\bnew\s+URL\(\s*(['"`])(\.\.?\/[^'"`$]*)/g
const GLOB = /\bimport\.meta\.glob\s*(?:<[^(]*>)?\(\s*/g
const HERE = /\bimport\.meta\.(?:dirname|filename|url)\b|\b__dirname\b|\b__filename\b/g
const LITERAL = /(['"`])([^'"`$]*)(\1|\$\{)/y
const SEGMENT = /\s*,\s*(['"`])([^'"`$]*)(\1|\$\{)/y

/** The literal strings of `'a'` or `['a', 'b']` at `at`, or none when it's anything else. */
const strings = (source: string, at: number): ReadonlyArray<string> | undefined => {
  LITERAL.lastIndex = at
  const one = LITERAL.exec(source)
  if (one !== null) return one[3] === one[1] ? [one[2] ?? ''] : undefined
  const end = source.indexOf(']', at)
  if (source[at] !== '[' || end < at) return undefined
  const inside = source.slice(at + 1, end)
  if (inside.replaceAll(/(['"`])[^'"`$]*\1|[\s,]/g, '') !== '') return undefined
  return [...inside.matchAll(/(['"`])([^'"`$]*)\1/g)].map((match) => match[2] ?? '')
}

export const names = (file: string, source: string): Names => {
  const here = dirname(file)
  const specifiers = [...source.replaceAll(TYPES_ONLY, '').matchAll(NAMED)].map((match) => match[2] ?? '')
  const prefixes = [...source.matchAll(URL_HERE)].map((match) => join(here, match[2] ?? ''))
  let anywhere = DYNAMIC.test(source)
  for (const match of source.matchAll(GLOB)) {
    const patterns = strings(source, (match.index ?? 0) + match[0].length)
    if (patterns === undefined) anywhere = true
    // A glob reads what is under the folder it starts from.
    else
      for (const pattern of patterns.filter((one) => !one.startsWith('!'))) prefixes.push(join(here, pattern.split(/[*?{[]/, 1)[0] ?? ''))
  }
  for (const match of source.matchAll(HERE)) {
    const at = match.index ?? 0
    const before = source.slice(Math.max(0, at - 120), at)
    if (/createRequire\(\s*$/.test(before) || /new\s+URL\(\s*(['"`])\.\.?\/[^'"`]*\1\s*,\s*$/.test(before)) continue
    if (match[0] !== 'import.meta.dirname' || !/\b(?:join|resolve)\(\s*$/.test(before)) {
      anywhere = true
      continue
    }
    // join(import.meta.dirname, '..', 'resources', `tray${…}`): as far as it is written out.
    const segments: Array<string> = []
    SEGMENT.lastIndex = at + match[0].length
    for (let segment = SEGMENT.exec(source); segment !== null; segment = segment[3] === '${' ? null : SEGMENT.exec(source))
      segments.push(segment[2] ?? '')
    prefixes.push(join(here, ...segments))
  }
  return { specifiers, prefixes: prefixes.map((prefix) => (normalize(prefix) === '.' ? '' : normalize(prefix))), anywhere }
}

/** Every string an `exports` entry leads to, through its conditions. */
const targets = (entry: unknown): ReadonlyArray<string> =>
  typeof entry === 'string' ? [entry] : typeof entry === 'object' && entry !== null ? Object.values(entry).flatMap(targets) : []

interface Manifest {
  readonly name?: string
  readonly scripts?: Record<string, string>
  readonly exports?: unknown
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

const manifest = (repo: Repository, file: string): Manifest => {
  try {
    return JSON.parse(repo.read(file)) as Manifest
  } catch {
    return {}
  }
}

const usesOf = (json: Manifest) =>
  Object.keys({ ...json.dependencies, ...json.devDependencies, ...json.peerDependencies, ...json.optionalDependencies })

const packagesOf = (repo: Repository): ReadonlyArray<Package> =>
  repo.files
    .filter((file) => /^(?:(?:packages|apps)\/[^/]+|brand)\/package\.json$/.test(file))
    .flatMap((file) => {
      const json = manifest(repo, file)
      if (json.name === undefined) return []
      const exports =
        typeof json.exports === 'object' && json.exports !== null && Object.keys(json.exports).every((key) => key.startsWith('.'))
          ? Object.fromEntries(Object.entries(json.exports).map(([key, entry]) => [key, targets(entry)]))
          : { '.': targets(json.exports ?? './src/index.ts') }
      return [{ dir: dirname(file), name: json.name, exports, uses: usesOf(json) }]
    })

/** A file that reads files by a path from where it is, which starts with `prefix`. */
interface Reader {
  readonly prefix: string
  readonly file: string
}

/**
 * Whether a reader reads a file under its prefix. A test may read anything; a source reads no test (a path to its
 * package, as the app's main process and the specs' support make, is where to find what it builds), and the app reads
 * only the app.
 */
const reads = ({ prefix, file: reader }: Reader, file: string) =>
  file.startsWith(prefix) && (TESTLIKE.test(reader) || (APP.test(reader) ? APP.test(file) : !TESTLIKE.test(file)))

export interface Graph {
  readonly files: ReadonlySet<string>
  readonly packages: ReadonlyArray<Package>
  /** The files that import each file. */
  readonly importers: ReadonlyMap<string, ReadonlySet<string>>
  /** The files that read files by a path from where they are. */
  readonly readers: ReadonlyArray<Reader>
  /**
   * Relative imports that lead to no file, as `file: specifier`. A sample of code in a string, as in a fixture: an
   * import that is one and leads nowhere fails its package's checks.
   */
  readonly unresolved: ReadonlyArray<string>
  /**
   * The packages besides the workspace's that import statements name, as `file: package`, and those the repository
   * depends on: an import that is neither is an alias, which this doesn't follow.
   */
  readonly bare: ReadonlyArray<string>
  readonly dependencies: ReadonlySet<string>
}

export const packageOf = (packages: ReadonlyArray<Package>, file: string): Package | undefined =>
  packages.find((one) => file.startsWith(`${one.dir}/`))

export const graph = (repo: Repository): Graph => {
  const files = new Set(repo.files)
  const packages = packagesOf(repo)
  const importers = new Map<string, Set<string>>()
  const readers: Array<Reader> = []
  const unresolved: Array<string> = []
  const bare: Array<string> = []
  const probe = (base: string) => {
    const bases = SCRIPT.test(base) ? [base, base.replace(SCRIPT, '')] : [base]
    return bases.flatMap((one) => EXTENSIONS.map((extension) => one + extension)).find((candidate) => files.has(candidate))
  }
  /** The file a specifier leads to, a package's folder for a part of it its exports don't name, or none outside. */
  const resolve = (from: string, specifier: string): string | undefined => {
    const path = specifier.split('?')[0] ?? ''
    if (path.startsWith('.')) return probe(normalize(join(dirname(from), path)))
    const named = packages.find((one) => path === one.name || path.startsWith(`${one.name}/`))
    if (named === undefined) return undefined
    const found = named.exports[`.${path.slice(named.name.length)}`]?.map((target) => probe(normalize(join(named.dir, target))))
    return found?.find((one) => one !== undefined) ?? `${named.dir}/`
  }
  for (const file of repo.files.filter((one) => MODULE.test(one))) {
    const named = names(file, repo.read(file))
    for (const specifier of named.specifiers) {
      const target = resolve(file, specifier)
      if (target?.endsWith('/') === true) readers.push({ prefix: target, file })
      else if (target !== undefined) importers.set(target, (importers.get(target) ?? new Set()).add(file))
      else if (specifier.startsWith('.')) unresolved.push(`${file}: ${specifier}`)
    }
    for (const prefix of named.prefixes) readers.push({ prefix, file })
    const home = packageOf(packages, file)
    if (named.anywhere && home !== undefined) readers.push({ prefix: `${home.dir}/`, file })
    for (const [, , specifier = ''] of repo.read(file).matchAll(STATEMENT))
      if (!specifier.startsWith('.') && !packages.some((one) => specifier === one.name || specifier.startsWith(`${one.name}/`)))
        bare.push(`${file}: ${specifier.startsWith('@') ? specifier.split('/', 2).join('/') : specifier.split('/', 1)[0]}`)
  }
  const dependencies = new Set([...usesOf(manifest(repo, 'package.json')), ...packages.flatMap((one) => one.uses)])
  return { files, packages, importers, readers, unresolved, bare, dependencies }
}

/** Every file that reaches one of `from`, `from` too: through the files that import it or read it by its path. */
const reaching = (graph: Graph, from: Iterable<string>): ReadonlySet<string> => {
  const reached = new Set(from)
  const queue = [...reached]
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    const next = [...(graph.importers.get(file) ?? []), ...graph.readers.flatMap((reader) => (reads(reader, file) ? [reader.file] : []))]
    for (const one of next.filter((candidate) => !reached.has(candidate))) {
      reached.add(one)
      queue.push(one)
    }
  }
  return reached
}

const isTest = (file: string) => TEST.test(file) && !REAL.test(file)

/** The packages that build on `dir`, through those that build on them. */
const dependents = (packages: ReadonlyArray<Package>, dir: string): ReadonlyArray<string> => {
  const found = new Set<string>()
  const queue = [dir]
  for (let at = queue.pop(); at !== undefined; at = queue.pop()) {
    const name = packages.find((one) => one.dir === at)?.name
    for (const one of packages.filter((candidate) => name !== undefined && candidate.uses.includes(name) && !found.has(candidate.dir))) {
      found.add(one.dir)
      queue.push(one.dir)
    }
  }
  return [...found]
}

/** A group's jobs: one, or for a split package as many machines as its tests take. */
const jobsOf = (group: Group, parts: ReadonlyArray<Part>, total: (dir: string) => number): ReadonlyArray<Job> => {
  const kept = parts.filter((part) => part.check || part.tests === 'all' || part.tests.length > 0)
  const [only] = kept
  if (only === undefined) return []
  if (group.sharded !== true) return [{ name: group.name, parts: kept }]
  const shards = Math.max(1, Math.min(SHARDS, Math.ceil((only.tests === 'all' ? total(only.dir) : only.tests.length) / PER_SHARD)))
  if (shards === 1) return [{ name: group.name, parts: [only] }]
  return Array.from({ length: shards }, (_, index) => ({
    name: `${group.name} ${index + 1}/${shards}`,
    // The checks don't change by part: the first runs them.
    parts: [{ ...only, check: only.check && index === 0, shard: `${index + 1}/${shards}` }],
  }))
}

/** What a change reaches: the files it starts from, every file that reaches one of them, and the packages to check. */
interface Reach {
  /** The file it changes that any test may rest on, or none. */
  readonly everything: string | undefined
  readonly from: ReadonlySet<string>
  readonly reached: ReadonlySet<string>
  readonly checked: ReadonlySet<string>
}

const reach = (changed: ReadonlyArray<string>, repo: Repository, known: Graph, why: Array<string>): Reach => {
  const everything = changed.find((file) => EVERYTHING.test(file))
  if (everything !== undefined)
    why.push(everything === '*' ? 'What changed is unknown: everything runs.' : `${everything} changed: everything runs.`)

  // What the change reaches, from its files, each that nothing uses standing for its whole package.
  const from = new Set<string>()
  const wide = new Set<string>()
  const checked = new Set<string>()
  for (const file of everything === undefined ? changed : []) {
    const home = packageOf(known.packages, file)
    if (home === undefined) continue
    // What uses it: tests and the app in its own package or one that builds on it. A test elsewhere that reads it by
    // its path (as a guard reads every spec) reads it as text, which says nothing of what runs it.
    const own = new Set([home.dir, ...dependents(known.packages, home.dir)])
    const used = [...reaching(known, [file])].some(
      (one) => (isTest(one) || APP.test(one) || SPEC.test(one)) && own.has(packageOf(known.packages, one)?.dir ?? ''),
    )
    if (INERT.test(file) && !used) continue
    from.add(file)
    if (!INERT.test(file)) {
      checked.add(home.dir)
      // Its tests are its own; anything else may change what the packages that build on it see.
      if (!file.startsWith(`${home.dir}/tests/`)) for (const one of dependents(known.packages, home.dir)) checked.add(one)
    }
    if (wide.has(home.dir)) continue
    if (PACKAGE_WIDE.test(file.slice(home.dir.length + 1)))
      why.push(`${file} changed: every test of ${home.dir} runs, and every test that reaches it.`)
    else if (!used) why.push(`${file} reaches no test and not the app: it stands for all of ${home.dir}.`)
    else continue
    wide.add(home.dir)
  }
  for (const dir of wide) for (const file of repo.files.filter((one) => one.startsWith(`${dir}/`))) from.add(file)
  return { everything, from, reached: reaching(known, from), checked }
}

/** The workflow's jobs, each package checked or not, and with the tests `runs` picks of its own. */
const jobsFor = (
  workflow: Workflow,
  repo: Repository,
  known: Graph,
  check: (dir: string) => boolean,
  runs: (file: string) => boolean,
): ReadonlyArray<Job> => {
  const tests = repo.files.filter(isTest)
  const testsOf = (dir: string) => tests.filter((file) => file.startsWith(`${dir}/`))
  return LAYOUT[workflow].jobs.flatMap((group) =>
    jobsOf(
      group,
      group.dirs
        .filter((dir) => known.packages.some((one) => one.dir === dir))
        .map((dir): Part => {
          const all = testsOf(dir)
          const some = all.filter(runs)
          return {
            dir,
            check: workflow !== 'windows' && check(dir),
            tests: some.length === all.length && all.length > 0 ? 'all' : some.map((file) => file.slice(dir.length + 1)),
          }
        }),
      (dir) => testsOf(dir).length,
    ),
  )
}

/**
 * The guard that follows the specs' imports reads them as text, from @althar/testing, which the app's own run doesn't
 * test: it runs with the app's tests whenever the change reaches a spec or what one imports (`reaches`).
 */
const guarded = (jobs: ReadonlyArray<Job>, workflow: Workflow, repo: Repository, reaches: boolean): ReadonlyArray<Job> => {
  const layout = LAYOUT[workflow]
  if (!layout.e2e || !reaches || !repo.files.includes(`${E2E_GUARD.dir}/${E2E_GUARD.test}`)) return jobs
  const guard = { dir: E2E_GUARD.dir, check: false, tests: [E2E_GUARD.test] }
  const [first, ...rest] = jobs
  return first === undefined
    ? [{ name: layout.jobs[0]?.name ?? workflow, parts: [guard] }]
    : [{ ...first, parts: [...first.parts, guard] }, ...rest]
}

export const plan = (changed: ReadonlyArray<string>, repo: Repository, workflow: Workflow, { draft = false } = {}): Plan => {
  const layout = LAYOUT[workflow]
  const known = graph(repo)
  const why: Array<string> = []
  if (
    workflow === 'windows' &&
    !changed.some((file) => EVERYTHING.test(file)) &&
    !changed.some((file) => BY_OS.test(file) && !INERT.test(file))
  )
    return { why: [], jobs: [], e2e: false, windowsE2e: false }
  const { everything, from, reached, checked } = reach(changed, repo, known, why)
  const all = everything !== undefined
  const jobs = guarded(
    jobsFor(
      workflow,
      repo,
      known,
      (dir) => all || checked.has(dir),
      (file) => all || reached.has(file),
    ),
    workflow,
    repo,
    [...reached].some((file) => E2E.test(file)),
  )
  const byOs = [...from].filter((file) => BY_OS.test(file) && !TESTLIKE.test(file))
  let e2e = layout.e2e && (all || [...reached].some((file) => APP.test(file)))
  let windowsE2e = layout.e2e && (all || [...reaching(known, byOs)].some((file) => APP.test(file)) || from.has(SMOKE))
  if (draft && (e2e || windowsE2e)) {
    why.push('A draft: the end-to-end runs wait until it is ready for review.')
    e2e = false
    windowsE2e = false
  }
  return { why, jobs, e2e, windowsE2e }
}

/** One entry of a merge group: what its pull request changes, and what landed beneath it since it branched from main. */
export interface Entry {
  readonly pr: number
  readonly changes: ReadonlyArray<string>
  readonly since: ReadonlyArray<string>
}

/**
 * The merge queue's share of a group: what its entries could break together, not what each does alone, which its own
 * pull request's checks passed on its head before it could be queued (.github/scripts/queue-gate.py). For each entry,
 * the tests that both what it changes and what landed beneath it since it branched reach, and the checks of the
 * packages both could change. A test only one of them reaches ran on that one's pull request with nothing of the other
 * in its way. The end-to-end runs are the pull request's and post-merge.yml's, not the queue's.
 */
export const queuePlan = (entries: ReadonlyArray<Entry>, repo: Repository, workflow: Workflow): Plan => {
  const known = graph(repo)
  const why: Array<string> = []
  const tests = new Set<string>()
  const checks = new Set<string>()
  // This workflow's packages, which its summary speaks of.
  const dirs = LAYOUT[workflow].jobs.flatMap((group) => group.dirs).filter((dir) => known.packages.some((one) => one.dir === dir))
  const ours = (file: string) => dirs.some((dir) => file.startsWith(`${dir}/`))
  const spec = (one: Reach) => [...one.reached].some((file) => E2E.test(file))
  // Whether both an entry and what landed beneath it reach a spec, which the guard of the specs' imports reads.
  let specs = false
  for (const entry of entries) {
    if (entry.since.length === 0) {
      why.push(`#${entry.pr}: nothing landed beneath it since it branched.`)
      continue
    }
    const mine = reach(entry.changes, repo, known, [])
    const beneath = reach(entry.since, repo, known, [])
    const reachedBy = (one: Reach, file: string) => one.everything !== undefined || one.reached.has(file)
    const checkedBy = (one: Reach, dir: string) => one.everything !== undefined || one.checked.has(dir)
    const shared = repo.files.filter((file) => ours(file) && isTest(file) && reachedBy(mine, file) && reachedBy(beneath, file))
    const checked = dirs.filter((dir) => checkedBy(mine, dir) && checkedBy(beneath, dir))
    for (const file of shared) tests.add(file)
    for (const dir of checked) checks.add(dir)
    specs ||= spec(mine) && spec(beneath)
    why.push(
      `#${entry.pr}, and the ${entry.since.length} files that landed beneath it since it branched, both reach ${shared.length} tests here` +
        (checked.length === 0 ? ', and no package’s checks.' : `, and the checks of ${checked.join(', ')}.`),
    )
  }
  return {
    why,
    jobs: guarded(
      jobsFor(
        workflow,
        repo,
        known,
        (dir) => checks.has(dir),
        (file) => tests.has(file),
      ),
      workflow,
      repo,
      specs,
    ),
    e2e: false,
    windowsE2e: false,
  }
}

/** The repository at `root`: the files git tracks. */
export const repository = (root = '.'): Repository => ({
  files: spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .stdout.split('\n')
    .filter((line) => line !== ''),
  read: (path) => {
    try {
      return readFileSync(join(root, path), 'utf8')
    } catch {
      return ''
    }
  },
})

/**
 * The packages a plan reaches that gate on their coverage, with a `test:coverage` of their own: on a ready pull request,
 * each runs its whole suite with coverage in a job of its own (harness.yml), as post-merge.yml does. Not the runtime,
 * whose coverage runs in parts of its own.
 */
export const gated = (jobs: ReadonlyArray<Job>, repo: Repository): ReadonlyArray<string> =>
  [
    ...new Set(
      jobs
        .flatMap((job) => job.parts)
        .filter((part) => part.check || part.tests === 'all' || part.tests.length > 0)
        .map((part) => part.dir),
    ),
  ].filter((dir) => dir !== 'packages/runtime' && manifest(repo, `${dir}/package.json`).scripts?.['test:coverage'] !== undefined)

/**
 * A package whose whole suite runs with coverage elsewhere in the run leaves its selected tests to it, while its checks
 * still gate here, once.
 */
export const covered = (jobs: ReadonlyArray<Job>, dirs: ReadonlyArray<string>): ReadonlyArray<Job> =>
  jobs.flatMap((job) => {
    const parts = job.parts
      .map((part): Part => (dirs.includes(part.dir) ? { dir: part.dir, check: part.check, tests: [] } : part))
      .filter((part) => part.check || part.tests === 'all' || part.tests.length > 0)
    if (parts.length === 0) return []
    return [{ name: parts.every((part) => part.dir === 'packages/runtime') ? 'packages/runtime checks' : job.name, parts }]
  })

/**
 * The tests whose imports reach any of `from`, nearest first: those that import one, then those that import what
 * does, and so on; at each step those in a package of `from` before the others, each in the order of their paths;
 * `limit` at most. Only imports count here, not paths read, which every guard that reads the whole repository would
 * answer.
 */
export const nearest = (known: Graph, from: Iterable<string>, limit: number): ReadonlyArray<string> => {
  const seen = new Set(from)
  const own = new Set([...seen].map((file) => packageOf(known.packages, file)?.dir))
  const away = (file: string) => (own.has(packageOf(known.packages, file)?.dir) ? 0 : 1)
  const found: Array<string> = []
  for (let step = [...seen]; step.length > 0 && found.length < limit;) {
    const next = [...new Set(step.flatMap((file) => [...(known.importers.get(file) ?? [])]))]
      .filter((file) => !seen.has(file))
      .sort((a, b) => away(a) - away(b) || (a < b ? -1 : a > b ? 1 : 0))
    for (const file of next) seen.add(file)
    found.push(...next.filter(isTest))
    step = next
  }
  return found.slice(0, limit)
}

const describe = (part: Part) =>
  `${part.dir}: ${part.check ? 'checks, ' : ''}${part.tests === 'all' ? 'all its tests' : `${part.tests.length} of its tests`}${part.shard === undefined ? '' : `, part ${part.shard}`}`

/**
 * Runs each part's checks and tests, every part even when one before it fails, so a run says all that broke. Tests
 * are named by file, and a part of a split package runs its share of them (`--shard`).
 */
const run = (jobs: ReadonlyArray<Job>) => {
  const failed = jobs
    .flatMap((job) => job.parts)
    .filter((part) => {
      process.stdout.write(`::group::${describe(part)}\n`)
      const shard = part.shard === undefined ? [] : [`--shard=${part.shard}`]
      const steps = [
        ...(part.check ? [['run', 'check']] : []),
        ...(part.tests === 'all'
          ? [['run', 'test', ...shard]]
          : part.tests.length > 0
            ? [['run', 'test', '--passWithNoTests', ...shard, ...part.tests]]
            : []),
      ]
      const statuses = steps.map((args) => spawnSync('bun', args, { cwd: part.dir, stdio: 'inherit' }).status)
      process.stdout.write('::endgroup::\n')
      return statuses.some((status) => status !== 0)
    })
  if (failed.length > 0) {
    process.stdout.write(`::error::Failed: ${failed.map((part) => part.dir).join(' ')}\n`)
    process.exit(1)
  }
}

/** The entries queue-entries.py wrote, or none when it wrote nothing that reads as them. */
export const queueEntries = (path: string): ReadonlyArray<Entry> | undefined => {
  try {
    const entries: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const strings = (value: unknown) => Array.isArray(value) && value.every((one) => typeof one === 'string')
    return Array.isArray(entries) &&
      entries.length > 0 &&
      entries.every((entry: Record<string, unknown>) => typeof entry?.pr === 'number' && strings(entry.changes) && strings(entry.since))
      ? (entries as ReadonlyArray<Entry>)
      : undefined
  } catch {
    return undefined
  }
}

/* Run by its path, not imported (stress.ts and queue-gate.py import it). */
const main = (process.argv[1] ?? '').replaceAll('\\', '/').endsWith('/select.ts')
const [mode, workflow, list] = main ? process.argv.slice(2) : []
const output = process.env.GITHUB_OUTPUT
if (
  mode === 'plan' &&
  (workflow === 'harness' || workflow === 'desktop' || workflow === 'ui' || workflow === 'windows') &&
  list !== undefined &&
  output !== undefined
) {
  const changed = readFileSync(list, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
  const repo = repository()
  // In the merge queue, each entry's own share (queuePlan), when .github/scripts/queue-entries.py could say what it is;
  // when it couldn't, everything the group changes against main, as a pull request's.
  const at = process.env.QUEUE_ENTRIES
  const entries = at === undefined || at === '' ? undefined : queueEntries(at)
  const planned =
    entries === undefined ? plan(changed, repo, workflow, { draft: process.env.DRAFT === 'true' }) : queuePlan(entries, repo, workflow)
  const runtime = planned.jobs.some((job) => job.parts.some((part) => part.dir === 'packages/runtime'))
  // On a ready pull request, not in the queue, harness measures the coverage of each package the change reaches.
  const measured = workflow === 'harness' && process.env.COVERAGE === 'true'
  const coverage = measured ? gated(planned.jobs, repo) : []
  const runtimeCovered = measured && runtime
  const jobs = covered(planned.jobs, [...(runtimeCovered ? ['packages/runtime'] : []), ...coverage])
  appendFileSync(
    output,
    [
      `jobs=${JSON.stringify(jobs)}`,
      `any=${jobs.length > 0}`,
      `runtime=${runtime}`,
      `coverage=${JSON.stringify(coverage)}`,
      `e2e=${planned.e2e}`,
      `windows-e2e=${planned.windowsE2e}`,
      '',
    ].join('\n'),
  )
  const lines = [
    `### What ${workflow} runs`,
    '',
    ...planned.why.map((line) => `- ${line}`),
    ...jobs.flatMap((job) => job.parts.map((part) => `- ${describe(part)}`)),
    ...(runtimeCovered ? ['- The runtime’s full suite runs once with coverage; its selected tests are covered there.'] : []),
    ...coverage.map((dir) => `- ${dir}: its whole suite, with its coverage gate, in a job of its own.`),
    ...(jobs.length === 0 && !runtimeCovered && coverage.length === 0 ? ['- No checks or tests: nothing it changed reaches them.'] : []),
    ...(LAYOUT[workflow].e2e
      ? [`- The end-to-end run: ${planned.e2e ? 'yes' : 'no'}. Windows' smoke test: ${planned.windowsE2e ? 'yes' : 'no'}.`]
      : []),
    '',
  ]
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'))
  process.stdout.write(`${lines.join('\n')}\n`)
}
if (mode === 'run' && process.env.PLAN !== undefined) {
  const jobs = JSON.parse(process.env.PLAN) as Job | ReadonlyArray<Job>
  run(Array.isArray(jobs) ? jobs : [jobs as Job])
}
