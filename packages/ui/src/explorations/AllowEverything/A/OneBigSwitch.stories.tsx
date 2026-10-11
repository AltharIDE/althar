import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { PermissionPolicy } from '../../../foundations/vocabulary'
import { Tooltip } from '../../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../../primitives/LinkButton/LinkButton'
import { projectRulesText } from '../../../screens/ProjectRules/ProjectRules'
import { ChoiceWord } from '../../../setup/Charter/Charter'
import { HELD_FIRST, HELD_WHY, PROJECT, PROJECT_DEFAULT, PUBLISH } from '../fixtures'
import { Lane } from '../parts/BoardCard'
import { Mark } from '../parts/Mark'
import { PromptCard } from '../parts/PromptCard'
import { Queue } from '../parts/Queue'
import { RulesSketch } from '../parts/RulesSketch'
import { TaskBar } from '../parts/TaskBar'
import { TaskView } from '../parts/TaskView'
import { Pairs, schemeArgs, schemeArgTypes, schemeDecorator, type SchemeArgs } from '../Scheme'
import { BigSwitch, SwitchMenu } from './OneBigSwitch'

/*
 * A · One big switch. The project's rules page opens on one switch over
 * everything; a task's menu has the same switch, and its bar says
 * "Unrestricted" while it is on. Never stays in force under the switch,
 * with a second switch to set it aside too.
 */

const WORDS = {
  off: 'Not in effect while everything is allowed.',
  neverOff: 'Not in effect while Ignore Never too is on.',
  mark: 'Unrestricted',
  markAbout: 'Allow everything is on for this task. Never still holds.',
  cleared: { why: 'waiting when you allowed everything', rule: 'Allow everything on this task' },
  wayOut: 'Allow everything on this task…',
  lane: 'Running',
}

const noop = () => {}
/** The rest, without allowing everything: the switch over the page is that. */
const REST_MODES = [PermissionPolicy.Ask, PermissionPolicy.Coordinator, PermissionPolicy.Rules] as const

/** Meridian's rules page with the switch over it, kept as it is changed. Turning the switch off sets Never's back too. */
function RulesA({ on: initial = false, ignoreNever: initialIgnore = false }: { on?: boolean; ignoreNever?: boolean }) {
  const [on, setOn] = useState(initial)
  const [ignore, setIgnore] = useState(initialIgnore)
  const [mode, setMode] = useState<PermissionPolicy>(PROJECT_DEFAULT)
  const words = projectRulesText.rest.mode
  return (
    <RulesSketch
      project={PROJECT}
      top={
        <BigSwitch
          project={PROJECT}
          on={on}
          onChange={(next) => {
            setOn(next)
            if (!next) setIgnore(false)
          }}
          ignoreNever={ignore}
          onIgnoreNeverChange={setIgnore}
        />
      }
      restWord={
        <ChoiceWord
          word={words[mode].word}
          label={projectRulesText.rest.label}
          value={mode}
          onChange={setMode}
          options={REST_MODES.map((value) => ({ value, title: words[value].title, note: words[value].note }))}
        />
      }
      restAfter={words[mode].after}
      off={on ? { ask: WORDS.off, allow: WORDS.off, rest: WORDS.off, ...(ignore ? { never: WORDS.neverOff } : {}) } : {}}
    />
  )
}

/** "Unrestricted" in the task's bar, with what it means on hover. */
const UnrestrictedMark = () => (
  <Tooltip label={WORDS.markAbout}>
    <Mark word={WORDS.mark} about={WORDS.markAbout} />
  </Tooltip>
)

