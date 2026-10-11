import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { PermissionPolicy } from '../../../foundations/vocabulary'
import { ActionButton } from '../../../primitives/ActionButton/ActionButton'
import { Tooltip } from '../../../primitives/HoverCard/HoverCard'
import { Menu, MenuItem } from '../../../primitives/Menu/Menu'
import { projectRulesText } from '../../../screens/ProjectRules/ProjectRules'
import { ChoiceWord } from '../../../setup/Charter/Charter'
import { Allowed } from '../../../thread/Permission/Permission'
import { ExploreIcon } from '../ExploreIcon'
import { HELD_FIRST, HELD_WHY, PROJECT, PROJECT_DEFAULT, PUBLISH, WENT_AHEAD } from '../fixtures'
import { Lane } from '../parts/BoardCard'
import { Mark } from '../parts/Mark'
import { PromptCard } from '../parts/PromptCard'
import { Queue } from '../parts/Queue'
import { RulesSketch } from '../parts/RulesSketch'
import { TaskBar } from '../parts/TaskBar'
import { TaskView } from '../parts/TaskView'
import { Pairs, schemeArgs, schemeArgTypes, schemeDecorator, type SchemeArgs } from '../Scheme'
import { detailOf, forAWhileText, ProjectWhile, type While, WhileEnded, WhileMenu, WhilePill, type WhileKind } from './ForAWhile'

/*
 * D · For a while. Allowing everything is always chosen with how long it
 * lasts: an hour, until the task finishes, or until you turn it off. A pill
 * over the composer says it lasts and how long is left, and opens to end it
 * or give it an hour more; the bar says it too. When it ends, it says so
 * once, and the thread keeps a line of what went ahead meanwhile.
 */

const WORDS = {
  mark: 'Allows everything',
  markAbout: 'Everything on this task goes ahead for a while. Never still holds.',
  endedAt: '12:52',
  meanwhile: 'while everything was allowed, 11:52 to 12:52',
  cleared: { why: 'waiting when you allowed everything for a while', rule: 'Allow everything, for a while' },
  heldTrigger: 'Allow everything for…',
  off: (detail: string) => `Not in effect while everything is allowed, ${detail}.`,
  started: (detail: string) => `Allowing everything on this task, ${detail}.`,
  lane: 'Running',
}

const HOUR: While = { kind: 'hour', left: '52m', until: '12:52' }
const SOON: While = { kind: 'hour', left: '2m', until: '12:52' }
const fresh = (kind: WhileKind): While => {
  switch (kind) {
    case 'hour':
      return { kind, left: '1h', until: '12:52' }
    case 'task':
    case 'off':
      return { kind }
  }
}
const noop = () => {}
const KINDS: readonly WhileKind[] = ['hour', 'task', 'off']
/** The rest, without allowing everything for good: "until I turn it off" is that. */
const REST_MODES = [PermissionPolicy.Ask, PermissionPolicy.Coordinator, PermissionPolicy.Rules] as const

/** How long, from the foot of the held card: its way out. */
function HeldWayOut({ onStart }: { onStart: (kind: WhileKind) => void }) {
  return (
    <Menu
      label={forAWhileText.menuGroup}
      trigger={
        <ActionButton size="small" trailingIcon="chevronD">
          {WORDS.heldTrigger}
        </ActionButton>
      }
    >
      {KINDS.map((kind) => (
        <MenuItem key={kind} lead={<ExploreIcon name="hourglass" size={13} />} onSelect={() => onStart(kind)}>
          {forAWhileText.choose[kind]}
        </MenuItem>
      ))}
    </Menu>
  )
}

