import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { TaskStatus } from '../../foundations/vocabulary'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import { TaskHeader } from '../TaskHeader/TaskHeader'
import { PartLines, type PartKind, TaskParts, type TaskPartModel } from './TaskParts'

/* A task's parts, just before the faces, which never move with Run and the menu (ADR-097). */

const PARTS: ReadonlyArray<TaskPartModel> = [
  {
    id: 'worktree',
    icon: 'folder',
    name: 'Worktree',
    detail: '6 files changed',
    facts: [
      ['Branch', <code key="b">althar/runs-pill</code>],
      ['Where', <code key="w">~/Charrette/althar/runs-pill</code>],
    ],
    body: (
      <PartLines
        lines={[
          ['packages/ui/src/chrome/RunPill/RunPill.tsx', '+48 −12'],
          ['apps/desktop/src/renderer/features/run/runs.ts', '+31 −9'],
          ['4 more', ''],
        ]}
      />
    ),
    actions: [
      { label: 'See the changes', onClick: fn() },
      { label: 'Open in Zed', onClick: fn(), variant: 'quiet', icon: 'external' },
    ],
  },
  {
    id: 'pr1',
    icon: 'pr',
    name: '#635',
    detail: 'Open · checks pass',
    tone: 'you',
    act: { label: 'Merge', onClick: fn() },
    facts: [
      ['Title', 'Runs stay in the pill until they end'],
      ['Checks', '12 pass'],
    ],
  },
  {
    id: 'pr2',
    icon: 'pr',
    name: '#639',
    detail: 'Draft · 1 check fails',
    tone: 'bad',
    act: { label: 'See the check' },
    facts: [
      ['Title', 'Show a run’s address in the pill'],
      ['Checks', '11 pass, 1 fails'],
    ],
    body: <PartLines log lines={[['✗ e2e · macOS\n  run-pill.spec.ts:41 shows the address', '']]} />,
    actions: [{ label: 'Ask the lead to fix it', onClick: fn() }],
  },
  { id: 'issue', icon: Brand.Linear, name: 'DEV-188', detail: 'Runs vanish from the pill' },
  {
    id: 'run',
    icon: 'globe',
    name: 'localhost:5367',
    detail: 'Running',
    tone: 'live',
    actions: [
      { label: 'Open', onClick: fn(), icon: 'external' },
      { label: 'Stop', onClick: fn(), variant: 'quiet', end: true },
    ],
  },
  { id: 'shots', icon: 'image', name: '4 screenshots', detail: 'The pill, light and dark' },
]

const KINDS: ReadonlyArray<PartKind> = [
  { kind: 'pr', icon: 'pr', name: 'A pull request', about: 'Opened from its branch, or one that exists', form: () => null },
  { kind: 'worktree', icon: 'folder', name: 'A worktree', about: 'A checkout of its own, to change code in', form: () => null },
  { kind: 'review', icon: 'answer', name: 'A review', about: 'Of any pull request, by another model', form: () => null },
  { kind: 'issue', icon: 'list', name: 'An issue', about: 'For its lead to read', form: () => null },
  { kind: 'browser', icon: 'globe', name: 'A browser', about: 'A page its lead can see and click', form: () => null },
  { kind: 'access', icon: 'lock', name: 'Access', about: 'Something that asks, given for this task', form: () => null },
]

const meta = {
  title: 'Chrome/TaskParts',
  component: TaskParts,
  parameters: { layout: 'padded' },
  args: { parts: PARTS, kinds: KINDS },
  render: (args) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', minHeight: 560, maxWidth: 900 }}>
      <TaskHeader
        title="Runs show in the pill"
        status={TaskStatus.Yours}
        state="Ready to accept"
        faces={[
          { value: 'talk', label: 'Conversation' },
          { value: 'out', label: 'Outputs' },
        ]}
        face="talk"
        onFace={fn()}
        parts={<TaskParts {...args} />}
        actions={
          <>
            <ChromeButton icon="play" label="Run" onClick={fn()} />
            <ChromeButton icon="more" label="More" compact onClick={fn()} />
          </>
        }
      />
    </div>
  ),
} satisfies Meta<typeof TaskParts>
export default meta
type Story = StoryObj<typeof meta>

/** The bar: the parts' marks, one waiting in its colour, then the faces, Run and the menu where they always are. */
export const InTheBar: Story = {}

/** Open: what waits first, with Merge acting from its row; what runs; the rest as chips. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 6/ }))
    await expect(within(document.body).getByRole('button', { name: 'Merge' })).toBeVisible()
  },
}

/** A part open in place: the worktree, with its branch, the files it changed, See the changes. */
export const AWorktree: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 6/ }))
    await userEvent.click(within(document.body).getByRole('button', { name: 'Worktree' }))
  },
}

/** A failing check, open: its last lines and Ask the lead to fix it. */
export const AFailingCheck: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 6/ }))
    await userEvent.click(within(document.body).getByRole('button', { name: /#639/ }))
  },
}

/** Add: what a task can take on. */
export const Add: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Parts, 6/ }))
    await userEvent.click(within(document.body).getByRole('button', { name: 'Add' }))
  },
}
