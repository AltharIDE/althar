import { act, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAP_HALYARD, MAP_HOSTS, MAP_MERIDIAN } from '../src/fixtures/setup'
import { ChangeTarget } from '../src/foundations/vocabulary'
import { RepositoryMap, type RepositoryMapProps } from '../src/setup/RepositoryMap/RepositoryMap'

/*
 * A project's repositories on the left, where their work goes on the right,
 * and a wire between each, drawn from where the two sit on the page.
 */

const map = (more: Partial<RepositoryMapProps> = {}) => {
  const props: RepositoryMapProps = {
    repositories: MAP_MERIDIAN,
    hosts: MAP_HOSTS,
    onRoleChange: () => {},
    onTargetChange: () => {},
    ...more,
  }
  const shown = render(<RepositoryMap {...props} />)
  return { ...shown, again: (next: Partial<RepositoryMapProps>) => shown.rerender(<RepositoryMap {...props} {...next} />) }
}

const wires = () => [...document.querySelectorAll('svg g')]
const paths = () => wires().map((g) => g.querySelector('path')?.getAttribute('d'))

/* A resize observer the test fires. */
function resizes() {
  const seen: (() => void)[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        seen.push(cb)
      }
      observe() {}
      disconnect() {}
    },
  )
  return () => act(() => seen.forEach((f) => f()))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('where each repository’s work goes', () => {
  it('says a host is connected without naming whose account where it doesn’t know', () => {
    map({ hosts: [{ ...MAP_HOSTS[0]!, account: undefined }, MAP_HOSTS[1]!] })
    expect(screen.getByRole('region', { name: 'GitHub' })).toHaveTextContent('Connected')
    expect(screen.getByRole('region', { name: 'GitHub' })).not.toHaveTextContent('Connected as')
  })

  it('names a host it has no details of by how the remote names it', () => {
    map({
      repositories: [
        { ...MAP_MERIDIAN[0]!, remote: { host: 'git.meridian.dev', path: 'meridian/app', href: 'https://git.meridian.dev/meridian/app' } },
      ],
    })
    expect(screen.getByText('Its work goes to meridian/app on git.meridian.dev.')).toBeInTheDocument()
  })

  it('hands its element to a ref given as a function or an object', () => {
    const seen = vi.fn()
    const { unmount } = map({ ref: seen })
    expect(seen).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    unmount()
    const held = createRef<HTMLDivElement>()
    map({ ref: held })
    expect(held.current).toBeInstanceOf(HTMLDivElement)
  })
})

describe('a fork’s branches', () => {
  const forkWith = (fork: { target: ChangeTarget; canPush?: boolean }) =>
    MAP_HALYARD.map((one) => (one.fork === undefined ? one : { ...one, fork: { ...one.fork, ...fork } }))
  const NO_PUSH = 'You can’t push to halyard/api yet. Its owners can give you access.'

  it('says nothing of pushing there until its host has said', () => {
    map({ repositories: forkWith({ target: ChangeTarget.Upstream }) })
    expect(screen.queryByText(NO_PUSH)).toBeNull()
    expect(screen.getByText('It pushes to balazs/halyard-api on GitHub, and its pull requests open on halyard/api.')).toBeTruthy()
  })

  it('says plainly where its host says the person can’t push there', () => {
    map({ repositories: forkWith({ target: ChangeTarget.Upstream, canPush: false }) })
    expect(screen.getByText(NO_PUSH)).toBeTruthy()
  })

  it('draws one wire to the repository it forks where they go there, and says so', () => {
    map({ repositories: forkWith({ target: ChangeTarget.UpstreamBranch, canPush: true }) })
    expect(wires()).toHaveLength(1)
    expect(screen.getByText('pushes, pull requests')).toBeTruthy()
    expect(screen.getByText('It pushes to halyard/api on GitHub, and its pull requests open on halyard/api.')).toBeTruthy()
    expect(screen.queryByText(NO_PUSH)).toBeNull()
  })

  it('draws them on the fork, where they go, once its host says the person no longer can', () => {
    map({ repositories: forkWith({ target: ChangeTarget.UpstreamBranch, canPush: false }) })
    expect(wires()).toHaveLength(2)
    expect(screen.getByText('It pushes to balazs/halyard-api on GitHub, and its pull requests open on halyard/api.')).toBeTruthy()
    expect(screen.getByText(NO_PUSH)).toBeTruthy()
  })
})

describe('the repository a fork forks, among its clone’s remotes', () => {
  const forkWith = (remote: string | null | undefined) =>
    MAP_HALYARD.map((one) =>
      one.fork === undefined ? one : { ...one, fork: { ...one.fork, ...(remote === undefined ? {} : { remote }) } },
    )
  const NO_REMOTE = 'Your clone has no remote for halyard/api, so tasks start from your fork, and you can’t push branches there yourself.'

  it('names the remote its clone has it as, where that isn’t upstream', () => {
    map({ repositories: forkWith('base') })
    expect(screen.getByText('The repository it forks, as base')).toBeTruthy()
    expect(screen.queryByText(NO_REMOTE)).toBeNull()
  })

  it('says only what it is, as upstream or unsaid', () => {
    for (const remote of ['upstream', undefined]) {
      const { unmount } = map({ repositories: forkWith(remote) })
      expect(screen.getByText('The repository it forks')).toBeTruthy()
      unmount()
    }
  })

  it('offers to add it where none of the remotes is it, with the button beside what it says', () => {
    const onAddRemote = vi.fn()
    map({ repositories: forkWith(null), onAddRemote })
    expect(screen.getByText(NO_REMOTE)).toBeTruthy()
    act(() => screen.getByRole('button', { name: 'Add it as a remote' }).click())
    expect(onAddRemote).toHaveBeenCalledWith('halyard')
  })

  it('says so without a button where there is no way to add it here', () => {
    map({ repositories: forkWith(null) })
    expect(screen.getByText(NO_REMOTE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add it as a remote' })).toBeNull()
  })
})

describe('its wires', () => {
  it('draws a wire for a repository added after the map was drawn as new, to draw itself in', () => {
    const { again } = map({ repositories: MAP_MERIDIAN.slice(0, 2) })
    expect(wires().map((g) => g.getAttribute('class') ?? '')).toEqual(['', ''])
    again({ repositories: MAP_MERIDIAN })
    expect(wires()).toHaveLength(3)
    /* the GitLab one is dashed, as Althar isn't connected there, and new */
    expect(wires()[2]?.getAttribute('class')).toBe('dashed fresh')
    expect(wires()[0]?.getAttribute('class') ?? '').toBe('')
  })

  it('redraws its wires when a resize moves the cards, and leaves them when it moves nothing', () => {
    const resize = resizes()
    map()
    const before = paths()
    resize()
    expect(paths()).toEqual(before)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: 40, bottom: 80, height: 40, left: 20, right: 320, width: 300, x: 20, y: 40, toJSON: () => ({}) } as DOMRect
    })
    resize()
    expect(paths()).not.toEqual(before)
  })

  it('draws its wires once where the page cannot watch sizes', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    map()
    expect(wires()).toHaveLength(3)
  })

  it('redraws once the type has loaded, as it moves everything a little', async () => {
    let loaded = () => {}
    const ready = new Promise<void>((done) => (loaded = done))
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } })
    try {
      map()
      const before = paths()
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { top: 10, bottom: 50, height: 40, left: 0, right: 300, width: 300, x: 0, y: 10, toJSON: () => ({}) } as DOMRect
      })
      await act(async () => loaded())
      expect(paths()).not.toEqual(before)
    } finally {
      delete (document as unknown as Record<string, unknown>).fonts
    }
  })
})
