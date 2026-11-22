import { readFile, statfs } from 'node:fs/promises'
import { cpus, release, totalmem } from 'node:os'
import { join } from 'node:path'

import type { HomeFolders, Machine } from '@althar/contracts'
import { Effect } from 'effect'

import { git } from './git'
import { clonePlaceFor, findRepositories, placesFor, shownAt } from './repositoriesFound'

/*
 * What a home says about itself to a window that isn't on its computer: where
 * people keep code there and where a new project's code goes (the folder
 * picker that answers this on a desktop is on the other computer), and what
 * the machine is. Each folder goes to the window by a grant the home made, as
 * the picker's do (docs/architecture/07: the window names no path).
 */

/** Where a new project's code goes where there is no usual place yet: made as the first one is. */
export const firstPlace = (home: string, platform: NodeJS.Platform) => join(home, platform === 'linux' ? 'projects' : 'Projects')

/**
 * The repositories found where people keep code under `home`, and the place
 * a clone or a new repository goes, each by a grant from `allow`. A folder is
 * granted once a launch, however often it's found.
 */
export const homeFolders = (allow: (path: string) => Effect.Effect<string>, home: string, platform: NodeJS.Platform = process.platform) => {
  const granted = new Map<string, string>()
  const grantOf = (path: string) =>
    Effect.suspend(() => {
      const known = granted.get(path)
      return known === undefined ? Effect.tap(allow(path), (grant) => Effect.sync(() => granted.set(path, grant))) : Effect.succeed(known)
    })
  return Effect.gen(function* () {
    const places = placesFor(home, platform)
    const found = yield* Effect.promise(() => findRepositories(places))
    const place = (yield* Effect.promise(() => clonePlaceFor(found, places))) ?? firstPlace(home, platform)
    const repositories = yield* Effect.forEach(found.repositories, (repository) =>
      Effect.map(grantOf(repository.real), (grant) => ({
        grant,
        name: repository.name,
        where: shownAt(repository.path, home),
        branch: repository.branch,
        worked: repository.worked,
      })),
    )
    return {
      lookedIn: found.lookedIn.map((one) => shownAt(one, home)),
      repositories,
      place: { grant: yield* grantOf(place), where: shownAt(place, home) },
    } satisfies HomeFolders
  })
}

/** The system's own name for itself: os-release's on Linux (Ubuntu 24.04.1 LTS), the product's on a Mac. */
const systemName = (platform: NodeJS.Platform): Effect.Effect<string> => {
  if (platform === 'linux')
    return Effect.promise(() =>
      readFile('/etc/os-release', 'utf8').then(
        (text) => /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(text)?.[1] ?? `Linux ${release()}`,
        () => `Linux ${release()}`,
      ),
    )
  if (platform === 'darwin')
    return Effect.promise(() =>
      readFile('/System/Library/CoreServices/SystemVersion.plist', 'utf8').then(
        (text) => {
          const version = /<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1]
          return version === undefined ? 'macOS' : `macOS ${version}`
        },
        () => 'macOS',
      ),
    )
  if (platform === 'win32') return Effect.succeed(`Windows ${release()}`)
  return Effect.succeed(`${platform} ${release()}`)
}

/** The room on the disk `path` is on; null where it can't be read. */
const diskOf = (path: string) =>
  Effect.promise(() =>
    statfs(path).then(
      (disk) => ({ free: disk.bavail * disk.bsize, size: disk.blocks * disk.bsize }),
      () => null,
    ),
  )

/** git's version, as `git --version` says it (2.43.0); null where there's no git. */
const gitVersion = (cwd: string) =>
  Effect.map(git(cwd, '--version'), (said) => /(\d+(?:\.\d+)+)/.exec(said)?.[1] ?? said.trim()).pipe(Effect.orElseSucceed(() => null))

/** What the machine is: its system, cores, memory, the room where `home` is, and git. */
export const machineFacts = (home: string, platform: NodeJS.Platform = process.platform): Effect.Effect<Machine> =>
  Effect.all(
    {
      system: systemName(platform),
      cores: Effect.sync(() => cpus().length),
      memory: Effect.sync(() => totalmem()),
      disk: diskOf(home),
      git: gitVersion(home),
    },
    { concurrency: 'unbounded' },
  )
