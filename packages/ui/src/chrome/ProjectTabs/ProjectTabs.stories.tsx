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

/* The bar at the top of a window, with the screen's own controls at its end, as the app puts them. */
function Window({ initial, current: start = 'meridian', ...props }: Partial<ProjectTabsProps> & { initial?: readonly ProjectTab[] }) {
  const [open, setOpen] = useState<readonly ProjectTab[]>(initial ?? ALL.slice(0, 3))
  const [current, setCurrent] = useState<string | null>(start)
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
        onSelect={setCurrent}
        onClose={(id) => {
          const at = open.findIndex((tab) => tab.id === id)
          const rest = open.filter((tab) => tab.id !== id)
          setOpen(rest)
          if (id === current) setCurrent(rest[Math.min(at, rest.length - 1)]?.id ?? null)
        }}
        onOpen={(id) => {
          setOpen([...open, byId(id)])
          setCurrent(id)
        }}
        onOpenFolder={fn()}
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
/** Every project open: the + only opens a folder. */
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
