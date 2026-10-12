import { homedir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { gitIn } from '../src/git'

/*
 * How a git command runs in a folder: where it is the document portal's FUSE
 * mount (inside a Flatpak), name the repository explicitly and use the stable
 * app home as cwd; everywhere else the process starts in the folder itself.
 */

describe('git in a folder', () => {
  it('starts in the folder itself, as it always has', () => {
    expect(gitIn('/home/me/project', ['status'])).toEqual({ args: ['status'], cwd: '/home/me/project' })
    expect(gitIn('/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t', ['status'])).toEqual({
      args: ['status'],
      cwd: '/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t',
    })
  })

  it('names the git directory and the work tree where it is the document portal’s FUSE mount, so nothing chdirs into it', () => {
    expect(gitIn('/run/flatpak/doc/abc/project', ['-c', 'x=y', 'status'])).toEqual({
      args: ['--git-dir', '/run/flatpak/doc/abc/project/.git', '--work-tree', '/run/flatpak/doc/abc/project', '-c', 'x=y', 'status'],
      cwd: homedir(),
    })
    expect(gitIn('/run/flatpak/doc', ['status'])).toEqual({
      args: ['--git-dir', '/run/flatpak/doc/.git', '--work-tree', '/run/flatpak/doc', 'status'],
      cwd: homedir(),
    })
    // A path that only begins like the portal is an ordinary folder.
    expect(gitIn('/run/flatpak/docx/project', ['status'])).toEqual({ args: ['status'], cwd: '/run/flatpak/docx/project' })
  })
})
