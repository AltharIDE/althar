import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepositories, forWindow, placesFor, shownAt } from '../src/main/repositories'

/* The repositories the first screen offers: found where people keep code, newest work first, and handed to the window by id. */

/** A repository's bones, as git keeps them: HEAD on a branch, last touched `daysAgo`. */
const repo = (path: string, branch: string | null, daysAgo: number) => {
  mkdirSync(join(path, '.git', 'logs'), { recursive: true })
  writeFileSync(join(path, '.git', 'HEAD'), branch === null ? 'a1b2c3d4\n' : `ref: refs/heads/${branch}\n`)
  const when = new Date(Date.now() - daysAgo * 86_400_000)
  utimesSync(join(path, '.git', 'HEAD'), when, when)
  return path
}

describe('repositories where people keep code', () => {
  it('looks in the usual folders, and where Visual Studio and GitHub Desktop put them off a Mac, never in what a Mac guards', () => {
    const mac = placesFor('/Users/me', 'darwin')
    expect(mac).toContain('/Users/me/Projects')
    expect(mac).toContain('/Users/me/Developer')
    expect(mac.some((place) => /Documents|Desktop|Downloads/.test(place))).toBe(false)
    expect(placesFor('/home/me', 'linux')).toContain('/home/me/Documents/GitHub')
    expect(placesFor('C:\\Users\\me', 'win32').some((place) => place.endsWith(join('source', 'repos')))).toBe(true)
  })

  it('finds them a folder or two down, newest work first, each once, passing over worktrees, what builds fill, and repositories inside one', async () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-found-'))
    const projects = join(home, 'Projects')
    mkdirSync(join(projects, 'clients'), { recursive: true })
    repo(join(projects, 'meridian'), 'main', 2)
    repo(join(projects, 'clients', 'halyard'), 'checkout-v2', 0)
    repo(join(projects, 'detached'), null, 30)
    // Inside a repository, its vendored copy isn't offered on its own.
    repo(join(projects, 'meridian', 'vendor-lib'), 'main', 0)
    // A worktree's .git is a file; a build's folder and a hidden one are passed over; three down is too far.
    mkdirSync(join(projects, 'meridian-wt'))
    writeFileSync(join(projects, 'meridian-wt', '.git'), 'gitdir: ../meridian/.git/worktrees/wt\n')
    repo(join(projects, 'node_modules', 'left-pad'), 'main', 0)
    repo(join(projects, '.cache', 'hidden'), 'main', 0)
    repo(join(projects, 'clients', 'deep', 'er'), 'main', 0)
    // The same place twice, by a link, is looked in once.
    symlinkSync(projects, join(home, 'code'))

    const found = await findRepositories([...placesFor(home, 'darwin'), join(home, 'nowhere')])
    expect(found.lookedIn).toEqual([projects])
    expect(found.repositories.map(({ name, branch }) => [name, branch])).toEqual([
      ['halyard', 'checkout-v2'],
      ['meridian', 'main'],
      ['detached', null],
    ])
    expect(found.repositories[0]?.path).toBe(join(projects, 'clients', 'halyard'))
  })

  it('hands them to the window by id, where each is as the person knows the place, never by its path', async () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-found-'))
    repo(join(home, 'code', 'meridian'), 'main', 1)
    const ids = new Map<string, string>()
    const shown = forWindow(await findRepositories(placesFor(home, 'darwin')), home, (path) => {
      ids.set(`id${ids.size}`, path)
      return `id${ids.size - 1}`
    })
    expect(shown).toMatchObject({
      lookedIn: ['~/code'],
      repositories: [{ id: 'id0', name: 'meridian', where: '~/code/meridian', branch: 'main' }],
    })
    expect(JSON.stringify(shown)).not.toContain(home)
    expect(ids.get('id0')).toBe(join(home, 'code', 'meridian'))
    expect(shownAt(home, home)).toBe('~')
    expect(shownAt('/opt/src/x', home)).toBe('/opt/src/x')
  })
})
