import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { TaskMenu } from '../../../chrome/TaskMenu/TaskMenu'
import { PermissionPolicy } from '../../../foundations/vocabulary'
import { Tooltip } from '../../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../../primitives/LinkButton/LinkButton'
import { HELD_FIRST, HELD_WHY, MODE_WORDS, MODES_BY_ASKING, PROJECT, PROJECT_DEFAULT, PUBLISH } from '../fixtures'
import { Lane } from '../parts/BoardCard'
import { Mark } from '../parts/Mark'
import { PromptCard } from '../parts/PromptCard'
import { Queue } from '../parts/Queue'
import { TaskBar } from '../parts/TaskBar'
import { TaskView } from '../parts/TaskView'
import { Pairs, schemeArgs, schemeArgTypes, schemeDecorator, type SchemeArgs } from '../Scheme'
import { TaskPosture } from './PostureDial'
import { RulesWithDial, rulesWithDialText } from './RulesWithDial'

/*
 * B · Posture dial. The rules page opens on the four modes as one dial,
 * from asking most to asking nothing. A task's bar says where it stands on
 * it, "Project default" or "This task", and opens to set its own; the
 * rules page lists the tasks that do.
 */

const WORDS = {
  off: rulesWithDialText.off,
  wayOut: 'Change how much this task asks…',
  cleared: { why: 'waiting when this task was set to allow everything', rule: 'This task: allow everything' },
  mark: 'Allows everything',
  markAbout: 'This task allows everything. Never still holds.',
  lane: 'Running',
}

const noop = () => {}

/** Task 418, its place on the dial in its bar; with its waiting requests, the held one in front. */
function TaskB({
  projectMode = PROJECT_DEFAULT,
  own: initialOwn = null,
  open: initialOpen = false,
  queue = false,
  height,
}: {
  projectMode?: PermissionPolicy
  own?: PermissionPolicy | null
  open?: boolean
  queue?: boolean
  height?: number
}) {
  const [own, setOwn] = useState(initialOwn)
  const [open, setOpen] = useState(initialOpen)
  const everything = (own ?? projectMode) === PermissionPolicy.AllowAll
  return (
    <TaskView
      height={height}
      bar={
        <TaskBar
          mark={
            <TaskPosture
              project={PROJECT}
              order={MODES_BY_ASKING}
              words={MODE_WORDS}
              projectMode={projectMode}
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
      {queue && (
        <Queue
          items={HELD_FIRST}
          project={PROJECT}
          clearedBy={everything ? WORDS.cleared : null}
          card={(request, card) => (
            <PromptCard
              request={request}
              project={PROJECT}
              {...card}
              held={
                request.id === PUBLISH.id ? (
                  <>
                    <p>{HELD_WHY}</p>
                    <LinkButton onClick={() => setOpen(true)}>{WORDS.wayOut}</LinkButton>
                  </>
                ) : undefined
              }
            />
          )}
        />
      )}
    </TaskView>
  )
}

const BoardB = () => (
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
  title: 'Explorations/Allow everything/B – Posture dial',
  decorators: [schemeDecorator],
  args: schemeArgs,
  argTypes: schemeArgTypes,
} satisfies Meta<SchemeArgs>
export default meta
type Story = StoryObj<typeof meta>

/** The rules page opens on the dial, at Meridian's mode; what the chosen mode means under it. */
export const RulesPage: Story = { name: 'Rules page · the dial', render: () => <RulesWithDial /> }

/** At its end, Allow everything: Ask me and Go ahead go quiet and say why. Never still holds; so does Always. */
export const RulesPageAllowEverything: Story = {
  name: 'Rules page · at Allow everything',
  render: () => <RulesWithDial mode={PermissionPolicy.AllowAll} />,
}

/** A task that sets its own is read with the rules, with the way back to the project's beside it. */
export const RulesPageTaskSetsItsOwn: Story = {
  name: 'Rules page · a task that sets its own',
  render: () => <RulesWithDial own={PermissionPolicy.AllowAll} />,
}

/** A press, or the arrows: what the chosen mode means changes under the dial, and the lists go quiet only at its end. */
export const TurningTheDial: Story = {
  name: 'Rules page · turning the dial',
  render: () => <RulesWithDial />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const dial = within(c.getByRole('radiogroup', { name: 'How much agents ask' }))
    await expect(dial.getByRole('radio', { name: 'The coordinator decides' })).toBeChecked()
    await userEvent.click(dial.getByRole('radio', { name: 'Allow everything' }))
    await expect(c.getAllByText(WORDS.off)).toHaveLength(2)
    await expect(c.getByText(MODE_WORDS[PermissionPolicy.AllowAll].note)).toBeInTheDocument()
    await userEvent.click(dial.getByRole('radio', { name: 'Ask me' }))
    await expect(c.queryByText(WORDS.off)).toBeNull()
  },
}

/** Following the project: its bar says so, quietly. */
export const TaskFollowsProject: Story = { name: 'Task · following the project', render: () => <TaskB /> }

/** Its words open the dial for this task alone, the project's own marked. */
export const TaskChipOpen: Story = { name: 'Task · its words open', render: () => <TaskB open /> }

/** Set to allow everything: "This task · Allow everything", in ink, with its glyph. */
export const TaskAllowsEverything: Story = {
  name: 'Task · set to allow everything',
  render: () => <TaskB own={PermissionPolicy.AllowAll} />,
}

/** Set the other way, to ask more than the project does: said, without the glyph. */
export const TaskAsksMore: Story = { name: 'Task · set to ask me', render: () => <TaskB own={PermissionPolicy.Ask} /> }

/** The project allows everything, and the task follows it: still said in ink, as every task in it would. */
export const ProjectAllowsEverything: Story = {
  name: 'Task · the project allows everything',
  render: () => <TaskB projectMode={PermissionPolicy.AllowAll} />,
}

/** Two presses to allow everything on one task; Back to project default undoes it from the same place. */
export const SettingItForATask: Story = {
  name: 'Task · setting its own, and back',
  render: () => <TaskB />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    const words = c.getByRole('button', { name: /Project default/ })
    await expect(words).toHaveTextContent('Coordinator decides')
    await userEvent.click(words)
    await userEvent.click(await page.findByRole('radio', { name: /^Allow everything/ }))
    await expect(c.getByRole('button', { name: /This task/ })).toHaveTextContent('Allow everything')
    await userEvent.click(page.getByRole('button', { name: 'Back to project default' }))
    await expect(c.getByRole('button', { name: /Project default/ })).toBeInTheDocument()
  },
}

