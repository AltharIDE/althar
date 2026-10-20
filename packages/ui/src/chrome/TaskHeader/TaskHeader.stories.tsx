import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CODEX, OPUS } from '../../fixtures/models'
import { TaskStatus, unreachable } from '../../foundations/vocabulary'
import { trackOf } from '../../primitives/StepTrack/StepTrack'
import { States } from '../../storybook/States'
import { BackCrumb } from '../BackCrumb/BackCrumb'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import { RunButton } from '../RunButton/RunButton'
import { SettleWays } from '../../board/SettleWays/SettleWays'
import { TaskMenu } from '../TaskMenu/TaskMenu'
import { TitleBar } from '../TitleBar/TitleBar'
import { TaskHeader, type TaskHeaderProps, type TaskHeaderStep } from './TaskHeader'

type Face = 'talk' | 'out'
const FACES = [
  { value: 'talk' as const, label: 'Conversation', kbd: 'c' },
  { value: 'out' as const, label: 'Outputs', kbd: 'o' },
]

/** Its plan's two steps, the lead implementing and another agent reviewing, at the step it is on. */
const planAt = (at: number, done = false): TaskHeaderStep[] =>
  trackOf(['Implement', 'Review'], at, at, done).map((step, index) => ({ ...step, who: index === 0 ? OPUS.name : CODEX.name }))

const BASE: TaskHeaderProps<Face> = {
  title: 'Repair token refresh on privilege change',
  status: TaskStatus.Running,
  state: 'Reviewing',
  steps: planAt(1),
  took: '6m',
  elapsed: '2h 14m',
  faces: FACES,
  face: 'talk',
}

/** What its menu offers where it stands, as the consumer would give it. */
const menuFor = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.Running:
    case TaskStatus.Yours:
    case TaskStatus.Paused:
    case TaskStatus.Queued:
      return { onStop: fn(), onAbandon: fn() }
    case TaskStatus.Stopped:
      return { onResume: fn(), onAbandon: fn() }
    case TaskStatus.Done:
      return { onReopen: fn() }
    default:
      return unreachable(status)
  }
}

/* The header in the window's bar, after the way back and the title, with its faces switching and Graph at the end. */
function Header(props: Partial<TaskHeaderProps<Face>>) {
  const [face, setFace] = useState<Face>(props.face ?? 'talk')
  const [graph, setGraph] = useState(false)
  const title = props.title ?? BASE.title
  return (
    <TitleBar
      lights="none"
      end={
        <TaskHeader
          {...BASE}
          {...props}
          face={face}
          onFace={setFace}
          actions={
            <>
              {props.actions}
              <ChromeButton icon="branch" label="Graph" kbd="g" expanded={graph} onClick={() => setGraph(!graph)} />
              <TaskMenu {...menuFor(props.status ?? BASE.status)} />
            </>
          }
        />
      }
    >
      <BackCrumb to="meridian" kbd="esc" title={title} titleLevel={1} onBack={fn()} />
    </TitleBar>
  )
}

const meta = {
  title: 'Chrome/TaskHeader',
  component: Header,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Header>
export default meta
type Story = StoryObj<typeof meta>

/**
 * Its review running, in a blue chip with its steps' bars. Pointed at or focused, where it stands says who
 * does each step: the reviewer, not the lead the composer names, and for how long.
 */
export const Reviewing: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.hover(c.getByText('Reviewing'))
    const card = await within(document.body).findByRole('tooltip')
    await expect(card).toHaveTextContent(OPUS.name)
    await expect(card).toHaveTextContent(`Review${CODEX.name}6m`)
    await expect(card).toHaveTextContent('2h 14m in all')
    await expect(card).not.toHaveTextContent('althar/')
  },
}
/** Its lead implementing, the review to come; how long in all is the step's own, so it is said once. */
export const Implementing: Story = { args: { state: 'Implementing', steps: planAt(0), took: '52m', elapsed: '52m' } }
/** Reviewed and settled; accepting it is yours. Nothing runs, so where it stands has nothing more to say: no bars, no card. */
export const ReadyForYou: Story = {
  args: { status: TaskStatus.Yours, state: 'Ready for you', steps: planAt(1, true), face: 'out' },
  play: async ({ canvasElement }) => {
    const said = within(canvasElement).getByText('Ready for you').parentElement
    await expect(said).not.toHaveAttribute('tabindex')
    await userEvent.hover(within(canvasElement).getByText('Ready for you'))
    await waitFor(() => expect(within(document.body).queryByRole('tooltip')).toBeNull())
  },
}
export const Stopped: Story = { args: { status: TaskStatus.Stopped, state: 'Stopped', steps: planAt(0) } }
/** A question: nothing built, but the switch is still there, so its place never moves. */
export const NothingBuilt: Story = {
  args: {
    title: 'Why do refunds fail fast when webhooks retry?',
    status: TaskStatus.Done,
    state: 'Answered',
    steps: [],
  },
}
/** A prototype its lead finished: Done, then a pin, Keep for later, inside where it stands, in its violet; no card. */
export const FinishedNotAChange: Story = {
  args: {
    title: 'Prototype: allow everything, for a project and a task',
    status: TaskStatus.Yours,
    state: 'Finished',
    steps: [],
    beside: <SettleWays place="header" onDone={fn()} onKeep={fn()} />,
  },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByText('Finished').closest<HTMLElement>('[data-status]')
    if (chip === null) throw new Error('Where it stands is not a chip')
    await expect(chip).toHaveAttribute('data-status', TaskStatus.Yours)
    await expect(within(chip).getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(within(chip).getByRole('button', { name: 'Keep for later' })).toBeVisible()
  },
}
/** A title too long for the bar: one line, the whole of it on hover. */
export const LongTitle: Story = {
  args: { title: 'Repair token refresh on privilege change so that a downgraded admin loses access at once, everywhere' },
}

/** What an agent kept to run is one long unnamed command: its button says the last part, cut short, and the title keeps its room. */
export const LongRunCommand: Story = {
  args: {
    actions: (
      <RunButton
        targets={[
          {
            id: 'long',
            command:
              'export PATH="$HOME/.bun/bin:$PATH"; unset ELECTRON_RUN_AS_NODE; P=$(pwd); cd apps/desktop && bun run build && cd "$P" && exec zypak-wrapper electron apps/desktop --no-sandbox',
            where: 'this task',
            from: 'agent',
          },
        ]}
        onRun={fn()}
        onStop={fn()}
        onOpen={fn()}
        onAdd={fn()}
        onEdit={fn()}
      />
    ),
  },
}

export const SwitchingFaces: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { level: 1, name: BASE.title })).toBeVisible()
    await userEvent.click(c.getByRole('radio', { name: /Outputs/ }))
    await expect(c.getByRole('radio', { name: /Outputs/ })).toBeChecked()
    await userEvent.click(c.getByRole('button', { name: /Graph/ }))
    await expect(c.getByRole('button', { name: /Graph/ })).toHaveAttribute('aria-expanded', 'true')
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'reviewing', node: <Header /> },
        { state: 'implementing', node: <Header {...Implementing.args} /> },
        { state: 'ready for you', node: <Header {...ReadyForYou.args} /> },
        { state: 'finished, not a change', node: <Header {...FinishedNotAChange.args} /> },
        { state: 'stopped', node: <Header {...Stopped.args} /> },
        { state: 'nothing built', node: <Header {...NothingBuilt.args} /> },
        { state: 'long title', node: <Header {...LongTitle.args} /> },
      ]}
    />
  ),
}
