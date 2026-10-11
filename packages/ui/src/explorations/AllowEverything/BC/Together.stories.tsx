import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { TaskMenu } from '../../../chrome/TaskMenu/TaskMenu'
import { Running } from '../../../composer/Running/Running'
import { PermissionPolicy } from '../../../foundations/vocabulary'
import type { PermissionRequest } from '../../../thread/Permission/Permission'
import { TaskPosture } from '../B/PostureDial'
import { RulesWithDial } from '../B/RulesWithDial'
import { escalation } from '../C/FromThePrompt'
import { HELD_FIRST, HELD_WHY, MODE_WORDS, MODES_BY_ASKING, PROJECT, PROJECT_DEFAULT, PUBLISH, QUEUE } from '../fixtures'
import { ESCALATE, type Picked, PromptCard } from '../parts/PromptCard'
import { Queue } from '../parts/Queue'
import { TaskBar } from '../parts/TaskBar'
import { TaskView } from '../parts/TaskView'
import { Pairs, schemeArgs, schemeArgTypes, schemeDecorator, type SchemeArgs } from '../Scheme'

/*
 * B + C, together, in a task's view: the bar says where the task stands on
 * the dial (B); the card's last answer stops asking (C), and what it does is
 * set this task to Allow everything, so the bar says so, and Back to project
 * default undoes it from the bar or from the line the card left. One model,
 * two ways in: the dial when you mean to, the card when asking is in the way.
 */

const allows = (waiting: number) => {
  if (waiting === 0) return 'this request'
  if (waiting === 1) return 'this, the request waiting behind it'
  return `this, the ${waiting} requests waiting behind it`
}

const WORDS = {
  note: (waiting: number) =>
    `Sets this task to Allow everything: ${allows(waiting)} and what it asks after go ahead. Back to project default from the bar. Never still holds, and no agent reads your credentials or reaches the code host except through Althar.`,
  queue: {
    escalated: 'Allowed, and set this task to allow everything',
    escalatedNote: '· said in the bar',
    escalatedRule: 'This task: allow everything',
    undo: 'Back to project default',
  },
  cleared: { why: 'waiting when this task was set to allow everything', rule: 'This task: allow everything' },
  heldWayOut: '“Stop asking on this task”, the last answer, gets past it, on this task only.',
}

const DEV = { id: 'dev', command: 'bun dev', url: 'localhost:5173', since: '12m' }
const noop = () => {}

/** Task 418: its place on the dial in its bar, its waiting requests with the card's last answer, and its composer. */
function TaskBC({
  items = QUEUE,
  own: initialOwn = null,
  open: initialOpen = false,
  pick,
  height,
}: {
  items?: readonly PermissionRequest[]
  /** Set to allow everything already, from the card: the state after it. */
  own?: PermissionPolicy | null
  open?: boolean
  pick?: Picked
  height?: number
}) {
  const [own, setOwn] = useState(initialOwn)
  const [open, setOpen] = useState(initialOpen)
  const everything = (own ?? PROJECT_DEFAULT) === PermissionPolicy.AllowAll
  const front = items[0]
  return (
    <TaskView
      height={height}
      above={<Running processes={[DEV]} />}
      bar={
        <TaskBar
          mark={
            <TaskPosture
              project={PROJECT}
              order={MODES_BY_ASKING}
              words={MODE_WORDS}
              projectMode={PROJECT_DEFAULT}
              own={own}
              onChange={setOwn}
              open={open}
              onOpenChange={setOpen}
            />
          }
          menu={<TaskMenu onStop={noop} onAbandon={noop} />}
        />
      }
    >
      <Queue
        items={items}
        project={PROJECT}
        defaultEscalated={initialOwn === PermissionPolicy.AllowAll}
        clearedBy={everything ? WORDS.cleared : null}
        onEscalate={() => setOwn(PermissionPolicy.AllowAll)}
        onAskAgain={everything ? () => setOwn(null) : undefined}
        text={WORDS.queue}
        card={(request, card) => (
          <PromptCard
            request={request}
            project={PROJECT}
            {...card}
            defaultPick={request.id === front?.id ? pick : undefined}
            escalate={escalation((card.total ?? 1) - (card.pos ?? 1), { note: WORDS.note })}
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

const meta = {
  title: 'Explorations/Allow everything/B + C – Together',
  decorators: [schemeDecorator],
  args: schemeArgs,
  argTypes: schemeArgTypes,
} satisfies Meta<SchemeArgs>
export default meta
type Story = StoryObj<typeof meta>

/** A request waiting: the bar says the task follows the project; the card has its last answer. */
export const Waiting: Story = { name: 'Task view · a request waiting', render: () => <TaskBC /> }

/** The last answer picked: it says it sets this task to Allow everything, and where to undo it. */
export const StopAskingPicked: Story = { name: 'Task view · stop asking, picked', render: () => <TaskBC pick={ESCALATE} /> }

/** Pressed: the card folds, the two behind it go, and the bar now says "This task · Allow everything". Back to project default undoes it. */
export const StoppingAsking: Story = {
  name: 'Task view · stopping asking, said in the bar',
  render: () => <TaskBC />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: /Project default/ })).toHaveTextContent('Coordinator decides')
    await userEvent.click(c.getByRole('radio', { name: /stop asking on this task/ }))
    await userEvent.click(c.getByRole('button', { name: /Allow, and stop asking/ }))
    await waitFor(() => expect(c.getByRole('button', { name: /This task/ })).toHaveTextContent('Allow everything'))
    await expect(c.getByText('Allowed 2 requests')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Back to project default' }))
    await expect(c.getByRole('button', { name: /Project default/ })).toBeInTheDocument()
  },
}

/** After: one place says it, the bar; the line in the thread says when, and offers the way back too. */
export const After: Story = { name: 'Task view · after', render: () => <TaskBC own={PermissionPolicy.AllowAll} /> }

/** The bar open after: the same dial, at Allow everything, with Back to project default. */
export const AfterBarOpen: Story = {
  name: 'Task view · after, the bar open',
  render: () => <TaskBC own={PermissionPolicy.AllowAll} open />,
}

/** A request the "Always ask me" list holds: why there's no "always allow", and the last answer as the way past it. */
export const HeldCard: Story = { name: 'Task view · held by Always ask me', render: () => <TaskBC items={HELD_FIRST} /> }

/** The project's rules page: B's dial, with the task listed as setting its own, and the way back. */
export const RulesPage: Story = {
  name: 'Rules page · the dial, the task listed',
  render: () => <RulesWithDial own={PermissionPolicy.AllowAll} />,
}

/** Each state in light and in the dark stand-in. The bar's popover shows in dark from a story's scheme control. */
export const LightAndDark: Story = {
  name: 'Light and dark',
  render: () => (
    <Pairs
      pairs={[
        { state: 'Task view · stop asking, picked', stacked: true, node: () => <TaskBC pick={ESCALATE} height={860} /> },
        { state: 'Task view · after', stacked: true, node: () => <TaskBC own={PermissionPolicy.AllowAll} height={420} /> },
        { state: 'Task view · held by Always ask me', stacked: true, node: () => <TaskBC items={HELD_FIRST} height={860} /> },
        { state: 'Rules page · the dial, the task listed', stacked: true, node: () => <RulesWithDial own={PermissionPolicy.AllowAll} /> },
      ]}
    />
  ),
}
