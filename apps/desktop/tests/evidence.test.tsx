import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Evidence, ThreadSnapshot } from '@althar/contracts'
import { EvidenceKind } from '@althar/ui'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { pieceOf } from '../src/renderer/shared/evidence'
import { outcomeOf, splitStory } from '../src/renderer/shared/outcome'
import { change, fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * What a lead showed of its change working (finish_step's evidence), in the
 * window: under its step in the thread, and on the Outputs, what the task
 * looks like now beside what it changed, with what it couldn't show. Once
 * the lead says what the task built, that closes the thread; the Outputs
 * says what it is as its pull request does.
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
  it('says each kind of piece as the kit names it', () => {
    const kinds = (['screenshot', 'recording', 'command', 'test_run', 'response', 'log', 'note'] as const).map(
      (kind) => pieceOf(piece({ kind, ...(kind === 'note' ? {} : { text: 'printed' }) }), kind).kind,
    )
    expect(kinds).toEqual([
      EvidenceKind.Screenshot,
      EvidenceKind.Recording,
      EvidenceKind.Command,
      EvidenceKind.TestRun,
      EvidenceKind.Response,
      EvidenceKind.Log,
      EvidenceKind.Note,
    ])
  })

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

  it('takes what its lead last checked of it, and what it last said it couldn’t show', () => {
    const implement = items.step({ evidence: [SHOT], unverified: ['Not seen in Safari'] })
    const review = items.step({ step: 'review', verdict: 'changes_requested' })
    // A step that doesn't say leaves the list standing; what it checked is its own.
    const shown = outcomeOf(snapshot({ items: [implement, review, items.step({ step: 'settle', round: 0, evidence: [RUN] })] }))
    expect(shown.checked.map((one) => one.caption)).toEqual(['The kit’s tests'])
    expect(shown.unverified).toEqual(['Not seen in Safari'])
    // One that says none clears it: it has shown it since.
    expect(
      outcomeOf(snapshot({ items: [implement, review, items.step({ step: 'settle', round: 0, evidence: [RUN], unverified: [] })] }))
        .unverified,
    ).toEqual([])
  })

  it('shows a change as it is now: its pictures since it became one, each view once, as last taken', () => {
    const at = (time: string, item: ReturnType<typeof items.step>) => ({ ...item, createdAt: time })
    const shot = (caption: string, digest: string) =>
      piece({ kind: 'screenshot', caption, picture: { ...PICTURE, digest: digest.repeat(64) } })
    const rounds = [
      // A prototype's round, before it was made a change.
      at('2026-10-18T10:00:00.000Z', items.step({ evidence: [shot('A1 · The old panel', 'a'), shot('B1 · A direction', 'b')] })),
      at('2026-10-18T12:00:00.000Z', items.step({ evidence: [shot('A1 · Settings as a page', 'c'), shot('A2 · Its rules', 'd')] })),
      // Settling took one view again.
      at('2026-10-18T13:00:00.000Z', items.step({ step: 'settle', evidence: [shot('A2 · Its rules, fixed', 'e')] })),
    ]
    const made = (madeChangeAt: string | null) =>
      outcomeOf(snapshot({ items: rounds, task: { ...snapshot().task, kind: 'change', changes: [change()], madeChangeAt } })).shots
    expect(made('2026-10-18T11:00:00.000Z').map((one) => one.caption)).toEqual(['A1 · Settings as a page', 'A2 · Its rules, fixed'])
    // A change from the start: every round is its own, each view once.
    expect(made(null).map((one) => one.caption)).toEqual(['B1 · A direction', 'A1 · Settings as a page', 'A2 · Its rules, fixed'])
    // A task that isn't a change: its last round that showed pictures, and those after.
    expect(
      outcomeOf(snapshot({ items: rounds.slice(0, 2), task: { ...snapshot().task, kind: 'plain' } })).shots.map((one) => one.caption),
    ).toEqual(['A1 · Settings as a page', 'A2 · Its rules'])
  })

  it('says what it is as its pull request does: the lead’s description, else what it built, else its last summary', () => {
    const built = items.step({ built: 'A retry.' })
    const described = items.step({ step: 'settle', descriptions: { meridian: 'Checkout retries once.\n\nThe rest of it.' } })
    expect(outcomeOf(snapshot({ items: [built, described] })).story).toEqual({ lede: 'Checkout retries once.', rest: 'The rest of it.' })
    expect(outcomeOf(snapshot({ items: [built] })).story?.lede).toBe('A retry.')
    // In several repositories, what it built says what it is, and each one's description as last given follows under its name.
    const several = [
      items.step({
        built: 'Checkout retries twice now.\n\nWhat to try next.',
        descriptions: { api: 'Api retries once.', web: 'Web retries.' },
      }),
      items.step({ step: 'settle', descriptions: { api: 'Api retries twice now.' } }),
    ]
    expect(outcomeOf(snapshot({ items: several })).story).toEqual({
      lede: 'Checkout retries twice now.',
      rest: '# api\n\nApi retries twice now.\n\n# web\n\nWeb retries.',
    })
    expect(outcomeOf(snapshot({ items: [items.step({ summary: 'Looked into it.' })] })).story?.lede).toBe('Looked into it.')
    expect(outcomeOf(snapshot({ items: [] })).story).toBeNull()
    // A heading over its first paragraph isn't what it is; a long first paragraph gives its first sentences.
    expect(splitStory('## Why\n\nIt failed.\n\nMore.')).toEqual({ lede: 'It failed.', rest: '## Why\n\nMore.' })
    const long = `${'One sentence that goes on for a while. '.repeat(12)}`.trim()
    expect(splitStory(long).lede.length).toBeLessThan(300)
    expect(`${splitStory(long).lede} ${splitStory(long).rest}`).toBe(long)
  })

  it('shows it under the lead’s report in the thread, and under what the task changed, its screenshot opening full size', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [items.step({ evidence: [SHOT, RUN], unverified: ['Not tried in a real browser'] })],
          task: { ...snapshot().task, changes: [change()] },
        }),
      ),
    })
    withServices(<Task />, client)
    // In the thread, under what the lead reported: the screenshot large, what it checked, and what it couldn't.
    expect(await screen.findByRole('button', { name: 'What it printed: The kit’s tests' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View The Evidence section under the step full size' })).toBeTruthy()
    expect(screen.getByText('Not checked')).toBeTruthy()
    expect(screen.getByText('Not tried in a real browser')).toBeTruthy()
    // Under what it changed, where the person decides on it.
    await userEvent.click(screen.getByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByRole('heading', { name: /^What it looks like/, level: 2 })).toBeTruthy()
    expect(screen.getByText('Not tried in a real browser')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'View The Evidence section under the step full size' }))
    const dialog = await screen.findByRole('dialog', { name: 'The Evidence section under the step' })
    expect(within(dialog).getByRole('img', { name: 'The Evidence section under the step' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('takes what the task built from the last of its lead’s steps that said it', () => {
    const implement = items.step({ built: 'A retry.' })
    const review = items.step({ step: 'review', verdict: 'changes_requested' })
    const lede = (...steps: ReturnType<typeof items.step>[]) => outcomeOf(snapshot({ items: steps })).story?.lede ?? null
    expect(lede(implement, review)).toBe('A retry.')
    // Settling that changed the work says it again; one that didn't leaves it standing.
    expect(lede(implement, review, items.step({ step: 'settle', built: 'A retry, named.' }))).toBe('A retry, named.')
    expect(lede(implement, review, items.step({ step: 'settle', summary: 'Renamed it.' }))).toBe('A retry.')
  })

  it('ends the thread with its lead’s report as its result, no card after it, and tops the Outputs with what it built', async () => {
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
    // Ready, it opens on its Outputs: what it is at the top, as it now stands, then how it looks; what couldn't be checked before what was.
    await screen.findByRole('heading', { name: 'What changed', level: 2 })
    expect(screen.getAllByRole('heading', { level: 2 }).map((one) => one.textContent)).toEqual(['What changed', 'What it looks like1'])
    expect(screen.getByText('Checkout retries once when the payment call fails.')).toBeTruthy()
    expect(screen.queryByText('A first go.')).toBeNull()
    const unchecked = screen.getByText('Not checked')
    expect(unchecked.compareDocumentPosition(screen.getByText('What it checked')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The rest of what it is, a press away.
    expect(screen.queryByText('Try a checkout with the network off.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Read all of it' }))
    expect(screen.getByText('Try a checkout with the network off.')).toBeTruthy()
    // In the thread, each report is its lead speaking, what it showed under it, once; no card closes it.
    await userEvent.click(screen.getByRole('radio', { name: /Conversation/ }))
    const result = await screen.findByText('Try a checkout with the network off.')
    expect(screen.queryByRole('article', { name: 'What the task built' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'What it printed: The kit’s tests' })).toHaveLength(1)
    // The reviewer has the last word, after the result it reviewed.
    expect(result.compareDocumentPosition(screen.getByText('It holds.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows what a report showed under it while a step is under way too, with no card for what the task built', async () => {
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

  it('shows work that changed nothing in git by its pictures, as a prototype’s; one that only answered says nothing changed', async () => {
    const quick = (evidence: Evidence[]) =>
      fakeClient({
        getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
          snapshot({
            items: [items.step({ evidence, built: 'A status page, three ways.' })],
            task: { ...snapshot().task, kind: 'plain', phase: 'ready' },
          }),
        ),
      }).client
    const view = withServices(<Task />, quick([SHOT, RUN]))
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByRole('heading', { name: 'What it made', level: 2 })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View The Evidence section under the step full size' })).toBeTruthy()
    // Nothing in git: no card for what it changed.
    expect(screen.queryByRole('article', { name: 'Add a retry' })).toBeNull()
    view.unmount()
    withServices(<Task />, quick([RUN]))
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByRole('heading', { name: 'Nothing changed', level: 2 })).toBeTruthy()
  })

  it('shows the first six of 76 pictures, each its own view, the rest a press away and all of them full size', async () => {
    const shots = Array.from({ length: 76 }, (_, i) =>
      piece({ kind: 'screenshot', caption: `View ${i + 1}`, picture: { ...PICTURE, digest: `${i}`.padStart(64, 'a') } }),
    )
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [items.step({ evidence: shots, built: 'A status page.' })],
          task: { ...snapshot().task, kind: 'plain', phase: 'ready' },
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByRole('heading', { name: /^What it looks like\s*76$/, level: 2 })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^View View \d+ full size$/ })).toHaveLength(6)
    // The ones folded away are a key away from the first, full size.
    await userEvent.click(screen.getByRole('button', { name: 'View View 1 full size' }))
    expect(within(await screen.findByRole('dialog')).getByText('1 of 76')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Show all 76' }))
    expect(screen.getAllByRole('button', { name: /^View View \d+ full size$/ })).toHaveLength(76)
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
    expect(await screen.findByRole('heading', { name: 'What changed', level: 2 })).toBeTruthy()
    expect(screen.getByText('A retry, on the checkout.')).toBeTruthy()
    expect(screen.getByText('Not in Safari')).toBeTruthy()
  })
})
