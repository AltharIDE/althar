import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { OPUS } from '../../fixtures/models'
import { TaskStatus } from '../../foundations/vocabulary'
import { trackOf } from '../../primitives/StepTrack/StepTrack'
import { States } from '../../storybook/States'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import { TaskMenu } from '../TaskMenu/TaskMenu'
import { TaskHeader, type TaskHeaderProps } from './TaskHeader'

type Face = 'talk' | 'out'
const FACES = [
  { value: 'talk' as const, label: 'Conversation', kbd: 'c' },
  { value: 'out' as const, label: 'Outputs', kbd: 'o' },
]
const STEPS = ['Requirements', 'Implement', 'Review', 'Repair', 'Security review', 'Verify', 'Evidence']

const BASE: TaskHeaderProps<Face> = {
  task: '418',
  title: 'Repair token refresh on privilege change',
  status: TaskStatus.Running,
  state: 'Security review',
  kind: 'Delivery',
  lead: OPUS,
  branch: 'ch/418-token-refresh',
  since: 'security review · 6m',
  elapsed: '2h 14m',
  cost: '$4.10',
  steps: trackOf(STEPS, 4),
  faces: FACES,
  face: 'talk',
}

/* The header with its faces switching, and Graph and Code at the right. */
function Header(props: Partial<TaskHeaderProps<Face>>) {
  const [face, setFace] = useState<Face>(props.face ?? 'talk')
  const [graph, setGraph] = useState(false)
  return (
    <TaskHeader
      {...BASE}
      {...props}
      face={face}
      onFace={setFace}
      actions={
        <>
          <ChromeButton icon="branch" label="Graph" kbd="g" expanded={graph} onClick={() => setGraph(!graph)} />
          <ChromeButton icon="work" label="Code" kbd="d" onClick={fn()} />
          <TaskMenu status={props.status ?? BASE.status} onStop={fn()} onResume={fn()} onAbandon={fn()} onReopen={fn()} />
        </>
      }
    />
  )
}

const meta = {
  title: 'Chrome/TaskHeader',
  component: Header,
  decorators: [(Story) => <div style={{ maxWidth: 680 }}>{Story()}</div>],
} satisfies Meta<typeof Header>
export default meta
type Story = StoryObj<typeof meta>

/** Running a review a rule added. */
export const Running: Story = {}
/** Every check passed; accepting it is yours. */
export const ReadyForYou: Story = {
  args: {
    status: TaskStatus.Yours,
    state: 'Ready for you',
    since: 'verified · 4m ago',
    elapsed: '3h 12m',
    cost: '$5.90',
    steps: trackOf(STEPS, 6),
    face: 'out',
  },
}
export const Paused: Story = { args: { status: TaskStatus.Paused, state: 'Paused until 14:00' } }
/** A question: nothing built, so no branch and no second face. */
export const NothingBuilt: Story = {
  args: {
    task: '425',
    title: 'Why do refunds fail fast when webhooks retry?',
    status: TaskStatus.Done,
    state: 'Answered',
    kind: 'Question',
    branch: undefined,
    since: 'answered · 11m ago',
    elapsed: '6m',
    cost: '$0.40',
    steps: trackOf(['Read', 'Answer'], 1, 1, true),
    faces: [FACES[0]!],
    facesNote: 'Nothing was built, so there is nothing else to look at.',
  },
}

/** A task with no number yet: the title leads the line. */
export const Unnumbered: Story = { args: { task: undefined } }

export const SwitchingFaces: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /Outputs/ }))
    await expect(c.getByRole('radio', { name: /Outputs/ })).toBeChecked()
    await userEvent.click(c.getByRole('button', { name: /Graph/ }))
    await expect(c.getByRole('button', { name: /Graph/ })).toHaveAttribute('aria-expanded', 'true')
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'running', node: <Header /> },
        { state: 'ready for you', node: <Header {...ReadyForYou.args} /> },
        { state: 'paused', node: <Header {...Paused.args} /> },
        { state: 'nothing built', node: <Header {...NothingBuilt.args} /> },
        { state: 'unnumbered', node: <Header task={undefined} /> },
      ]}
    />
  ),
}
