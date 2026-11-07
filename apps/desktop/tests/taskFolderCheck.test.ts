import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type Disk, refusalOf, refusals, taskFolderRefusal, taskRootIn } from '../src/main/taskFolderCheck'

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

  it('must not be inside a toolchain folder the coordinator may read', () => {
    const inside = '/home/ada/.bun/tasks'
    expect(refusalOf(inside, profile, disk([inside]), '/home/ada')).toBe(refusals.toolchain)
    expect(refusalOf('/home/ada/.bun', profile, disk(['/home/ada/.bun']), '/home/ada')).toBe(refusals.toolchain)
    expect(refusalOf('/home/ada/tasks', profile, disk(['/home/ada/tasks']), '/home/ada')).toBeNull()
  })
})

describe('the folder made in a pick', () => {
  it('is a folder of Althar’s own in the pick, so it never lands among the person’s own folders', () => {
    expect(taskRootIn('/data/stuff')).toBe(join('/data/stuff', 'Althar'))
  })

  it('is the pick itself where it is named Althar already', () => {
    expect(taskRootIn('/data/Althar')).toBe('/data/Althar')
  })
})

describe('a pick through the sandbox’s file portal', () => {
  it('is refused with a line saying why', () => {
    const path = '/run/flatpak/doc/abc123/tasks'
    expect(taskFolderRefusal(path, profile, disk([path]), '/home/ada')).toBe(refusals.portal)
  })

  it('is otherwise checked as any folder', () => {
    expect(taskFolderRefusal('/data/tasks', profile, disk(['/data/tasks']), '/home/ada')).toBeNull()
  })
})
