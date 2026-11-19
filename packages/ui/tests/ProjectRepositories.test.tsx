import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAP_HOSTS, MAP_MERIDIAN } from '../src/fixtures/setup'
import { ProjectRepositories } from '../src/screens/ProjectRepositories/ProjectRepositories'

/* A project's repositories on its settings page: the map, with only what the page gives it. */

describe('a project’s repositories', () => {
  it('offers no way to connect, open or leave one out where the page gives none, and says its worktrees aren’t made yet', () => {
    render(
      <ProjectRepositories
        project="Meridian"
        repositories={MAP_MERIDIAN}
        hosts={MAP_HOSTS}
        onTargetChange={() => {}}
        text={{ note: 'Where its tasks work.' }}
      />,
    )
    expect(screen.getByText('Where its tasks work.')).toBeInTheDocument()
    expect(screen.getByText('Tasks work in their own worktrees')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect GitLab' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^More for/ })).not.toBeInTheDocument()
  })
})

describe('choosing one to clone, put away', () => {
  afterEach(() => vi.useRealTimers())

  /** What chooses one, counting each time it starts and stops, as a sign-in under way would. */
  const life = { started: 0, stopped: 0 }
  function Chooser() {
    useEffect(() => {
      life.started += 1
      return () => {
        life.stopped += 1
      }
    }, [])
    return <button type="button">Clone meridian/mobile</button>
  }
  const page = (open: boolean) => (
    <ProjectRepositories
      project="Meridian"
      repositories={MAP_MERIDIAN}
      hosts={MAP_HOSTS}
      onTargetChange={() => {}}
      onClone={() => {}}
      cloning={open ? <Chooser /> : null}
    />
  )

  it('stops at once, leaving only a still picture of it to fold away, and starts afresh when opened again', () => {
    vi.useFakeTimers()
    life.started = 0
    life.stopped = 0
    const { rerender, container } = render(page(true))
    expect(life).toEqual({ started: 1, stopped: 0 })
    rerender(page(false))
    // Stopped the moment it is put away, not once it has folded.
    expect(life.stopped).toBe(1)
    // What folds away is a picture: there to see, nothing in it to press or read out.
    const picture = container.querySelector('[inert][aria-hidden]')
    expect(picture?.textContent).toBe('Clone meridian/mobile')
    expect(picture?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Clone meridian/mobile' })).toBeNull()
    // Opened again before it has folded: a new one, and the picture gone with it.
    rerender(page(true))
    expect(life).toEqual({ started: 2, stopped: 1 })
    expect(screen.getAllByText('Clone meridian/mobile')).toHaveLength(1)
    rerender(page(false))
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(container.querySelector('[inert][aria-hidden]')?.textContent).toBe('')
  })
})
