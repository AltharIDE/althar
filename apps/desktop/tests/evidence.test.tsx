import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Evidence, ThreadSnapshot } from '@althar/contracts'
import { EvidenceKind } from '@althar/ui'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { pieceOf, taskEvidence } from '../src/renderer/shared/evidence'
import { change, fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * What a lead showed of its change working (finish_step's evidence), in the
 * window: under its step in the thread, and the whole of it under what the
 * task changed, with what it couldn't show. Once the lead says what the
 * task built, that leads it, closing the thread and topping the Outputs.
 */

const DIGEST = 'a'.repeat(64)
const piece = (over: Partial<Evidence>): Evidence => ({
  kind: 'note',
  caption: 'A note',
  picture: null,
  command: null,
  exit: null,
  text: null,
  dropped: 0,
  ...over,
})
const PICTURE = { digest: DIGEST, mediaType: 'image/png', bytes: 2048, width: 1440, height: 900, name: 'evidence.png', unkept: null }
const SHOT = piece({ kind: 'screenshot', caption: 'The Evidence section under the step', picture: PICTURE })
const RUN = piece({
  kind: 'test_run',
  caption: 'The kit’s tests',
  command: 'bun run test',
  exit: 0,
  text: 'Tests  4 passed (4)\n',
  dropped: 3,
})

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

describe('evidence, as the window draws it', () => {
  it('draws a screenshot by its digest, a run by what it printed, and a note as said', () => {
    expect(pieceOf(SHOT, 's')).toEqual({
      id: 's',
      kind: EvidenceKind.Screenshot,
      caption: 'The Evidence section under the step',
      form: 'picture',
      shot: {
        name: 'evidence.png',
        alt: 'The Evidence section under the step',
        src: `althar-picture://shot/${DIGEST}`,
        thumb: `althar-picture://shot/${DIGEST}?w=1120`,
        meta: '1440 × 900 · 2 KB',
        width: 1440,
        height: 900,
      },
    })
    expect(pieceOf(RUN, 'r')).toEqual({
      id: 'r',
      kind: EvidenceKind.TestRun,
      caption: 'The kit’s tests',
      form: 'output',
      command: 'bun run test',
      exit: 0,
      lines: ['Tests  4 passed (4)'],
      omitted: 3,
    })
    // A response has no command, and still opens to what it said; a note is said as it is.
    expect(pieceOf(piece({ kind: 'response', caption: '422', text: '{}' }), 'x')).toMatchObject({ form: 'output', lines: ['{}'] })
    expect(pieceOf(piece({ caption: 'A typo', text: 'Nothing to show.' }), 'n')).toEqual({
      id: 'n',
      kind: EvidenceKind.Note,
      caption: 'A typo',
      form: 'note',
      text: 'Nothing to show.',
    })
    // One Althar couldn't keep says why.
    expect(
      pieceOf(piece({ kind: 'screenshot', caption: 'Big', picture: { ...PICTURE, digest: null, unkept: 'too_large' } }), 'b'),
    ).toMatchObject({ form: 'picture', shot: { status: 'failed', meta: 'Not kept: larger than 20 MB' } })
  })

  it('takes a task’s evidence from each of its lead’s steps, and what it last said it couldn’t show', () => {
    const implement = items.step({ evidence: [SHOT], unverified: ['Not seen in Safari'] })
    const review = items.step({ step: 'review', verdict: 'changes_requested' })
    // A step that doesn't say leaves the list standing.
    const shown = taskEvidence([implement, review, items.step({ step: 'settle', round: 0, evidence: [RUN] })])
    expect(shown.pieces.map((one) => one.caption)).toEqual(['The Evidence section under the step', 'The kit’s tests'])
    expect(shown.unverified).toEqual(['Not seen in Safari'])
    // One that says none clears it: it has shown it since.
    expect(taskEvidence([implement, review, items.step({ step: 'settle', round: 0, evidence: [RUN], unverified: [] })]).unverified).toEqual(
      [],
    )
  })

  it('shows it under the lead’s step in the thread, and under what the task changed, its screenshot opening full size', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [items.step({ evidence: [SHOT, RUN], unverified: ['Not tried in a real browser'] })],
          task: { ...snapshot().task, changes: [change()] },
        }),
      ),
    })
    withServices(<Task />, client)
    // In the thread, under the summary.
    const run = await screen.findByRole('button', { name: 'What it printed: The kit’s tests' })
    expect(run.textContent).toContain('exit 0')
    expect(screen.getByRole('heading', { name: 'Unverified' })).toBeTruthy()
    expect(screen.getByText('Not tried in a real browser')).toBeTruthy()
    // Under what it changed, where the person decides on it.
    await userEvent.click(screen.getByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByRole('heading', { name: 'Evidence', level: 2 })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'View The Evidence section under the step full size' }))
    const dialog = await screen.findByRole('dialog', { name: 'The Evidence section under the step' })
    expect(within(dialog).getByRole('img', { name: 'The Evidence section under the step' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('takes what the task built from the last of its lead’s steps that said it', () => {
    const implement = items.step({ built: 'A retry.' })
    const review = items.step({ step: 'review', verdict: 'changes_requested' })
    expect(taskEvidence([implement, review]).built).toBe('A retry.')
    // Settling that changed the work says it again; one that didn't leaves it standing.
    expect(taskEvidence([implement, review, items.step({ step: 'settle', built: 'A retry, named.' })]).built).toBe('A retry, named.')
    expect(taskEvidence([implement, review, items.step({ step: 'settle' })]).built).toBe('A retry.')
    expect(taskEvidence([review]).built).toBeNull()
  })

  it('closes the thread with what the task built, then its proof, and tops the Outputs with them', async () => {
    const built = 'Checkout retries once when the payment call fails.\n\n- Try a checkout with the network off.'
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [
            items.step({ evidence: [SHOT, RUN], unverified: ['Not tried in a real browser'], built: 'A first go.' }),
            items.step({ step: 'review', verdict: 'changes_requested', summary: 'The name is off.' }),
            items.step({ step: 'settle', summary: 'Renamed it.', built }),
            items.step({ step: 'review', verdict: 'pass', summary: 'It holds.' }),
          ],
          task: { ...snapshot().task, phase: 'ready', changes: [change()] },
        }),
      ),
    })
    withServices(<Task />, client)
    // Ready, it opens on its Outputs: what it built at the top, as it now stands, above what it changed.
    const heading = await screen.findByRole('heading', { name: 'What it built', level: 2 })
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.slice(0, 3).map((one) => one.textContent)).toEqual(['What it built', 'Evidence', 'Unverified'])
    expect(headings.indexOf(heading)).toBe(0)
    expect(screen.getByText('Checkout retries once when the payment call fails.')).toBeTruthy()
    expect(screen.queryByText('A first go.')).toBeNull()
    // The closing card, at the end of the thread.
    await userEvent.click(screen.getByRole('radio', { name: /Conversation/ }))
    const card = await screen.findByRole('article', { name: 'What the task built' })
    expect(within(card).getByText('Try a checkout with the network off.')).toBeTruthy()
    expect(
      within(card)
        .getAllByRole('heading')
        .map((one) => one.textContent),
    ).toEqual(['What it built', 'Evidence', 'Unverified'])
    // What the steps showed is gathered there, not shown again under them.
    expect(screen.getAllByRole('button', { name: 'What it printed: The kit’s tests' })).toHaveLength(1)
    expect(within(card).getByRole('button', { name: 'What it printed: The kit’s tests' })).toBeTruthy()
    expect(screen.getByText('It holds.').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the closing card back while a step is under way, its evidence under its step', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [items.step({ evidence: [RUN], built: 'A retry.' })],
          task: { ...snapshot().task, phase: 'running', step: 'review' },
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByRole('button', { name: 'What it printed: The kit’s tests' })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'What the task built' })).toBeNull()
  })

  it('keeps what the task built when its report is on an earlier page than the one read', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          // A long review came after it: the page read starts there.
          items: [items.step({ step: 'review', verdict: 'pass', summary: 'It holds.' })],
          earlier: true,
          reports: [items.step({ evidence: [RUN], unverified: ['Not in Safari'], built: 'A retry, on the checkout.' })],
          task: { ...snapshot().task, phase: 'ready', changes: [change()] },
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByRole('heading', { name: 'What it built', level: 2 })).toBeTruthy()
    expect(screen.getByText('A retry, on the checkout.')).toBeTruthy()
    expect(screen.getByText('Not in Safari')).toBeTruthy()
  })
})
