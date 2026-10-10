import { describe, expect, it } from 'vitest'

import { gitIn } from '../src/git'

/*
 * How a git command runs in a folder: with `-C` only where the folder is the
 * document portal's FUSE mount (inside a Flatpak), where a process cwd makes
 * getcwd fail; everywhere else the process starts in it, as it always has.
 */

describe('git in a folder', () => {
  it('starts in the folder itself, as it always has', () => {
    expect(gitIn('/home/me/project', ['status'])).toEqual({ args: ['status'], cwd: '/home/me/project' })
    expect(gitIn('/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t', ['status'])).toEqual({
      args: ['status'],
      cwd: '/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t',
    })
  })

  it('gives the folder with -C where it is the document portal’s FUSE mount', () => {
    expect(gitIn('/run/flatpak/doc/abc/project', ['-c', 'x=y', 'status'])).toEqual({
      args: ['-C', '/run/flatpak/doc/abc/project', '-c', 'x=y', 'status'],
    })
    expect(gitIn('/run/flatpak/doc', ['status'])).toEqual({ args: ['-C', '/run/flatpak/doc', 'status'] })
    // A path that only begins like the portal is an ordinary folder.
    expect(gitIn('/run/flatpak/docx/project', ['status'])).toEqual({ args: ['status'], cwd: '/run/flatpak/docx/project' })
  })
})
