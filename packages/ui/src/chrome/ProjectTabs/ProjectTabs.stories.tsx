import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { MARKED } from '../../fixtures/marks'
import { Room } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import { RoomSwitch } from '../RoomSwitch/RoomSwitch'
import { WorkStatus } from '../WorkStatus/WorkStatus'
import { type ProjectTab, ProjectTabs, type ProjectTabsProps } from './ProjectTabs'

/* The projects on this Mac (marks.ts), with how many calls wait in each. */
const YOURS: Readonly<Record<string, number>> = { meridian: 2, tessera: 1 }
const ALL: ProjectTab[] = MARKED.map((p) => ({
  id: p.id,
  name: p.name,
  seed: p.id,
  ink: p.ink,
  running: p.running,
  yours: YOURS[p.id] ?? 0,
}))
const byId = (id: string) => ALL.find((p) => p.id === id) ?? ALL[0]!

/* Many open, with a name too long for its tab. */
const MANY: ProjectTab[] = [
  ...ALL,
  ...['ledger', 'billing-web', 'infra', 'mobile-and-the-long-tail-of-platform-work'].map((id, i) => ({
    id,
    name: id,
    seed: id,
    ink: ALL[i % ALL.length]!.ink,
    running: i === 1,
    yours: i === 2 ? 3 : 0,
  })),
]

/* Twenty open, a few with work or calls: more than any window holds at full width. */
const TWENTY: ProjectTab[] = Array.from({ length: 20 }, (_, i) => {
  const base = ALL[i % ALL.length] ?? ALL[0]!
  const id = i < ALL.length ? base.id : `${base.id}-${i}`
  return { ...base, id, seed: id, name: i < ALL.length ? base.name : `${base.name} ${i}`, running: i % 5 === 1, yours: i % 7 === 3 ? 1 : 0 }
})

/* The bar at the top of a window, with the screen's own controls at its end, as the app puts them; with `withSettings`, Althar's settings open in their tab. */
function Window({
  initial,
  current: start = 'meridian',
  withSettings = false,
  ...props
}: Partial<ProjectTabsProps> & { initial?: readonly ProjectTab[]; withSettings?: boolean }) {
  const [open, setOpen] = useState<readonly ProjectTab[]>(initial ?? ALL.slice(0, 3))
  const [current, setCurrent] = useState<string | null>(start)
  const [settings, setSettings] = useState<'none' | 'open' | 'current'>(withSettings ? 'current' : 'none')
  const others = ALL.filter((p) => !open.some((tab) => tab.id === p.id))
  const shown = current === null ? undefined : open.find((tab) => tab.id === current)
  return (
    <div>
      <ProjectTabs
        lights="drawn"
        tabs={open}
        current={current}
        yours={ALL.reduce((sum, p) => sum + p.yours, 0)}
        others={others}
        {...(settings === 'none'
          ? {}
          : {
              settings: {
                current: settings === 'current',
                onSelect: () => setSettings('current'),
                onClose: () => setSettings('none'),
              },
            })}
        onSelect={(id) => {
          setCurrent(id)
          if (settings === 'current') setSettings('open')
        }}
        onClose={(id) => {
          const at = open.findIndex((tab) => tab.id === id)
          const rest = open.filter((tab) => tab.id !== id)
          setOpen(rest)
          if (id === current) setCurrent(rest[Math.min(at, rest.length - 1)]?.id ?? null)
        }}
        onReorder={(id, beforeId) => {
          const moved = open.find((tab) => tab.id === id)
          if (moved === undefined) return
          const rest = open.filter((tab) => tab.id !== id)
          const at = rest.findIndex((tab) => tab.id === beforeId)
          setOpen(at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)])
        }}
        onOpen={(id) => {
          setOpen([...open, byId(id)])
          setCurrent(id)
        }}
        onNewProject={fn()}
        end={
          shown ? (
            <>
              <RoomSwitch value={Room.Talk} onChange={fn()} />
              {shown.yours > 0 && <WorkStatus yours={shown.yours} onYours={fn()} />}
              <ChromeButton icon="plus" label="New task" onClick={fn()} />
            </>
          ) : (
            <IconButton icon="gear" label="Settings" size="small" onClick={fn()} />
          )
        }
        {...props}
      />
    </div>
  )
}

