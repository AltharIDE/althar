import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { OPUS } from '../../fixtures/models'
import { TaskStatus } from '../../foundations/vocabulary'
import { trackOf } from '../../primitives/StepTrack/StepTrack'
import { States } from '../../storybook/States'
import { BackCrumb } from '../BackCrumb/BackCrumb'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import { TaskMenu } from '../TaskMenu/TaskMenu'
import { TitleBar } from '../TitleBar/TitleBar'
import { TaskHeader, type TaskHeaderProps } from './TaskHeader'

type Face = 'talk' | 'out'
const FACES = [
  { value: 'talk' as const, label: 'Conversation', kbd: 'c' },
  { value: 'out' as const, label: 'Outputs', kbd: 'o' },
]
const STEPS = ['Implement', 'Review', 'Settle', 'Review']

const BASE: TaskHeaderProps<Face> = {
  title: 'Repair token refresh on privilege change',
  status: TaskStatus.Running,
  state: 'Reviewing',
  lead: OPUS,
  branch: 'althar/token-refresh',
  since: 'review · 6m',
  elapsed: '2h 14m',
  cost: '$4.10',
  steps: trackOf(STEPS, 1),
  faces: FACES,
  face: 'talk',
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
              <ChromeButton icon="branch" label="Graph" kbd="g" expanded={graph} onClick={() => setGraph(!graph)} />
              <TaskMenu status={props.status ?? BASE.status} onStop={fn()} onResume={fn()} onAbandon={fn()} onReopen={fn()} />
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

/** Its review running. */
export const Running: Story = {}
/** Reviewed and settled; accepting it is yours. */
export const ReadyForYou: Story = {
  args: { status: TaskStatus.Yours, state: 'Ready for you', since: 'settled · 4m ago', steps: trackOf(STEPS, 3, 3, true), face: 'out' },
}
export const Paused: Story = { args: { status: TaskStatus.Paused, state: 'Stopped' } }
/** A question: nothing built, but the switch is still there, so its place never moves. */
export const NothingBuilt: Story = {
  args: {
    title: 'Why do refunds fail fast when webhooks retry?',
    status: TaskStatus.Done,
    state: 'Answered',
    branch: undefined,
    since: 'answered · 11m ago',
    elapsed: '6m',
    steps: trackOf(['Read', 'Answer'], 1, 1, true),
  },
}
/** A title too long for the bar: one line, the whole of it on hover. */
export const LongTitle: Story = {
  args: { title: 'Repair token refresh on privilege change so that a downgraded admin loses access at once, everywhere' },
}

export const SwitchingFaces: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { level: 1, name: BASE.title })).toBeVisible()
    await userEvent.click(c.getByRole('radio', { name: /Outputs/ }))
    await expect(c.getByRole('radio', { name: /Outputs/ })).toBeChecked()
    await userEvent.click(c.getByRole('button', { name: /Graph/ }))
    await expect(c.getByRole('button', { name: /Graph/ })).toHaveAttribute('aria-expanded', 'true')
    // Who leads it, its branch and how long are said with where it stands.
    await expect(c.getByText('Reviewing').parentElement).toHaveTextContent(/althar\/token-refresh/)
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'running', node: <Header /> },
        { state: 'ready for you', node: <Header {...ReadyForYou.args} /> },
        { state: 'stopped', node: <Header {...Paused.args} /> },
        { state: 'nothing built', node: <Header {...NothingBuilt.args} /> },
        { state: 'long title', node: <Header {...LongTitle.args} /> },
      ]}
    />
  ),
}
