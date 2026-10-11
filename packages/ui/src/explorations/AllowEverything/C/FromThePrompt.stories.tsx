import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { TaskMenu } from '../../../chrome/TaskMenu/TaskMenu'
import { PermissionPolicy } from '../../../foundations/vocabulary'
import { Tooltip } from '../../../primitives/HoverCard/HoverCard'
import { projectRulesText } from '../../../screens/ProjectRules/ProjectRules'
import { ChoiceWord } from '../../../setup/Charter/Charter'
import type { PermissionRequest } from '../../../thread/Permission/Permission'
import { HELD_FIRST, HELD_WHY, PROJECT, PROJECT_DEFAULT, PUBLISH, QUEUE, TASK } from '../fixtures'
import { Lane } from '../parts/BoardCard'
import { Mark } from '../parts/Mark'
import { ESCALATE, type Picked, PromptCard } from '../parts/PromptCard'
import { Queue } from '../parts/Queue'
import { RulesSketch } from '../parts/RulesSketch'
import { TaskBar } from '../parts/TaskBar'
import { TasksClause } from '../parts/TasksClause'
import { TaskView } from '../parts/TaskView'
import { Pairs, schemeArgs, schemeArgTypes, schemeDecorator, type SchemeArgs } from '../Scheme'
import { escalation, StoppedAsking } from './FromThePrompt'

/*
 * C · Escalate from the prompt. The card gets one more answer: allow this,
 * and stop asking on this task. What it does is said under it before you
 * press; the requests waiting behind it go with it, in one line; the bar
 * says the task allows everything, since when, with Ask again.
 */

const WORDS = {
  at: '11:52',
  heldWayOut: '“Stop asking on this task”, the last answer, gets past it, on this task only.',
  aside: 'Not asking',
  says: (at: string) => `: allows everything, since you stopped asking at ${at}.`,
  again: 'Ask again',
  mark: 'Allows everything',
  markAbout: 'You stopped asking on this task. Never still holds.',
  lane: 'Running',
}

const noop = () => {}
/** The modes as the rules page offers them today, allowing everything among them. */
const MODES = [PermissionPolicy.Rules, PermissionPolicy.Coordinator, PermissionPolicy.Ask, PermissionPolicy.AllowAll] as const

/** Task 418 with its waiting requests; after stopping asking, if told. */
function TaskC({
  items = QUEUE,
  stopped: initial = false,
  pick,
  height,
}: {
  items?: readonly PermissionRequest[]
  stopped?: boolean
  pick?: Picked
  height?: number
}) {
  const [stopped, setStopped] = useState(initial)
  const front = items[0]
  return (
    <TaskView
      height={height}
      bar={
        <TaskBar
          mark={stopped && front ? <StoppedAsking at={WORDS.at} what={front.what} onAskAgain={() => setStopped(false)} /> : null}
          menu={<TaskMenu onStop={noop} onAbandon={noop} />}
        />
      }
    >
      <Queue
        items={items}
        project={PROJECT}
        defaultEscalated={initial}
        onEscalate={() => setStopped(true)}
        onAskAgain={stopped ? () => setStopped(false) : undefined}
        card={(request, card) => (
          <PromptCard
            request={request}
            project={PROJECT}
            {...card}
            defaultPick={request.id === front?.id ? pick : undefined}
            escalate={escalation((card.total ?? 1) - (card.pos ?? 1))}
            held={
              request.id === PUBLISH.id ? (
                <>
                  <p>{HELD_WHY}</p>
                  <p>{WORDS.heldWayOut}</p>
                </>
              ) : undefined
            }
          />
        )}
      />
    </TaskView>
  )
}

/** Meridian's rules page: allowing everything stays one of the modes, and the tasks that stopped asking are listed. */
function RulesC({ stopped: initial = true }: { stopped?: boolean }) {
  const [mode, setMode] = useState<PermissionPolicy>(PROJECT_DEFAULT)
  const [stopped, setStopped] = useState(initial)
  const words = projectRulesText.rest.mode
  return (
    <RulesSketch
      project={PROJECT}
      restWord={
        <ChoiceWord
          word={words[mode].word}
          label={projectRulesText.rest.label}
          value={mode}
          onChange={setMode}
          options={MODES.map((value) => ({ value, title: words[value].title, note: words[value].note }))}
        />
      }
      restAfter={words[mode].after}
      off={mode === PermissionPolicy.AllowAll ? { ask: projectRulesText.off, allow: projectRulesText.off } : {}}
      more={
        <TasksClause
          label={WORDS.aside}
          headingLevel={2}
          tasks={
            stopped
              ? [
                  {
                    id: TASK.key,
                    task: TASK.key,
                    title: TASK.title,
                    says: WORDS.says(WORDS.at),
                    back: { label: WORDS.again, onBack: () => setStopped(false) },
                  },
                ]
              : []
          }
        />
      }
    />
  )
}

