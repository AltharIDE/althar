import { useState } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ArtifactsPlace, CanvasDetail, CanvasSaved, CanvasSummary, CanvasVersionFacts } from '@althar/contracts'

const navigated = vi.hoisted(() => ({ to: [] as Array<unknown> }))
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => (to: unknown) => void navigated.to.push(to),
}))

const { CanvasHost } = await import('../src/renderer/features/canvases/CanvasHost')
const { ruleOf } = await import('../src/renderer/features/canvases/SaveCanvas')
const { ArtifactsGroup, placesOf } = await import('../src/renderer/features/projectSettings/ArtifactsGroup')
const { boardsOfText, changedState, FIRST_STATE, pinsOf } = await import('../src/renderer/features/canvases/boards')
const { fakeClient } = await import('./fixtures')
const { withServices } = await import('./render')

/*
 * Saving an artifact to a repository, from its head (ADR-104): Save to repo
 * opens on the project's place for artifacts, saves there at once (the canvas
 * saying it is saving before the runtime has read the press), says where it
 * is once saved, stops, and reads the canvas again where a save is refused.
 * The project's place in its settings. An artifact opened from the
 * Artifacts view opens beside the conversation that drew it. A canvas of
 * boards' state as a press changes it, and the pins of its comments.
 */

const CANVAS = `cnv_${'c3'.repeat(16)}`
const PROJECT = `proj_${'b2'.repeat(16)}`
const THREAD = `thr_${'a1'.repeat(16)}`
const DRAFT = `project:${THREAD}`

afterEach(() => {
  navigated.to.length = 0
  for (const left of document.body.querySelectorAll(':scope > [role="dialog"]')) left.remove()
})

const version: CanvasVersionFacts = {
  number: 3,
  base: 2,
  title: 'Gift a class',
  kind: 'markdown',
  entry: 'README.md',
  manifest: '3'.repeat(64),
  entrySha256: 'e'.repeat(64),
  note: null,
  files: 1,
  bytes: 10,
  by: { role: 'lead', taskId: 'task_1', taskTitle: 'Gift a class', threadId: THREAD },
  at: '2026-11-21T12:00:00.000Z',
}

const saved: CanvasSaved = {
  repositoryId: 'repo_api',
  repository: 'meridian-api',
  path: 'design/gift-a-class/',
  how: 'pr',
  follow: true,
  version: 3,
  commit: 'abc1234def',
  pullRequest: null,
  state: 'saved',
  problem: null,
}

const summaryOf = (over: Partial<CanvasSummary> = {}): CanvasSummary => ({
  id: CANVAS,
  projectId: PROJECT,
  name: 'gift-a-class',
  group: null,
  latest: version,
  versions: 3,
  openComments: 0,
  archived: false,
  ...over,
})

const HOME: ArtifactsPlace = {
  home: { repositoryId: 'repo_api', repository: 'meridian-api', folder: 'design/', how: 'pr', follow: true },
  guess: null,
}

const open = (summary: CanvasSummary, over: Parameters<typeof fakeClient>[0] = {}) => {
  let held: CanvasDetail = { summary, versions: [version], comments: [] }
  const made = fakeClient({
    getCanvas: vi.fn(async () => held),
    readCanvasText: vi.fn(async () => ({ path: 'README.md', text: '# Gift a class', bytes: 14 })),
    getArtifactsPlace: vi.fn(async () => HOME),
    listRepositoryFolders: vi.fn(async () => ({ folders: ['design/', 'docs/'], truncated: false })),
    ...over,
  })
  // Saving is the artifact's: it is in its room's row.
  withServices(<InRoom />, made.client)
  return { ...made, hold: (next: CanvasDetail) => (held = next) }
}

/** A canvas in its artifact's room, its actions in the room's row. */
function InRoom() {
  const [row, setRow] = useState<HTMLSpanElement | null>(null)
  return (
    <>
      <span ref={setRow} />
      <CanvasHost
        threadId={THREAD}
        open={{ canvasId: CANVAS, version: null, follow: true }}
        draft={DRAFT}
        onVersion={vi.fn()}
        onClose={vi.fn()}
        actionsIn={row}
      />
    </>
  )
}