/** Task 418: how long, from its menu; while it lasts, the pill over its composer and the mark in its bar; once ended, its line. */
function TaskD({
  bypass: initial = null,
  project = false,
  ended: initialEnded = false,
  menuOpen = false,
  pillOpen = false,
  queue = false,
  height,
}: {
  bypass?: While | null
  /** It is the project's, not the task's own. */
  project?: boolean
  ended?: boolean
  menuOpen?: boolean
  pillOpen?: boolean
  queue?: boolean
  height?: number
}) {
  const [bypass, setBypass] = useState(initial)
  const [ended, setEnded] = useState(initialEnded)
  const [announce, setAnnounce] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState(menuOpen)
  const start = (kind: WhileKind) => {
    const next = fresh(kind)
    setBypass(next)
    setEnded(false)
    setAnnounce(WORDS.started(detailOf(next)))
  }
  const stop = () => {
    setBypass(null)
    setEnded(true)
  }
  return (
    <TaskView
      height={height}
      bar={
        <TaskBar
          mark={
            bypass === null ? null : (
              <Tooltip label={WORDS.markAbout}>
                <Mark icon="hourglass" word={WORDS.mark} detail={detailOf(bypass)} about={WORDS.markAbout} />
              </Tooltip>
            )
          }
          menu={
            <WhileMenu
              bypass={project ? null : bypass}
              onStart={start}
              onStop={stop}
              onStopTask={noop}
              onAbandon={noop}
              open={open}
              onOpenChange={setOpen}
            />
          }
        />
      }
      above={
        bypass !== null ? (
          <WhilePill
            bypass={bypass}
            project={project ? PROJECT : null}
            onStop={stop}
            onLonger={() => setBypass({ kind: 'hour', left: '1h 52m', until: '13:52' })}
            defaultOpen={pillOpen}
            announce={announce}
          />
        ) : ended ? (
          <WhileEnded at={WORDS.endedAt} />
        ) : null
      }
    >
      {queue && (
        <Queue
          items={HELD_FIRST}
          project={PROJECT}
          clearedBy={bypass !== null ? WORDS.cleared : null}
          card={(request, card) => (
            <PromptCard
              request={request}
              project={PROJECT}
              {...card}
              held={request.id === PUBLISH.id ? <p>{HELD_WHY}</p> : undefined}
              foot={request.id === PUBLISH.id ? <HeldWayOut onStart={start} /> : undefined}
            />
          )}
        />
      )}
      {ended && !queue && <Allowed items={WENT_AHEAD} project={PROJECT} text={{ allowedWho: () => WORDS.meanwhile }} />}
    </TaskView>
  )
}

/** Meridian's rules page, with how long to allow everything over it. */
function RulesD({ bypass: initial = null }: { bypass?: While | null }) {
  const [bypass, setBypass] = useState(initial)
  const [mode, setMode] = useState<PermissionPolicy>(PROJECT_DEFAULT)
  const words = projectRulesText.rest.mode
  const off = bypass === null ? null : WORDS.off(detailOf(bypass))
  return (
    <RulesSketch
      project={PROJECT}
      top={
        <ProjectWhile
          project={PROJECT}
          bypass={bypass}
          onStart={(kind) => setBypass(fresh(kind))}
          onStop={() => setBypass(null)}
          onLonger={() => setBypass({ kind: 'hour', left: '1h 52m', until: '13:52' })}
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
      off={off === null ? {} : { ask: off, allow: off, rest: off }}
    />
  )
}

const BoardD = () => (
  <Lane
    label={WORDS.lane}
    mark={
      <Tooltip label={WORDS.markAbout}>
        <Mark size="small" icon="hourglass" word={WORDS.mark} detail={detailOf(HOUR)} about={WORDS.markAbout} />
      </Tooltip>
    }
  />
)

const meta = {
  title: 'Explorations/Allow everything/D – For a while',
  decorators: [schemeDecorator],
  args: schemeArgs,
  argTypes: schemeArgTypes,
} satisfies Meta<SchemeArgs>
export default meta
type Story = StoryObj<typeof meta>

/** From the task's menu, always with how long. */
export const TaskMenuChoosing: Story = { name: 'Task · choosing how long', render: () => <TaskD menuOpen /> }

/** For an hour: the pill over the composer counts down, the bar says it too. Nothing in violet: nothing waits on you. */
export const ForAnHour: Story = { name: 'Task · for an hour', render: () => <TaskD bypass={HOUR} /> }

/** The pill opens to what it means, Ask again now, and an hour more. */
export const PillOpen: Story = { name: 'Task · what the pill opens', render: () => <TaskD bypass={HOUR} pillOpen /> }

/** Until the task finishes: no clock; it ends with the task, and a reopened task asks again. */
export const UntilItFinishes: Story = { name: 'Task · until it finishes', render: () => <TaskD bypass={{ kind: 'task' }} /> }

/** Until you turn it off: the pill stays as long as it does. */
export const UntilTurnedOff: Story = { name: 'Task · until you turn it off', render: () => <TaskD bypass={{ kind: 'off' }} /> }

/** Near its end: only the count changes. Nothing blinks; it is announced as it starts and as it ends, not at every tick. */
export const EndingSoon: Story = { name: 'Task · two minutes left', render: () => <TaskD bypass={SOON} /> }

/** Ended: the pill says so once, then goes; the thread keeps a line of what went ahead meanwhile, which opens to each. */
export const Ended: Story = { name: 'Task · when it ends', render: () => <TaskD ended /> }

/** Starting it from the menu: the pill and the bar's mark appear, and it is announced once. */
export const StartingFromTheMenu: Story = {
  name: 'Task · starting it',
  render: () => <TaskD />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'More for this task' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'For an hour' }))
    await waitFor(() => expect(c.getByRole('button', { name: /Allowing everything/ })).toHaveTextContent('1h left'))
    await expect(c.getByText(WORDS.started('1h left'))).toBeInTheDocument()
  },
}