const BoardC = () => (
  <Lane
    label={WORDS.lane}
    mark={
      <Tooltip label={WORDS.markAbout}>
        <Mark size="small" word={WORDS.mark} about={WORDS.markAbout} />
      </Tooltip>
    }
  />
)

const meta = {
  title: 'Explorations/Allow everything/C – Escalate from the prompt',
  decorators: [schemeDecorator],
  args: schemeArgs,
  argTypes: schemeArgTypes,
} satisfies Meta<SchemeArgs>
export default meta
type Story = StoryObj<typeof meta>

/** Before: the card as today, with one answer more at its foot, numbered like the rest. */
export const TheNewAnswer: Story = { name: 'Prompt · before, the new answer', render: () => <TaskC /> }

/** Picked: what it does is said under it before you press, and the button says it too. */
export const StopAskingPicked: Story = { name: 'Prompt · stop asking, picked', render: () => <TaskC pick={ESCALATE} /> }

/** Pressed: the card beats and folds; the two behind it go too, in one line that opens to each; the bar says so. */
export const StoppingAsking: Story = {
  name: 'Prompt · stopping asking, the queue clearing',
  render: () => <TaskC />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: /Allows everything/ })).toBeNull()
    await userEvent.click(c.getByRole('radio', { name: /stop asking on this task/ }))
    await expect(c.getByText(/Allows this and the 2 requests waiting behind it/)).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: /Allow, and stop asking/ }))
    await waitFor(() => expect(c.getByText('Allowed, and stopped asking on this task')).toBeInTheDocument())
    await expect(c.getByText('Allowed 2 requests')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: /Allows everything/ })).toHaveTextContent(`since ${WORDS.at}`)
  },
}

/** After: what you said, what went with it, and the bar. Nothing waits. */
export const After: Story = { name: 'Task · after stopping asking', render: () => <TaskC stopped /> }

/** Ask again, from the bar or the line: the task asks from its next request on; what went ahead stays, since it ran. */
export const AskingAgain: Story = {
  name: 'Task · asking again',
  render: () => <TaskC stopped />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Allows everything/ }))
    const pop = within(await within(document.body).findByRole('dialog', { name: 'This task allows everything' }))
    await userEvent.click(pop.getByRole('button', { name: WORDS.again }))
    await waitFor(() => expect(c.queryByRole('button', { name: /Allows everything/ })).toBeNull())
    await expect(c.getByText('Allowed 2 requests')).toBeInTheDocument()
  },
}

/** A request the "Always ask me" list holds: no "always allow", said why; stopping asking is the way past it, for this task. */
export const HeldCard: Story = { name: 'Prompt · held by Always ask me', render: () => <TaskC items={HELD_FIRST} /> }

/** The rules page: allowing everything is a mode, as now, and the tasks that stopped asking are read with the rules. */
export const RulesPage: Story = { name: 'Rules page · a mode, the task listed', render: () => <RulesC /> }

/** On the board, the card says it in its top line. */
export const Board: Story = { name: 'Board · the card says so', render: () => <BoardC /> }

/** Each state in light and in the dark stand-in. The bar's popover shows in dark from a story's scheme control. */
export const LightAndDark: Story = {
  name: 'Light and dark',
  render: () => (
    <Pairs
      pairs={[
        { state: 'Prompt · stop asking, picked', stacked: true, node: () => <TaskC pick={ESCALATE} height={820} /> },
        { state: 'Task · after stopping asking', stacked: true, node: () => <TaskC stopped height={400} /> },
        { state: 'Prompt · held by Always ask me', stacked: true, node: () => <TaskC items={HELD_FIRST} height={820} /> },
        { state: 'Rules page · a mode, the task listed', stacked: true, node: () => <RulesC /> },
        { state: 'Board', node: () => <BoardC /> },
      ]}
    />
  ),
}