describe('Save to repo, in an artifact’s head', () => {
  it('opens on the project’s place, saves there, and shows it saving at once', async () => {
    const { client } = open(summaryOf())
    await userEvent.click(await screen.findByRole('button', { name: 'Save to repo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save to repo' })
    expect(await within(dialog).findByText('The project’s place for artifacts')).toBeTruthy()
    expect(within(dialog).getByText('A pull request of its own, a commit each version')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save to meridian-api' }))
    expect(client.saveCanvas).toHaveBeenCalledWith({
      canvasId: CANVAS,
      repositoryId: 'repo_api',
      path: 'design/gift-a-class/',
      how: 'pr',
      follow: true,
      makeHome: false,
    })
    expect(await screen.findByRole('button', { name: /Saving/ })).toBeTruthy()
  })

  it('says where it is saved, goes to the project’s setting, and stops saving it', async () => {
    const { client } = open(summaryOf({ saved }))
    await userEvent.click(await screen.findByRole('button', { name: 'In git' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save to repo' })
    expect(within(dialog).getByText('Gift a class in git')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Settings' }))
    expect(navigated.to).toEqual([
      { to: '/projects/$projectId', params: { projectId: PROJECT }, search: { room: 'settings', section: 'code' } },
    ])
    await userEvent.click(await screen.findByRole('button', { name: 'In git' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Save to repo' })).getByRole('button', { name: 'Stop saving' }))
    expect(client.stopSavingCanvas).toHaveBeenCalledWith(CANVAS)
    expect(await screen.findByRole('button', { name: 'Save to repo' })).toBeTruthy()
  })

  it('reads the canvas again where a save is refused, and says a save that failed', async () => {
    const refused = vi.fn(async () => {
      throw new Error('Refused')
    })
    const { client, hold } = open(summaryOf(), { saveCanvas: refused })
    hold({ summary: summaryOf({ saved: { ...saved, state: 'failed', problem: 'Couldn’t push.' } }), versions: [version], comments: [] })
    await userEvent.click(await screen.findByRole('button', { name: 'Save to repo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save to repo' })
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Save to meridian-api' }))
    await waitFor(() => expect(vi.mocked(client.getCanvas).mock.calls.length).toBeGreaterThan(1))
    expect(await screen.findByRole('button', { name: 'Saving failed' })).toBeTruthy()
  })

  it('says the project’s rule in a few words', () => {
    expect(ruleOf('pr', true)).toBe('A pull request of its own, a commit each version')
    expect(ruleOf('main', false)).toBe('Straight to its default branch, committed when you save')
  })
})

describe('the project’s place for artifacts, in its settings', () => {
  it('names each repository’s folders two deep', () => {
    expect(placesOf([{ id: 'r', name: 'kiln', folders: ['design/', 'design/a/', 'design/a/b/'] }]).map((one) => one.label)).toEqual([
      'kiln/',
      'kiln/design/',
      'kiln/design/a/',
    ])
  })

  it('shows the place, how and when, and changes each at once', async () => {
    const { client } = fakeClient({ getArtifactsPlace: vi.fn(async () => HOME) })
    withServices(<ArtifactsGroup projectId={PROJECT} />, client)
    expect(await screen.findByRole('heading', { name: 'Artifacts' })).toBeTruthy()
    const each = await screen.findByRole('switch', { name: /Commit each new version/ })
    await waitFor(() => expect(each.getAttribute('aria-checked')).toBe('true'))
    await userEvent.click(each)
    expect(client.setArtifactsHome).toHaveBeenCalledWith(PROJECT, { repositoryId: 'repo_api', folder: 'design/', how: 'pr', follow: false })
    await waitFor(() => expect(screen.getByRole('switch', { name: /Commit each new version/ }).getAttribute('aria-checked')).toBe('false'))
  })

  it('waits for the first save where the project has no place yet', async () => {
    const { client } = fakeClient()
    withServices(<ArtifactsGroup projectId={PROJECT} />, client)
    const each = await screen.findByRole('switch', { name: /Commit each new version/ })
    expect(each).toHaveProperty('disabled', true)
    expect(await screen.findByText('Set by the first save')).toBeTruthy()
  })

  it('makes Althar’s pick the place where the project has none yet, with how they go changed', async () => {
    const guess = { ...HOME.home!, folder: 'docs/', why: 'Where meridian-api keeps its designs' }
    const { client } = fakeClient({ getArtifactsPlace: vi.fn(async () => ({ home: null, guess })) })
    withServices(<ArtifactsGroup projectId={PROJECT} />, client)
    await userEvent.click(await screen.findByRole('combobox', { name: 'How they go in' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Straight to its default branch' }))
    expect(client.setArtifactsHome).toHaveBeenCalledWith(PROJECT, { repositoryId: 'repo_api', folder: 'docs/', how: 'main', follow: true })
    expect(await screen.findByText('Committed to the repository’s default branch')).toBeTruthy()
  })

  it('sets the place picked where the project has none and no pick, as the first save would', async () => {
    const { client } = fakeClient({ listRepositoryFolders: vi.fn(async () => ({ folders: ['design/'], truncated: false })) })
    withServices(<ArtifactsGroup projectId={PROJECT} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Saved in' }))
    await userEvent.click(await screen.findByRole('option', { name: 'meridian-api/design/' }))
    expect(client.setArtifactsHome).toHaveBeenCalledWith(PROJECT, { repositoryId: 'repo_api', folder: 'design/', how: 'pr', follow: true })
    await waitFor(() => expect(screen.getByRole('switch', { name: /Commit each new version/ })).toHaveProperty('disabled', false))
  })
})

describe('a canvas of boards in the window', () => {
  const BOARDS = boardsOfText(
    JSON.stringify({
      pages: [
        {
          name: 'A',
          boards: [
            { name: 'One', file: 'one.html', width: 400, height: 300 },
            { name: 'Two', file: 'two.html', width: 400, height: 300 },
          ],
        },
        { name: 'B', boards: [{ name: 'Three', file: 'three.html', width: 400, height: 300 }] },
      ],
    }),
  )

  it('reads its pages and boards, and nothing from what isn’t them', () => {
    expect(BOARDS?.pages.map((page) => page.name)).toEqual(['A', 'B'])
    expect(boardsOfText('not json')).toBeNull()
  })

  it('shows a press at once as the ground will make it', () => {
    expect(changedState(FIRST_STATE, { view: 'one' }, BOARDS).view).toBe('one')
    expect(changedState(FIRST_STATE, { step: 1 }, BOARDS).board).toEqual({ page: 0, board: 1 })
    expect(changedState({ ...FIRST_STATE, board: { page: 0, board: 1 } }, { step: 1 }, BOARDS)).toMatchObject({
      board: { page: 1, board: 0 },
      page: 1,
    })
    expect(changedState(FIRST_STATE, { step: -1 }, BOARDS).board).toEqual({ page: 0, board: 0 })
    expect(changedState(FIRST_STATE, { page: 1 }, BOARDS)).toMatchObject({ page: 1, board: { page: 1, board: 0 } })
    expect(changedState(FIRST_STATE, { page: -1 }, BOARDS)).toMatchObject({ page: -1, board: { page: 0, board: 0 } })
    expect(changedState(FIRST_STATE, { board: { page: 1, board: 0 } }, BOARDS).page).toBe(1)
    expect(changedState(FIRST_STATE, { zoom: 0.5, tool: 'hand' }, BOARDS)).toMatchObject({ zoom: 0.5, tool: 'hand' })
    expect(changedState(FIRST_STATE, { zoom: 'in' }, BOARDS).zoom).toBe(1)
  })

  it('pins the comments sent on parts of boards, then those in the draft, numbered in that order', () => {
    const element = (board: string) => ({ kind: 'element' as const, selector: 'h1', label: 'h1', text: '', page: 'A', board })
    const { pins, numbers } = pinsOf(
      [
        { id: 'c1', anchor: element('One'), answered: true },
        { id: 'c2', anchor: { kind: 'whole' as const }, answered: false },
      ],
      [
        {
          id: 'd1',
          note: 'Bigger',
          crop: null,
          on: { kind: 'canvas', canvasId: CANVAS, name: 'n', title: 't', version: 1, anchor: element('Two') },
        },
        {
          id: 'd2',
          note: 'Elsewhere',
          crop: null,
          on: { kind: 'canvas', canvasId: 'cnv_other', name: 'n', title: 't', version: 1, anchor: element('Two') },
        },
      ],
      CANVAS,
    )
    expect(pins).toEqual([
      { n: 1, page: 'A', board: 'One', selector: 'h1', answered: true, draft: false },
      { n: 2, page: 'A', board: 'Two', selector: 'h1', answered: false, draft: true },
    ])
    expect([...numbers]).toEqual([
      ['c1', 1],
      ['d1', 2],
    ])
  })
})
