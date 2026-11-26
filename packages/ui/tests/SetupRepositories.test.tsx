import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Brand } from '../src/foundations/brands/brands'
import { type HostedRepository, type SetupHost, SetupRepositories } from '../src/setup/ProjectSetup/ProjectSetup'

/* The repositories a clone is chosen from: several chosen at once, and a host that lists fewer than its account has. */

const GITHUB: SetupHost = { id: 'github', name: 'GitHub', brand: Brand.GitHub, thing: 'repository', connected: true, how: 'With a token' }
const GITLAB: SetupHost = { id: 'gitlab', name: 'GitLab', brand: Brand.GitLab, thing: 'project', connected: false, how: 'With a token' }

const repository = (owner: string, name: string): HostedRepository => ({
  id: `gh:${owner}/${name}`,
  host: 'github',
  owner,
  name,
  description: null,
  private: false,
  pushed: null,
  like: false,
  here: null,
})

const REPOSITORIES = [repository('meridian', 'api'), repository('meridian', 'web'), repository('you', 'dotfiles')]

const list = (props: Partial<Parameters<typeof SetupRepositories>[0]> = {}) =>
  render(
    <SetupRepositories
      hosts={[GITHUB, GITLAB]}
      repositories={REPOSITORIES}
      query=""
      onQuery={vi.fn()}
      chosen={null}
      onChoose={vi.fn()}
      onConnect={vi.fn()}
      height={240}
      {...props}
    />,
  )

afterEach(cleanup)

describe('the repositories a clone is chosen from', () => {
  it('shows each of several chosen as chosen, and the one alone as one does', () => {
    const onChoose = vi.fn()
    list({ chosen: ['gh:meridian/api', 'gh:you/dotfiles'], onChoose })
    expect(screen.getByRole('button', { name: 'Chosen meridian/api' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Chosen you/dotfiles' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Clone meridian/web' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Chosen meridian/api' }))
    expect(onChoose).toHaveBeenCalledWith('gh:meridian/api')
    cleanup()
    list({ chosen: 'gh:meridian/web' })
    expect(screen.getAllByRole('button', { name: /^Chosen / }).map((row) => row.getAttribute('aria-label'))).toEqual([
      'Chosen meridian/web',
    ])
  })

  it('says a host lists only what its token was given, or where its app is installed, with where it reaches more', () => {
    const onWiden = vi.fn()
    const limited = { host: 'github', by: 'token' as const, url: 'https://github.com/settings/personal-access-tokens' }
    list({ limited: [limited], onWiden })
    expect(screen.getByText(/Only the repositories your GitHub token was given are listed\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Give it more' }))
    expect(onWiden).toHaveBeenCalledWith(limited)
    cleanup()
    list({ limited: [{ host: 'github', by: 'app', url: 'https://github.com/settings/installations' }], onWiden })
    expect(screen.getByText(/Only the repositories Althar’s GitHub app is installed on are listed\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Install it on more' })).toBeTruthy()
    // Where it isn't known where it reaches more, it is said alone; a host not connected says nothing.
    cleanup()
    list({
      limited: [
        { host: 'github', by: 'token', url: null },
        { host: 'gitlab', by: 'token', url: null },
      ],
      onWiden,
    })
    expect(screen.queryByRole('button', { name: 'Give it more' })).toBeNull()
    expect(screen.queryByText(/GitLab/)).toBeNull()
  })
})