const meta = {
  title: 'Chrome/ProjectTabs',
  component: Window,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Window>
export default meta
type Story = StoryObj<typeof meta>

/** Three projects open, one with the window: work runs in Meridian and two calls wait there. */
export const InAProject: Story = {}
/** The home has the window; its tab counts what waits across every project. */
export const AtHome: Story = { args: { current: null } }
/** More open than fit: each tab gives way down to its mark and a few letters, and the tabs scroll. */
export const ManyOpen: Story = { args: { initial: MANY, current: 'billing-web' } }
/** Twenty open: every tab gives way down to its mark, and the tabs scroll, by wheel too. */
export const TwentyOpen: Story = { args: { initial: TWENTY, current: 'tessera-14' } }
/** Nothing open yet but the home. */
export const OnlyHome: Story = { args: { initial: [], current: null } }
/** Every project open: the + starts a new project at once. */
export const EveryProjectOpen: Story = { args: { initial: ALL } }
/** In the app the system draws the lights; the bar keeps their space. */
export const NativeLights: Story = { args: { lights: 'space' } }

export const SwitchingOpeningAndClosing: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const nav = within(c.getByRole('navigation', { name: 'Projects' }))
    await userEvent.click(nav.getByRole('button', { name: /^Halyard/ }))
    await expect(nav.getByRole('button', { name: /^Halyard/ })).toHaveAttribute('aria-current', 'page')
    // Closing the tab with the window gives it to the next.
    await userEvent.click(nav.getByRole('button', { name: 'Close Halyard' }))
    await expect(nav.queryByRole('button', { name: /^Halyard/ })).toBeNull()
    await expect(nav.getByRole('button', { name: /^Tessera, 1 call waits on you/ })).toHaveAttribute('aria-current', 'page')
    // The + offers the projects without a tab.
    await userEvent.click(nav.getByRole('button', { name: 'Open a project' }))
    const menu = within(await within(document.body).findByRole('menu'))
    await userEvent.click(menu.getByRole('menuitem', { name: 'Halyard' }))
    await expect(nav.getByRole('button', { name: /^Halyard/ })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(nav.getByRole('button', { name: /^Home, 3 calls wait on you/ }))
    await expect(nav.getByRole('button', { name: /^Home/ })).toHaveAttribute('aria-current', 'page')
  },
}

/* The projects' tabs in order, by name. */
const order = (nav: ReturnType<typeof within>) =>
  nav
    .getAllByRole('button')
    .flatMap((button: HTMLElement) =>
      (/^(Meridian|Halyard|Tessera|Ferrous)/.exec(button.getAttribute('aria-label') ?? button.textContent ?? '') ?? []).slice(1),
    )

/** A project's tab is dragged along the bar and the others give way; let go, it lands there. A press that doesn't move still switches to it, and the home's tab stays first. */
export const Reordering: Story = {
  args: { initial: ALL.slice(0, 4), current: 'meridian' },
  play: async ({ canvasElement }) => {
    const nav = within(within(canvasElement).getByRole('navigation', { name: 'Projects' }))
    const tab = (name: string) => nav.getByRole('button', { name: new RegExp(`^${name}`) })
    await expect(order(nav)).toEqual(['Meridian', 'Halyard', 'Tessera', 'Ferrous'])
    const from = tab('Meridian').getBoundingClientRect()
    const to = tab('Ferrous').getBoundingClientRect()
    const y = from.top + 10
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: tab('Meridian'), coords: { clientX: from.left + 20, clientY: y } },
      { coords: { clientX: from.left + 60, clientY: y } },
      { coords: { clientX: to.right - 10, clientY: y } },
      { keys: '[/MouseLeft]' },
    ])
    await expect(order(nav)).toEqual(['Halyard', 'Tessera', 'Ferrous', 'Meridian'])
    // The home's tab is still first.
    await expect(nav.getAllByRole('button')[0]).toHaveAccessibleName(/^Home/)
    // By key: ⌥⇧← moves the focused tab one place back.
    tab('Meridian').focus()
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}')
    await expect(order(nav)).toEqual(['Halyard', 'Tessera', 'Meridian', 'Ferrous'])
  },
}

