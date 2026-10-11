import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { TaskLaunch, type LaunchStep } from '../../../coordinator/TaskLaunch/TaskLaunch'
import { PROJECT } from '../../../fixtures/meridian'
import { CODEX, SONNET } from '../../../fixtures/models'
import { Model } from '../../../primitives/Model/Model'
import { Prose, Turn } from '../../../thread/Turn/Turn'
import { CheckpointCard } from '../A/CheckpointCard'
import { checkpoint, Phase, useCheckpoint } from '../model'
import { Pages, type Page } from '../parts/Moments'
import { WAIT } from '../parts/sheet'
import { FirstStep, Groundwork } from '../parts/Threads'
import { APPROACH, DUE, PUBLIC_ONLY, SAME_BUDGET, SCOPE, TASK } from '../world'
import { DraftScope, type ScopeItem } from './DraftScope'

/*
 * The coordinator's level. Its plan for a task says what was decided with
 * you while planning and what is left to the lead, so the lead's checkpoint
 * covers only what was left and never asks again what you said. Shown with
 * the kit's own plan card under it.
 */

const noop = () => {}

/* Implement says what its checkpoint will hold: what is left, or nothing. */
const stepsFor = (left: number): LaunchStep[] => [
  {
    id: 'impl',
    label: 'Implement',
    agents: [TASK.lead],
    why: left > 0 ? `starts with a checkpoint on the ${left} left to it` : 'nothing left to check; straight to work',
    fixed: 'the lead',
  },
  { id: 'review', label: 'Review', agents: [SONNET], why: 'a different model from the lead', optional: true },
  { id: 'verify', label: 'Verify', agents: [CODEX], why: 'replays last week’s partner traffic' },
]

function Plan({ decided, left, said }: { decided: readonly ScopeItem[]; left: readonly ScopeItem[]; said: string }) {
  return (
    <Turn voice="Coordinator" at="10:58">
      <Prose>{said}</Prose>
      <DraftScope decided={decided} left={left} />
      <TaskLaunch
        task={TASK.task}
        title={TASK.title}
        defaultSteps={stepsFor(left.length)}
        picker={({ agent }) => <Model model={agent} short />}
        project={PROJECT}
        estimate="About 40 minutes"
        onStart={noop}
      />
    </Turn>
  )
}

/** The lead's checkpoint after that plan: only what was left, and a word on what wasn't asked again. */
function LeadCheckpoint() {
  const [c, on] = useCheckpoint(checkpoint(Phase.Open))
  return (
    <>
      <FirstStep />
      <Groundwork>
        <CheckpointCard
          approach={APPROACH}
          assumptions={[SAME_BUDGET, PUBLIC_ONLY]}
          checkpoint={c}
          on={on}
          step={TASK.steps[0] ?? ''}
          lead={TASK.lead}
          wait={WAIT}
          due={DUE}
          decided={SCOPE.decided.length}
        />
      </Groundwork>
    </>
  )
}

const PAGES: Page[] = [
  {
    id: 'some',
    state: 'Some left to the lead',
    note: 'What you settled while planning, beside what the lead will check once it has looked at the code.',
    node: (
      <Plan
        decided={SCOPE.decided}
        left={SCOPE.left}
        said="The limiter and what happens over the limit are settled. Two smaller calls depend on the code, so I’ve left them to the lead."
      />
    ),
  },
  {
    id: 'all',
    state: 'Everything decided',
    note: 'Nothing left: the lead’s checkpoint will most likely pass empty, which is what a well-planned task looks like.',
    node: <Plan decided={[...SCOPE.decided, ...SCOPE.settled]} left={[]} said="We settled all of it. The lead goes straight to work." />,
  },
  {
    id: 'none',
    state: 'Nothing decided',
    note: 'A task handed over in a sentence. The plan says so, rather than looking more settled than it is.',
    node: (
      <Plan decided={[]} left={SCOPE.open} said="Handing this over as you wrote it; the lead will check its reading before it builds." />
    ),
  },
  {
    id: 'checkpoint',
    state: 'At the lead’s checkpoint',
    note: 'The checkpoint holds only what was left, and says how much the plan settled. Shown as A draws it.',
    node: <LeadCheckpoint />,
  },
]

const meta = {
  title: 'Explorations/Triage checkpoint/Coordinator: decided and left',
  parameters: { layout: 'padded', controls: { disable: true } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** On paper. */
export const Light: Story = {
  render: () => <Pages pages={PAGES} label="Conversation" />,
  play: async ({ canvasElement }) => {
    const some = within(within(canvasElement).getByRole('region', { name: 'Some left to the lead' }))
    await expect(some.getByRole('list', { name: 'Left to the lead' })).toHaveTextContent(SCOPE.left[0]?.says ?? '')
    const lead = within(within(canvasElement).getByRole('region', { name: 'At the lead’s checkpoint' }))
    await expect(lead.getByText('3 things decided in the plan · not asked again')).toBeInTheDocument()
  },
}

/** In the exploration's provisional dark. */
export const Dark: Story = { render: () => <Pages pages={PAGES} label="Conversation" dark /> }