/** Ending it early, from the pill: it says it asks again, and the line of what went ahead stays. */
export const EndingEarly: Story = {
  name: 'Task · ending it early',
  render: () => <TaskD bypass={HOUR} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Allowing everything/ }))
    await userEvent.click(await within(document.body).findByRole('button', { name: 'Ask again now' }))
    await waitFor(() => expect(c.getByRole('status')).toHaveTextContent('Asking again'))
    await expect(c.getByText('Allowed 4 requests')).toBeInTheDocument()
  },
}

/** A request the "Always ask me" list holds: the card says why there's no "always allow", and offers a while at its foot. */
export const HeldCard: Story = { name: 'Prompt · held by Always ask me', render: () => <TaskD queue /> }

/** From the held card's foot, until the task finishes: what waited goes in one line, and the pill shows. */
export const HeldCardWayOut: Story = {
  name: 'Prompt · the held card’s way out',
  render: () => <TaskD queue />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: WORDS.heldTrigger }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Until this task finishes' }))
    await waitFor(() => expect(c.getByText('Allowed 3 requests')).toBeInTheDocument())
    await expect(c.getByRole('button', { name: /Allowing everything/ })).toHaveTextContent('until this task finishes')
  },
}

/** For the project, over its rules page: how long, as three plain choices. */
export const RulesPage: Story = { name: 'Rules page · for a while', render: () => <RulesD /> }

/** While it lasts: how long is left, the way to end it, and the sentences it sets aside said so. */
export const RulesPageAllowing: Story = { name: 'Rules page · 52 minutes left', render: () => <RulesD bypass={HOUR} /> }

/** The project's, seen from one of its tasks: the pill says whose it is. */
export const ProjectsInATask: Story = { name: 'Task · the project’s, in a task', render: () => <TaskD bypass={HOUR} project /> }

/** On the board, the card says it, with how long is left. */
export const Board: Story = { name: 'Board · the card says so', render: () => <BoardD /> }

/** Each state in light and in the dark stand-in. Menus and the pill's popover show in dark from a story's scheme control. */
export const LightAndDark: Story = {
  name: 'Light and dark',
  render: () => (
    <Pairs
      pairs={[
        { state: 'Task · for an hour', stacked: true, node: () => <TaskD bypass={HOUR} height={300} /> },
        { state: 'Task · until it finishes', stacked: true, node: () => <TaskD bypass={{ kind: 'task' }} height={300} /> },
        { state: 'Task · when it ends', stacked: true, node: () => <TaskD ended height={340} /> },
        { state: 'Prompt · held by Always ask me', stacked: true, node: () => <TaskD queue /> },
        { state: 'Rules page · for a while', stacked: true, node: () => <RulesD /> },
        { state: 'Rules page · 52 minutes left', stacked: true, node: () => <RulesD bypass={HOUR} /> },
        { state: 'Task · the project’s, in a task', stacked: true, node: () => <TaskD bypass={HOUR} project height={300} /> },
        { state: 'Board', node: () => <BoardD /> },
      ]}
    />
  ),
}
