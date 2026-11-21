import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { locations, taskFolder } from '../src/main/locations'

const home = '/home/person'
const nothing = () => false

describe('where the app keeps its profile and worktrees', () => {
  it('keeps them as the command-line client does', () => {
    expect(locations({}, 'linux', home, nothing)).toEqual({
      profile: join(home, '.local', 'share', 'althar'),
      worktrees: join(home, 'Althar'),
    })
  })

  it('takes what the environment tells it', () => {
    expect(locations({ ALTHAR_PROFILE: '/p', ALTHAR_WORKTREES: '/w' }, 'linux', home, nothing)).toEqual({ profile: '/p', worktrees: '/w' })
  })

  it('keeps a Flatpak’s worktrees beside its profile, where they last: its home is fresh each run', () => {
    const env = { FLATPAK_ID: 'dev.althar.app', XDG_DATA_HOME: join(home, '.var', 'app', 'dev.althar.app', 'data') }
    expect(locations(env, 'linux', home, nothing)).toEqual({
      profile: join(env.XDG_DATA_HOME, 'althar'),
      worktrees: join(env.XDG_DATA_HOME, 'althar', 'worktrees'),
    })
  })

  it('leaves the Mac’s own places alone', () => {
    const mac = join(home, 'Library', 'Application Support')
    expect(locations({}, 'darwin', home, nothing)).toEqual({ profile: join(mac, 'Althar'), worktrees: join(home, 'Althar') })
  })
})

describe('where new tasks’ folders go: the environment, then the person’s choice, then the default', () => {
  it('goes by the platform’s default where nothing says otherwise', () => {
    expect(taskFolder({}, 'linux', home, nothing)).toMatchObject({ folder: join(home, 'Althar'), from: 'default' })
  })

  it('goes where the person chose, over the default', () => {
    expect(taskFolder({}, 'linux', home, nothing, '/chosen')).toMatchObject({ folder: '/chosen', from: 'setting' })
    expect(locations({}, 'linux', home, nothing, '/chosen').worktrees).toBe('/chosen')
  })

  it('goes where the person chose in a Flatpak too', () => {
    const env = { FLATPAK_ID: 'dev.althar.app', XDG_DATA_HOME: join(home, 'data') }
    expect(taskFolder(env, 'linux', home, nothing, '/chosen')).toMatchObject({ folder: '/chosen', from: 'setting' })
    expect(taskFolder(env, 'linux', home, nothing)).toMatchObject({ folder: join(home, 'data', 'althar', 'worktrees'), from: 'default' })
  })

  it('goes where the environment says, over what the person chose', () => {
    expect(taskFolder({ ALTHAR_WORKTREES: '/env' }, 'linux', home, nothing, '/chosen')).toMatchObject({
      folder: '/env',
      from: 'environment',
    })
  })

  it('takes an empty ALTHAR_WORKTREES as not set', () => {
    expect(taskFolder({ ALTHAR_WORKTREES: '' }, 'linux', home, nothing, '/chosen')).toMatchObject({ folder: '/chosen', from: 'setting' })
  })
})