/** Task 418 with the switch in its menu; with its waiting requests, the held one in front. */
function TaskA({
  on: initial = false,
  menuOpen = false,
  queue = false,
  height,
}: {
  on?: boolean
  menuOpen?: boolean
  queue?: boolean
  height?: number
}) {
  const [on, setOn] = useState(initial)
  const [open, setOpen] = useState(menuOpen)
  return (
    <TaskView
      height={height}
      bar={
        <TaskBar
          mark={on ? <UnrestrictedMark /> : null}
          menu={<SwitchMenu on={on} onChange={setOn} onStop={noop} onAbandon={noop} open={open} onOpenChange={setOpen} />}
        />
      }
    >
      {queue && (
        <Queue
          items={HELD_FIRST}
          project={PROJECT}
          clearedBy={on ? WORDS.cleared : null}
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

const BoardA = () => <Lane label={WORDS.lane} mark={<Mark size="small" word={WORDS.mark} about={WORDS.markAbout} />} />

const meta = {
  title: 'Explorations/Allow everything/A · One big switch',
  decorators: [schemeDecorator],
  args: schemeArgs,
  argTypes: schemeArgTypes,
} satisfies Meta<SchemeArgs>
export default meta
type Story = StoryObj<typeof meta>

/** The rules page opens on the switch, off: the sentences under it hold as they do today. */
export const RulesPageOff: Story = { name: 'Rules page · off', render: () => <RulesA /> }

/** On: Ask me, Go ahead and The rest dim and say they aren't in effect. Never still holds, and its own switch shows. */
export const RulesPageOn: Story = { name: 'Rules page · on', render: () => <RulesA on /> }

/** On, and Never set aside too: nothing is refused. The fixed sentence, credentials and the code host, still holds. */
export const RulesPageIgnoringNever: Story = { name: 'Rules page · on, ignoring Never too', render: () => <RulesA on ignoreNever /> }

/** One press: the lists under it go quiet, and Never's switch appears, off. Turning the big one off sets Never's back. */
export const TurningItOn: Story = {
  name: 'Rules page · turning it on',
  render: () => <RulesA />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const big = c.getByRole('switch', { name: 'Allow everything' })
    await expect(c.queryByRole('switch', { name: 'Ignore Never too' })).toBeNull()
    await userEvent.click(big)
    await expect(big).toHaveAttribute('aria-checked', 'true')
    await expect(c.getAllByText(WORDS.off)).toHaveLength(3)
    const never = c.getByRole('switch', { name: 'Ignore Never too' })
    await expect(never).toHaveAttribute('aria-checked', 'false')
    await expect(never).toHaveAccessibleDescription(/Never still holds/)
    await userEvent.click(never)
    await expect(c.getByText(WORDS.neverOff)).toBeInTheDocument()
    await userEvent.click(big)
    await expect(c.queryByText(WORDS.off)).toBeNull()
    await userEvent.click(big)
    await expect(c.getByRole('switch', { name: 'Ignore Never too' })).toHaveAttribute('aria-checked', 'false')
  },
}

/** The same switch, first in the task's menu, as a check. */
export const TaskMenuSwitch: Story = { name: 'Task · the switch in its menu', render: () => <TaskA menuOpen /> }

/** On for this task: "Unrestricted" in its bar, beside where it stands; what it means on hover. */
export const TaskUnrestricted: Story = { name: 'Task · Unrestricted in its bar', render: () => <TaskA on /> }

/** Turned on from the menu while three wait: the bar says so, and what waited goes, in one line that opens to each. */
export const TurningItOnForATask: Story = {
  name: 'Task · turning it on while requests wait',
  render: () => <TaskA queue />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await expect(c.queryByText(WORDS.mark)).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'More for this task' }))
    await userEvent.click(await page.findByRole('menuitemcheckbox', { name: 'Allow everything on this task' }))
    await waitFor(() => expect(c.getByText(WORDS.mark)).toBeInTheDocument())
    await expect(c.getByText('Allowed 3 requests')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: /^Allow$/ })).toBeNull()
  },
}

/** A request the "Always ask me" list holds: the card says why there's no "always allow", and points at the switch. */
export const HeldCard: Story = { name: 'Prompt · held by Always ask me', render: () => <TaskA queue /> }

/** The card's way out opens the task's menu, at the switch. */
export const HeldCardWayOut: Story = {
  name: 'Prompt · the held card’s way out',
  render: () => <TaskA queue />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('radio', { name: /always allow/ })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: WORDS.wayOut }))
    await expect(await within(document.body).findByRole('menuitemcheckbox', { name: 'Allow everything on this task' })).toBeInTheDocument()
  },
}

/** On the board, the card says it in its top line. Task 419, beside it, allows nothing out of the ordinary. */
export const Board: Story = { name: 'Board · the card says so', render: () => <BoardA /> }

/** Each state in light and in the dark stand-in. Open menus show in dark from a story's scheme control. */
export const LightAndDark: Story = {
  name: 'Light and dark',
  render: () => (
    <Pairs
      pairs={[
        { state: 'Rules page · off', stacked: true, node: () => <RulesA /> },
        { state: 'Rules page · on', stacked: true, node: () => <RulesA on /> },
        { state: 'Rules page · on, ignoring Never too', stacked: true, node: () => <RulesA on ignoreNever /> },
        { state: 'Task · Unrestricted, what waited let through', stacked: true, node: () => <TaskA on queue height={460} /> },
        { state: 'Prompt · held by Always ask me', stacked: true, node: () => <TaskA queue height={700} /> },
        { state: 'Board', node: () => <BoardA /> },
      ]}
    />
  ),
}
