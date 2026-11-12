import { cleanup, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ChangeSummary, ThreadSnapshot } from '@althar/contracts'

import { Outputs } from '../src/renderer/features/task/Outputs'
import { change, fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * A sanity pass over what a task's pull request card offers the person: here,
 * commits that wait on the task's branch for Ship (docs/decisions/tasks.md,
 * "What the turn commits waits for Ship"), before Ship and while Ship's review
 * reads them, as PR #820's two did. Each test names a state the runtime gives,
 * and asserts what the decisions say the card offers.
 */

const show = (snap: ThreadSnapshot) =>
  withServices(
    <Outputs
      snapshot={snap}
      pending={false}
      doing={null}
      error={null}
      merging={null}
      mergeRefused={null}
      onAccept={vi.fn()}
      onMergeHere={vi.fn()}
      onOpenChange={vi.fn()}
      onPush={vi.fn()}
      onMarkReady={vi.fn()}
      onMarkAllReady={vi.fn()}
      onOpenFile={vi.fn()}
      onPushBranch={vi.fn()}
      onConnect={vi.fn()}
      onReplace={vi.fn()}
      onBringIn={vi.fn()}
      onShip={vi.fn()}
      onMergeWaiting={vi.fn()}
    />,
    fakeClient().client,
  )

/**
 * A task whose draft pull request is open, and two commits the person's turns with its lead made wait for Ship on its
 * branch: as the runtime gives it, `held` on the task, the commits ahead of the pull request, and no `pushing` (the runtime
 * says nothing of a hold for Ship there). `phase` and `step` as where it stands.
 */
const heldForShip = (phase: 'ready' | 'running', step: string | null): ThreadSnapshot => {
  const pr: ChangeSummary = change({
    number: 820,
    url: 'https://github.com/meridian/api/pull/820',
    draft: true,
    checks: {
      outcome: 'passed',
      passed: 1,
      failed: 0,
      running: 0,
      total: 1,
      failing: [],
      list: [{ name: 'verify', state: 'passed', summary: null }],
    },
    head: 'abc123',
    localHead: 'def456',
    unpushed: 2,
  })
  const base = snapshot({ session: null })
  return { ...base, task: { ...base.task, phase, step, changes: [pr], held: { since: '2026-11-12T17:59:54.031Z', commits: 2 } } }
}

describe('commits held for Ship, as the task’s pull request card offers them', () => {
  // Finding (sanity pass): what the person's turns commit waits for Ship, and the runtime refuses the person's Push of it
  // (ShipRefused) until Ship sends it up. Ready, the card offers Ship and no Push. But once the person presses Ship the task is
  // under way (Ship's review reads the commits), and Outputs drops the hold (`held = ready ? task.held : undefined`): with
  // no `pushing` on the pull request the commits read as the person's to push, so the card offers "Push 2 commits" beside
  // the Ship under way, a push that would skip the review they just asked for and that Althar refuses. PR #820's card did
  // (the person's screenshot at 18:03:28, Ship pressed at 18:03:20, shipped at 18:06:15). Flips to passing when fixed.
  it.fails('offers no Push for the commits Ship’s review is reading', () => {
    show(heldForShip('ready', null))
    expect(screen.getByRole('button', { name: 'Ship 2 commits' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Push 2 commits' })).toBeNull()
    cleanup()
    // The person pressed Ship: its review reads the two commits.
    show(heldForShip('running', 'review'))
    expect(screen.queryByRole('button', { name: 'Push 2 commits' })).toBeNull()
  })
})