/** A press whose release went elsewhere (off the tab, over the page) leaves nothing behind: hovering the tabs after it moves none. */
export const MissedRelease: Story = {
  args: { initial: ALL.slice(0, 4), current: 'meridian' },
  play: async ({ canvasElement }) => {
    const nav = within(within(canvasElement).getByRole('navigation', { name: 'Projects' }))
    const tab = (name: string) => nav.getByRole('button', { name: new RegExp(`^${name}`) })
    const at = tab('Meridian').getBoundingClientRect()
    const event = (type: string, buttons: number, clientX: number) =>
      new PointerEvent(type, { bubbles: true, pointerId: 7, isPrimary: true, button: 0, buttons, clientX, clientY: at.top + 10 })
    tab('Meridian').dispatchEvent(event('pointerdown', 1, at.left + 20))
    // The release never arrives; the pointer comes back over a tab further along with no button down.
    const far = tab('Ferrous').getBoundingClientRect()
    tab('Meridian').dispatchEvent(event('pointermove', 0, far.right - 10))
    tab('Meridian').dispatchEvent(event('pointermove', 0, far.right - 5))
    await expect(order(nav)).toEqual(['Meridian', 'Halyard', 'Tessera', 'Ferrous'])
    await expect(canvasElement.querySelectorAll('li[style*="transform"]')).toHaveLength(0)
  },
}

/** Althar's settings open in a tab of their own, beside the home's: pressing another tab keeps it, its × closes it. */
export const WithSettings: Story = {
  args: { withSettings: true },
  play: async ({ canvasElement }) => {
    const nav = within(within(canvasElement).getByRole('navigation', { name: 'Projects' }))
    await expect(nav.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(nav.getByRole('button', { name: /^Halyard/ }))
    await expect(nav.getByRole('button', { name: 'Settings' })).not.toHaveAttribute('aria-current')
    await expect(nav.getByRole('button', { name: /^Halyard/ })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(nav.getByRole('button', { name: 'Settings' }))
    await expect(nav.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(nav.getByRole('button', { name: 'Close Settings' }))
    await expect(nav.queryByRole('button', { name: 'Settings' })).toBeNull()
  },
}

/** With another project to open, New project is the + menu's last item; with none, the + starts one at once. */
export const StartingANewProject: Story = {
  args: { onNewProject: fn() },
  play: async ({ args, canvasElement }) => {
    const nav = within(within(canvasElement).getByRole('navigation', { name: 'Projects' }))
    await userEvent.click(nav.getByRole('button', { name: 'Open a project' }))
    const menu = within(await within(document.body).findByRole('menu'))
    await userEvent.click(menu.getByRole('menuitem', { name: /New project/ }))
    await expect(args.onNewProject).toHaveBeenCalledOnce()
  },
}

/** Every project open: the + is New project itself. */
export const NewProjectAtOnce: Story = {
  args: { initial: ALL, onNewProject: fn() },
  play: async ({ args, canvasElement }) => {
    const nav = within(within(canvasElement).getByRole('navigation', { name: 'Projects' }))
    await userEvent.click(nav.getByRole('button', { name: 'New project' }))
    await expect(args.onNewProject).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'in a project', node: <Window /> },
        { state: 'at home', node: <Window current={null} /> },
        { state: 'many open', node: <Window initial={MANY} current="billing-web" /> },
        { state: 'only home', node: <Window initial={[]} current={null} /> },
        { state: 'hover', node: <Window /> },
        { state: 'focus', node: <Window /> },
        { state: 'pressed', node: <Window /> },
      ]}
    />
  ),
  // On Halyard's tab, beside Meridian's, which has the window.
  parameters: statesOn({
    hover: 'nav li:nth-child(3)',
    focus: 'nav li:nth-child(3) > button:first-child',
    pressed: 'nav li:nth-child(3) > button:first-child',
  }),
}
