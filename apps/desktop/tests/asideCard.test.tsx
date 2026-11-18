import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Card, type CardActions } from '../src/renderer/features/project/Card'

import { agents, card, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * An aside the coordinator started (a quick job on Scratch, off the board), in
 * its thread: its own card, which never shows a task's steps or lead, says it
 * is an aside on Scratch, puts its result first, and opens beside the
 * coordinator.
 */

const actions = (over: Partial<CardActions> = {}): CardActions => ({
  project: 'meridian',
  agents,
  agentName: (id) => id ?? '',
  onStart: vi.fn(),
  onHold: vi.fn(),
  onChange: vi.fn(),
  onCreateBranch: vi.fn(),
  onOpen: vi.fn(),
  onStopBackground: vi.fn(),
  ...over,
})

const aside = (over: Parameters<typeof card>[0] = {}) =>
  card({ scratch: true, plan: { ...card().plan!, startsAt: null, preset: 'Chat' }, ...over })

describe("an aside's card in the coordinator's thread", () => {
  it('says it is an aside on Scratch, with no steps and no lead, and opens beside the coordinator', async () => {
    const onOpenAside = vi.fn()
    const onOpen = vi.fn()
    withServices(
      <Card
        card={aside({ phase: 'running', latest: { at: '2026-11-18T19:30:00.000Z', by: 'lead', said: 'Reading scripts/release.ts' } })}
        actions={actions({ onOpen, onOpenAside })}
      />,
      fakeClient().client,
    )
    expect(screen.getByText('Aside on Scratch')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Reading scripts/release.ts')).toBeTruthy()
    expect(screen.queryByText('Implement')).toBeNull()
    expect(screen.queryByText('Lead')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Open aside/ }))
    expect(onOpenAside).toHaveBeenCalledWith('t1', expect.any(String))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('puts its result first once it is ready', () => {
    withServices(
      <Card card={aside({ phase: 'ready', summary: 'It tags from the version.\nMore after.' })} actions={actions()} />,
      fakeClient().client,
    )
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText(/It tags from the version/)).toBeTruthy()
  })

  it('says it failed where its lead ended unasked, and the person stopping it is a stop', () => {
    const { unmount } = withServices(
      <Card card={aside({ phase: 'stopped', stopped: { by: 'althar', at: null } })} actions={actions()} />,
      fakeClient().client,
    )
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText(/Open it to try again/)).toBeTruthy()
    unmount()
    withServices(
      <Card card={aside({ phase: 'stopped', stopped: { by: 'interrupted', at: null } })} actions={actions()} />,
      fakeClient().client,
    )
    expect(screen.getByText('Stopped')).toBeTruthy()
    expect(screen.getByText('Stopped when you interrupted it')).toBeTruthy()
  })

  it('opens as a task does where nothing opens asides in place', async () => {
    const onOpen = vi.fn()
    withServices(<Card card={aside({ phase: 'ready', summary: 'Done.' })} actions={actions({ onOpen })} />, fakeClient().client)
    await userEvent.click(screen.getByRole('button', { name: /Open aside/ }))
    expect(onOpen).toHaveBeenCalled()
  })

  it('leaves a task on the board its own card, with its steps', () => {
    withServices(
      <Card card={card({ phase: 'running', plan: { ...card().plan!, startsAt: null } })} actions={actions()} />,
      fakeClient().client,
    )
    expect(screen.queryByText('Aside on Scratch')).toBeNull()
    expect(screen.getByRole('button', { name: /Open task/ })).toBeTruthy()
  })
})