/** A request the "Always ask me" list holds: the card says why there's no "always allow", and opens the task's dial. */
export const HeldCard: Story = { name: 'Prompt · held by Always ask me', render: () => <TaskB queue /> }

/** From the held card to the task's dial; at Allow everything, what waited goes in one line. */
export const HeldCardWayOut: Story = {
  name: 'Prompt · the held card’s way out',
  render: () => <TaskB queue />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: WORDS.wayOut }))
    await userEvent.click(await within(document.body).findByRole('radio', { name: /^Allow everything/ }))
    await waitFor(() => expect(c.getByText('Allowed 3 requests')).toBeInTheDocument())
    await expect(c.getByRole('button', { name: /This task/ })).toHaveTextContent('Allow everything')
  },
}

/** On the board, only allowing everything is said: the other modes aren't worth a word on a card. */
export const Board: Story = { name: 'Board · the card says so', render: () => <BoardB /> }

/** Each state in light and in the dark stand-in. The dial's popover shows in dark from a story's scheme control. */
export const LightAndDark: Story = {
  name: 'Light and dark',
  render: () => (
    <Pairs
      pairs={[
        { state: 'Rules page · the dial', stacked: true, node: () => <RulesWithDial /> },
        {
          state: 'Rules page · at Allow everything, a task that sets its own',
          stacked: true,
          node: () => <RulesWithDial mode={PermissionPolicy.AllowAll} own={PermissionPolicy.Ask} />,
        },
        { state: 'Task · following the project', stacked: true, node: () => <TaskB height={180} /> },
        {
          state: 'Task · set to allow everything, what waited let through',
          stacked: true,
          node: () => <TaskB own={PermissionPolicy.AllowAll} queue height={460} />,
        },
        { state: 'Task · set to ask me', stacked: true, node: () => <TaskB own={PermissionPolicy.Ask} height={180} /> },
        { state: 'Prompt · held by Always ask me', stacked: true, node: () => <TaskB queue /> },
        { state: 'Board', node: () => <BoardB /> },
      ]}
    />
  ),
}
