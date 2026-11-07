import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type Disk, refusalOf, refusals } from '../src/main/taskFolderCheck'

/** A disk of folders by path; `readOnly` ones can't be written, `repositories` have a .git. */
const disk = (folders: ReadonlyArray<string>, readOnly: ReadonlyArray<string> = [], repositories: ReadonlyArray<string> = []): Disk => ({
  isDirectory: (path) => folders.includes(path),
  writable: (path) => !readOnly.includes(path),
  exists: (path) => repositories.some((repository) => path === join(repository, '.git')),
  real: (path) => path,
})

const profile = '/home/ada/.local/share/althar'

describe('a folder for task folders', () => {
  it('is fine when it exists, is writable and is in no repository or profile', () => {
    expect(refusalOf('/data/tasks', profile, disk(['/data/tasks', profile]))).toBeNull()
  })

  it('must be a full path', () => {
    expect(refusalOf('tasks', profile, disk(['tasks']))).toBe(refusals.relative)
  })

  it('must exist, and be a folder', () => {
    expect(refusalOf('/data/nothing', profile, disk(['/data']))).toBe(refusals.missing)
  })

  it('must be writable', () => {
    expect(refusalOf('/data/tasks', profile, disk(['/data/tasks'], ['/data/tasks']))).toBe(refusals.readOnly)
  })

  it('must not be inside a repository’s checkout, however deep', () => {
    const folders = ['/code/althar/build', '/code/althar']
    expect(refusalOf('/code/althar/build', profile, disk(folders, [], ['/code/althar']))).toBe(refusals.repository)
    expect(refusalOf('/code/althar', profile, disk(folders, [], ['/code/althar']))).toBe(refusals.repository)
  })

  it('must not be the profile or inside it', () => {
    const inside = join(profile, 'worktrees')
    expect(refusalOf(profile, profile, disk([profile]))).toBe(refusals.profile)
    expect(refusalOf(inside, profile, disk([inside]))).toBe(refusals.profile)
  })

  it('may be beside the profile, in a folder whose name starts the same', () => {
    expect(refusalOf(`${profile}-tasks`, profile, disk([`${profile}-tasks`]))).toBeNull()
  })

  it('follows links, as the profile may be reached by one', () => {
    const linked: Disk = { ...disk(['/link']), real: (path) => (path === '/link' ? join(profile, 'x') : path) }
    expect(refusalOf('/link', profile, linked)).toBe(refusals.profile)
  })
})
