import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type Disk, refusalOf, refusals, ROOT_MARKER, statusOf, taskFolderRefusal, taskRootIn } from '../src/main/taskFolderCheck'

/** A disk of folders by path; `readOnly` ones can't be written, `repositories` have a .git. */
const disk = (
  folders: ReadonlyArray<string>,
  readOnly: ReadonlyArray<string> = [],
  repositories: ReadonlyArray<string> = [],
  files: ReadonlyArray<string> = [],
): Disk => ({
  isDirectory: (path) => folders.includes(path),
  writable: (path) => !readOnly.includes(path),
  exists: (path) => files.includes(path) || repositories.some((repository) => path === join(repository, '.git')),
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

  it('is a folder of its own even where the pick is named Althar, so a pick holding checkouts keeps them apart', () => {
    expect(taskRootIn('/home/ada/Projects/Althar')).toBe(join('/home/ada/Projects/Althar', 'Althar'))
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

describe('a pick inside a root Althar made', () => {
  it('is refused, whichever root it was and however deep', () => {
    const inside = '/data/Althar/meridian'
    const folders = disk([inside, '/data/Althar'], [], [], [join('/data/Althar', ROOT_MARKER)])
    expect(taskFolderRefusal(inside, profile, folders, '/home/ada')).toBe(refusals.kept)
    expect(taskFolderRefusal('/data/Althar', profile, folders, '/home/ada')).toBe(refusals.kept)
  })

  it('does not refuse a folder beside one', () => {
    const folders = disk(['/data/other', '/data/Althar'], [], [], [join('/data/Althar', ROOT_MARKER)])
    expect(taskFolderRefusal('/data/other', profile, folders, '/home/ada')).toBeNull()
  })
})

describe('what an unusable chosen folder means', () => {
  it('says what happened, what it stops and the way out, for each reason', () => {
    for (const refusal of [refusals.missing, refusals.readOnly, refusals.repository]) {
      const line = statusOf('/Volumes/Ext/Althar', refusal, '/home/ada/Althar')
      expect(line).toContain('/Volumes/Ext/Althar')
      expect(line).toContain('new tasks are made in /home/ada/Althar for now')
      expect(line).toContain('use the default')
    }
    expect(statusOf('/x', refusals.missing, '/d')).toContain('can’t find')
  })
})
