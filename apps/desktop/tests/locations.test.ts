import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { locations } from '../src/main/locations'

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
