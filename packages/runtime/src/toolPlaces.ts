/*
 * Where the tools a project installs with keep what they download, and the
 * hosts they download it from: one list, so a lead's sandbox lets each
 * through (sandboxReach.ts) and a tool to come is one entry more.
 *
 * What fails in a lead's sandbox is rarely the install itself: it is a tool
 * that downloads outside the task's folder or writes to a cache outside it,
 * as Electron does its build (`~/Library/Caches/electron`, from GitHub's
 * releases), Playwright its browsers (`~/Library/Caches/ms-playwright`,
 * from its CDN) and Bun every package (`~/.bun/install/cache`). A lead may
 * write in these caches and reach these hosts without asking, for the tools
 * its repository says it uses: a package manager by the files that say a
 * project is one of its kind, a tool by the packages that bring it.
 *
 * A cache is a folder of downloads, from the home folder, and never where
 * the person keeps keys and sign-ins (`SECRET_PLACES`): `~/.npm`, not
 * `~/.npmrc`; `~/.cargo/registry`, not `~/.cargo/credentials`. A cache is
 * shared with the person's own installs, so a lead could leave something in
 * it that a later install picks up: the trade made so that a task's folder
 * gets ready without anyone (ADR-023).
 */

export interface ToolPlaces {
  /** What it is, for the reader of this list. */
  readonly name: string
  /** Files that say a project uses it, at the root of its repository or of the folder it is in: a lockfile, a manifest. */
  readonly files?: ReadonlyArray<string>
  /** Packages that bring it, as a package.json names them. */
  readonly packages?: ReadonlyArray<string>
  /** Where it keeps what it downloads, from the home folder, on a Mac and on Linux (the sandbox doesn't run on Windows). */
  readonly caches?: { readonly darwin?: ReadonlyArray<string>; readonly linux?: ReadonlyArray<string> }
  /** The hosts it downloads from. */
  readonly hosts?: ReadonlyArray<string>
}

/** The same folder on a Mac and on Linux. */
const both = (...folders: ReadonlyArray<string>) => ({ darwin: folders, linux: folders })

export const TOOL_PLACES: ReadonlyArray<ToolPlaces> = [
  /* ---- Package managers, by the files that say a project is one of theirs ---- */
  { name: 'npm', files: ['package.json'], caches: both('.npm'), hosts: ['registry.npmjs.org'] },
  { name: 'Bun', files: ['bun.lock', 'bun.lockb'], caches: both('.bun/install/cache') },
  {
    name: 'pnpm',
    files: ['pnpm-lock.yaml'],
    caches: { darwin: ['Library/pnpm/store', 'Library/Caches/pnpm'], linux: ['.local/share/pnpm/store', '.cache/pnpm'] },
  },
  {
    name: 'Yarn',
    files: ['yarn.lock', '.yarnrc.yml'],
    caches: { darwin: ['Library/Caches/Yarn', '.yarn/berry/cache'], linux: ['.cache/yarn', '.yarn/berry/cache'] },
    hosts: ['registry.yarnpkg.com', 'repo.yarnpkg.com'],
  },
  {
    name: 'pip and uv',
    files: ['pyproject.toml', 'requirements.txt', 'uv.lock', 'poetry.lock', 'Pipfile', 'setup.py'],
    caches: {
      darwin: ['Library/Caches/pip', '.cache/uv', 'Library/Caches/pypoetry'],
      linux: ['.cache/pip', '.cache/uv', '.cache/pypoetry'],
    },
    hosts: ['pypi.org', 'files.pythonhosted.org'],
  },
  {
    name: 'Cargo',
    files: ['Cargo.toml'],
    caches: both('.cargo/registry', '.cargo/git'),
    hosts: ['crates.io', 'index.crates.io', 'static.crates.io'],
  },
  {
    name: 'Go',
    files: ['go.mod'],
    caches: { darwin: ['go/pkg/mod', 'Library/Caches/go-build'], linux: ['go/pkg/mod', '.cache/go-build'] },
    hosts: ['proxy.golang.org', 'sum.golang.org'],
  },
  { name: 'Ruby', files: ['Gemfile'], hosts: ['rubygems.org', 'index.rubygems.org'] },

  /* ---- Tools that download more as they install, by the packages that bring them ---- */
  {
    name: 'Playwright',
    packages: ['@playwright/test', 'playwright', 'playwright-core'],
    caches: { darwin: ['Library/Caches/ms-playwright'], linux: ['.cache/ms-playwright'] },
    hosts: ['cdn.playwright.dev', 'playwright.download.prss.microsoft.com', 'playwright.azureedge.net'],
  },
  {
    name: 'Electron',
    packages: ['electron'],
    caches: { darwin: ['Library/Caches/electron'], linux: ['.cache/electron'] },
    hosts: ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
  },
  {
    name: 'Puppeteer',
    packages: ['puppeteer'],
    caches: both('.cache/puppeteer'),
    hosts: ['storage.googleapis.com'],
  },
  {
    name: 'Cypress',
    packages: ['cypress'],
    caches: { darwin: ['Library/Caches/Cypress'], linux: ['.cache/Cypress'] },
    hosts: ['download.cypress.io', 'cdn.cypress.io'],
  },
  {
    // Native addons build against Node's headers, which node-gyp downloads.
    name: 'node-gyp',
    packages: ['node-gyp', 'node-gyp-build', 'node-addon-api', 'better-sqlite3'],
    caches: { darwin: ['Library/Caches/node-gyp'], linux: ['.cache/node-gyp'] },
    hosts: ['nodejs.org'],
  },
]

/** Where a tool keeps its downloads on this platform, from the home folder as `~/…`; none where the sandbox doesn't run. */
export const cachesOf = (tool: ToolPlaces, platform: NodeJS.Platform): ReadonlyArray<string> =>
  (platform === 'darwin' ? tool.caches?.darwin : platform === 'linux' ? tool.caches?.linux : undefined)?.map((folder) => `~/${folder}`) ??
  []
