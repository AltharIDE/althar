import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { Logo } from '../../foundations/Logo/Logo'
import { EdgeSpot, unreachable } from '../../foundations/vocabulary'
import {
  ACCOUNTS,
  AGENT_GLANCES,
  AGENT_TABS,
  CO_AUTHOR_COMMIT,
  CO_AUTHOR_TRAILER,
  CODEX_MODELS,
  CONNECTED,
  MARK_GLANCES,
  SERVICES,
} from '../../fixtures/setup'
import { Choices, type ChoiceOption } from '../../primitives/Choices/Choices'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Switch } from '../../primitives/Switch/Switch'
import { States } from '../../storybook/States'
import { Accounts } from '../Accounts/Accounts'
import { AppVersion } from '../AppVersion/AppVersion'
import { AgentTabList, AgentTabPanel, AgentTabs } from '../AgentTabs/AgentTabs'
import { CoAuthor, CoAuthorFace } from '../CoAuthor/CoAuthor'
import { ConnectCard, ConnectWays } from '../ConnectCard/ConnectCard'
import { Connections } from '../Connections/Connections'
import { EdgeMini } from '../EdgeMini/EdgeMini'
import { ModelSwitches } from '../ModelSwitches/ModelSwitches'
import { EdgeHere, EdgePlaces, EdgeScene } from '../Preferences/Preferences'
import {
  ControlAgents,
  ControlCenter,
  type ControlCenterProps,
  ControlDetail,
  ControlFoot,
  ControlGrid,
  ControlLine,
  ControlLink,
  ControlMarks,
  ControlModule,
  ControlPicture,
  ControlSheet,
  ControlToggle,
  ControlWords,
  DockPreview,
} from './ControlCenter'

/* Pictures for the app icon: the mark on three grounds, filling whatever holds them. */
type Ground = 'cobalt' | 'paper' | 'ink'
const ground = (background: string, color: string) => (
  <span
    style={{
      display: 'grid',
      placeItems: 'center',
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      borderRadius: '23%',
      background,
      color,
      scale: '0.8',
    }}
  >
    <Logo size={30} />
  </span>
)
const COBALT: ChoiceOption<Ground> = { value: 'cobalt', title: 'Cobalt', picture: ground('var(--live)', '#f4f1e8') }
const ICONS: ChoiceOption<Ground>[] = [
  COBALT,
  { value: 'paper', title: 'Paper', picture: ground('#f4f1e8', 'var(--t-1)') },
  { value: 'ink', title: 'Ink', picture: ground('var(--t-1)', '#f4f1e8') },
]
/* A module's picture is its own size: the icon at 36. */
const small = (picture: ReactNode) => <span style={{ display: 'block', width: 36, height: 36 }}>{picture}</span>

/* Stand-ins for what the app puts in the screen: the home layer's island and sheet can't be drawn from here. */
const sheet = (
  <div style={{ display: 'grid', gap: 8, padding: 14, borderRadius: 12, background: 'var(--paper)', fontSize: 12 }}>
    <b>2 need you</b>
    <span>Meridian · Publish to npm asks to run npm publish</span>
    <span>Halyard · Retry the checkout call is ready</span>
  </div>
)
const island = (
  <div
    style={{
      width: 380,
      margin: '0 auto',
      padding: '8px 14px 14px',
      borderRadius: '0 0 22px 22px',
      background: '#000',
      color: '#fff',
      fontSize: 12,
    }}
  >
    <div style={{ display: 'grid', gap: 8, marginTop: 30 }}>
      <b>2 need you</b>
      <span>Meridian · Publish to npm asks to run npm publish</span>
      <span>Halyard · Retry the checkout call is ready</span>
    </div>
  </div>
)
const menuMark = (
  <>
    <Logo size={12} />2
  </>
)

/** The systems Settings meets, by where Althar shows on each. */
type System = 'notch' | 'mac' | 'windows' | 'linux' | 'trayless'

/** Where it shows, in a word for its module, and, where there is nothing to choose, in full for its page. */
interface Where {
  spot: EdgeSpot
  word: string
  page?: { title: string; note: string; why?: string }
}

const whereOn = (system: System, place: 'island' | 'menu'): Where => {
  switch (system) {
    case 'notch':
      return place === 'island' ? { spot: EdgeSpot.Island, word: 'Round the notch' } : { spot: EdgeSpot.MenuBesideNotch, word: 'Menu bar' }
    case 'mac':
      return {
        spot: EdgeSpot.MenuBar,
        word: 'Menu bar',
        page: {
          title: 'In the menu bar',
          note: 'Click Althar’s mark to see what needs you and what runs.',
          why: 'This Mac’s screen has no notch, so Althar shows in the menu bar.',
        },
      }
    case 'windows':
      return {
        spot: EdgeSpot.WindowsTray,
        word: 'System tray',
        page: {
          title: 'In the system tray',
          note: 'Click Althar’s mark beside the clock to see what needs you and what runs.',
          why: 'Windows may tuck it under the ^ beside the clock. Drag it onto the taskbar to keep it in sight.',
        },
      }
    case 'linux':
      return {
        spot: EdgeSpot.LinuxTray,
        word: 'System tray',
        page: {
          title: 'In the system tray',
          note: 'Click Althar’s mark to see what needs you and what runs.',
          why: 'Where the desktop has no tray, Althar shows only in its window.',
        },
      }
    case 'trayless':
      return {
        spot: EdgeSpot.WindowOnly,
        word: 'No tray',
        page: { title: 'Only in Althar’s window', note: 'This desktop has no system tray, so Althar shows only in its own window.' },
      }
    default:
      return unreachable(system)
  }
}

type Open = 'all' | 'agents' | 'hosts' | 'connect' | 'coauthor' | 'edge' | 'icon' | 'awake'

/* How wide the panel is for each: 440 at rest, a card for a walk in, and opened out for what needs the room. */
const WIDTH: Partial<Record<Open, number>> = { agents: 720, hosts: 800, connect: 480, coauthor: 600, edge: 600 }

/* Settings as a consumer composes it: the modules sized by how much each matters, and each opened out in place. */
function Settings({
  start = 'all',
  system = 'notch',
  credit: creditAtFirst = true,
  ...args
}: Partial<ControlCenterProps> & { start?: Open; system?: System; credit?: boolean }) {
  const [open, setOpen] = useState<Open>(start)
  const [agent, setAgent] = useState('codex')
  const [icon, setIcon] = useState<Ground>('cobalt')
  const [awake, setAwake] = useState(true)
  const [notify, setNotify] = useState(true)
  const [credit, setCredit] = useState(creditAtFirst)
  const [place, setPlace] = useState<'island' | 'menu'>('island')
  const chosen = ICONS.find((x) => x.value === icon) ?? COBALT
  const where = whereOn(system, place)
  // Only a Mac has a Dock to give the app an icon in.
  const dock = system === 'notch' || system === 'mac'
  const tab = AGENT_TABS.find((x) => x.id === agent)
  const back = () => setOpen('all')
  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label="Settings" />}
      defaultOpen
      width={WIDTH[open] ?? 440}
      onEscapeKeyDown={(e) => {
        // Escape steps back out of an opened module, or a walk in back to its list, before it closes the panel.
        if (open === 'all') return
        e.preventDefault()
        if (open === 'connect') setOpen('hosts')
        else back()
      }}
      {...args}
    >
      {open === 'all' && (
        <>
          <ControlGrid row={28}>
            <ControlToggle
              title="Keep awake"
              line={awake ? 'While work runs' : 'Off'}
              on={awake}
              onChange={setAwake}
              glyph={<Icon name="cup" size={16} />}
              onOpen={() => setOpen('awake')}
              place={{ column: [1, 3], row: [1, 3] }}
            />
            <ControlToggle
              title="Notifications"
              line={notify ? 'With sound' : 'Off'}
              on={notify}
              onChange={setNotify}
              glyph={<Icon name="bell" size={16} />}
              place={{ column: [3, 5], row: [1, 3] }}
            />
            <ControlModule title="Agents" aside="7 accounts" onClick={() => setOpen('agents')} place={{ column: [1, 3], row: [3, 9] }}>
              <ControlAgents agents={AGENT_GLANCES} />
            </ControlModule>
            <ControlModule title="Code hosts and trackers" onClick={() => setOpen('hosts')} place={{ column: [3, 4], row: [3, 9] }}>
              <ControlMarks marks={MARK_GLANCES} />
              <ControlLine tone="yours">Linear signed out</ControlLine>
            </ControlModule>
            <ControlPicture
              title="In other apps"
              name={where.word}
              picture={<EdgeMini spot={where.spot} />}
              onClick={() => setOpen('edge')}
              place={{ column: [4, 5], row: dock ? [3, 6] : [3, 9] }}
            />
            {dock && (
              <ControlPicture
                title="App icon"
                name={chosen.title}
                picture={small(chosen.picture)}
                onClick={() => setOpen('icon')}
                place={{ column: [4, 5], row: [6, 9] }}
              />
            )}
          </ControlGrid>
          <ControlFoot>
            <AppVersion version="0.1.0" notes="https://github.com/AltharIDE/althar/releases/tag/v0.1.0" />
            <ControlLink title="Co-author" picture={<CoAuthorFace size={16} />} off={!credit} onClick={() => setOpen('coauthor')} />
          </ControlFoot>
        </>
      )}
      {open === 'agents' && (
        <AgentTabs value={agent} onValueChange={setAgent}>
          <ControlDetail
            title="Agents"
            aside="3 agents · 7 accounts"
            beside={<AgentTabList label="Agents" agents={AGENT_TABS} />}
            onBack={back}
          >
            {tab && (
              <AgentTabPanel
                agent={tab}
                aside={<ModelSwitches agent={tab.name} models={CODEX_MODELS} off={['gpt-5-mini']} onChange={fn()} />}
              >
                <Accounts agent={tab.name} accounts={ACCOUNTS} onSignIn={fn()} onAdd={fn()} />
              </AgentTabPanel>
            )}
          </ControlDetail>
        </AgentTabs>
      )}
      {open === 'hosts' && (
        <ControlDetail title="Code hosts and trackers" aside="2 connected" onBack={back}>
          <ControlSheet>
            <Connections
              label="Code hosts and trackers"
              services={SERVICES}
              connections={CONNECTED}
              onConnect={() => setOpen('connect')}
              onSignInAgain={fn()}
              onAddServer={fn()}
              onDisconnect={fn()}
            />
          </ControlSheet>
        </ControlDetail>
      )}
      {open === 'coauthor' && (
        <ControlDetail
          title="Althar as co-author"
          aside={<Switch checked={credit} onChange={setCredit} label="Althar as co-author" />}
          onBack={back}
        >
          <ControlSheet>
            <CoAuthor on={credit} onChange={setCredit} trailer={CO_AUTHOR_TRAILER} author="dana-k" commit={CO_AUTHOR_COMMIT} />
          </ControlSheet>
        </ControlDetail>
      )}
      {open === 'edge' && (
        <ControlDetail title="In other apps" onBack={back}>
          <ControlSheet>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--t-3)' }}>
              Where Althar shows what needs you, while you work in another app.
            </p>
            {where.page ? (
              <EdgeHere
                title={where.page.title}
                note={where.page.note}
                {...(where.page.why === undefined ? {} : { why: where.page.why })}
                picture={system === 'mac' ? <EdgeScene menuItem={menuMark} sheet={sheet} /> : <EdgeMini spot={where.spot} scale={2.6} />}
              />
            ) : (
              <EdgePlaces
                label="In other apps"
                value={place}
                onChange={setPlace}
                options={[
                  {
                    value: 'island',
                    title: 'Round the notch',
                    note: 'Point at it to see what needs you and what runs.',
                    picture: <EdgeScene notch top={island} height={260} />,
                  },
                  {
                    value: 'menu',
                    title: 'In the menu bar',
                    note: 'Click Althar’s mark to see what needs you and what runs.',
                    picture: <EdgeScene menuItem={menuMark} sheet={sheet} height={260} />,
                  },
                ]}
              />
            )}
          </ControlSheet>
        </ControlDetail>
      )}
      {open === 'connect' && (
        <ControlDetail
          title="GitHub"
          aside="For Meridian"
          onBack={() => setOpen('hosts')}
          text={{ back: 'Back to code hosts and trackers' }}
        >
          <ControlSheet>
            <ConnectCard
              brand={Brand.GitHub}
              title="Connect GitHub"
              line="For Meridian: northwind/meridian-api and northwind/meridian-web"
              foot="Kept encrypted on this Mac. Agents never get it; they reach GitHub through Althar."
            >
              <ConnectWays
                label="Ways to connect GitHub"
                ways={[
                  { id: 'gh', title: 'Use gh’s sign-in', line: 'Signed in as balazs on this Mac', icon: 'terminal' },
                  { id: 'token', title: 'Make a token', line: 'On GitHub’s token page, opened filled in', icon: 'lock' },
                ]}
                onChoose={fn()}
              />
            </ConnectCard>
          </ControlSheet>
        </ControlDetail>
      )}
      {open === 'awake' && (
        <ControlDetail title="Keep awake" onBack={back}>
          <ControlSheet>While work runs, this Mac stays awake.</ControlSheet>
        </ControlDetail>
      )}
      {open === 'icon' && (
        <ControlDetail title="App icon" onBack={back}>
          <ControlSheet>
            <DockPreview name={chosen.title} picture={chosen.picture} />
            <Choices label="App icon" layout="tiles" options={ICONS} value={icon} onChange={setIcon} />
          </ControlSheet>
        </ControlDetail>
      )}
    </ControlCenter>
  )
}

const meta = {
  title: 'Setup/ControlCenter',
  component: ControlCenter,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ display: 'flex', justifyContent: 'flex-end', minHeight: 640, padding: 16 }}>{Story()}</div>],
  args: { trigger: <IconButton icon="gear" label="Settings" />, children: null, onOpenChange: fn() },
  render: (args) => <Settings onOpenChange={args.onOpenChange} holding={args.holding} />,
} satisfies Meta<typeof ControlCenter>
export default meta
type Story = StoryObj<typeof meta>

const panelOf = async (canvasElement: HTMLElement) =>
  within(await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Settings' }))

/** At rest: round switches across the top; Agents large, the code hosts tall and two small squares beside them; co-author a quiet link in the foot. */
export const AtRest: Story = {
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    await expect(p.getByText('Northwind signed out')).toBeInTheDocument()
    await expect(p.getByText('Linear, needs you')).toBeInTheDocument()
    await expect(p.getByRole('button', { name: /^Code hosts and trackers\s*.*Linear signed out, needs you/ })).toBeInTheDocument()
    await expect(p.getByRole('button', { name: /^In other apps\s*Round the notch/ })).toBeInTheDocument()
    await expect(p.getByRole('button', { name: /^App icon\s*Cobalt/ })).toBeInTheDocument()
    await expect(p.getByRole('button', { name: 'Co-author' })).toBeInTheDocument()
    const awake = p.getByRole('switch', { name: 'Keep awake' })
    await expect(awake).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(awake)
    await expect(awake).toHaveAttribute('aria-checked', 'false')
    await expect(p.getByText('Notifications').closest('button')).toBeNull()
  },
}

/** At rest with co-author off: its face fades, and it says Off. */
export const AtRestCoAuthorOff: Story = {
  render: (args) => <Settings credit={false} onOpenChange={args.onOpenChange} />,
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    await expect(p.getByRole('button', { name: 'Co-author Off' })).toBeInTheDocument()
  },
}

/** A module opens out in place, as wide as it needs; Back steps back to the tile it came from. */
export const OpeningAModule: Story = {
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    await userEvent.click(p.getByRole('button', { name: /^Agents/ }))
    await expect(p.getByRole('heading', { name: 'Agents', level: 2 })).toHaveFocus()
    await expect(p.getByRole('tab', { name: 'Codex, needs you' })).toHaveAttribute('aria-selected', 'true')
    await expect(p.getByRole('heading', { name: 'Codex', level: 3 })).toBeInTheDocument()
    await userEvent.click(p.getByRole('button', { name: 'Back to all settings' }))
    await expect(p.getByRole('button', { name: /^Agents/ })).toHaveFocus()
    await userEvent.click(p.getByRole('button', { name: /^App icon/ }))
    await userEvent.click(p.getByRole('radio', { name: 'Ink' }))
    await userEvent.click(p.getByRole('button', { name: 'Back to all settings' }))
    // Back, focus is on the tile it came from, as from Agents, and the tile says what was chosen.
    await expect(p.getByRole('button', { name: /^App icon/ })).toHaveFocus()
    await expect(p.getByRole('button', { name: /^App icon/ })).toHaveTextContent('Ink')
  },
}

/** Escape steps back out of what is open, to the switch's words or the foot's link it came from, and Escape again closes it. */
export const SteppingBack: Story = {
  play: async ({ args, canvasElement }) => {
    const p = await panelOf(canvasElement)
    await userEvent.click(p.getByRole('button', { name: /^Keep awake/ }))
    await expect(p.getByRole('heading', { name: 'Keep awake', level: 2 })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(p.getByRole('button', { name: /^Keep awake/ })).toHaveFocus()
    await userEvent.click(p.getByRole('button', { name: 'Co-author' }))
    await expect(p.getByRole('heading', { name: 'Althar as co-author', level: 2 })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(p.getByRole('button', { name: 'Co-author' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

/** Co-author opened from the foot: turned off, it asks once, large; back at rest its link says Off. */
export const TurningCoAuthorOff: Story = {
  render: (args) => <Settings start="coauthor" onOpenChange={args.onOpenChange} />,
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    const credit = p.getByRole('switch', { name: 'Althar as co-author' })
    await expect(credit).toHaveAttribute('aria-checked', 'true')
    await expect(p.queryByText(/no marketing budget/)).toBeNull()
    await userEvent.click(credit)
    await expect(p.getByText('Althar is free, and we have no marketing budget.')).toBeInTheDocument()
    await userEvent.click(p.getByRole('button', { name: 'Back to all settings' }))
    await expect(p.getByRole('button', { name: 'Co-author Off' })).toBeInTheDocument()
  },
}

/** The code hosts opened out: what is connected, beside the trackers. */
export const CodeHosts: Story = {
  render: (args) => <Settings start="hosts" onOpenChange={args.onOpenChange} />,
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    await expect(p.getByRole('heading', { name: 'Code hosts and trackers', level: 2 })).toBeInTheDocument()
    await expect(p.queryByRole('switch', { name: 'Althar as co-author' })).toBeNull()
  },
}

/** Where it shows in other apps, on a Mac with a notch: the island or the menu bar, each drawn small. */
export const InOtherApps: Story = {
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    await userEvent.click(p.getByRole('button', { name: /^In other apps/ }))
    const places = p.getByRole('radiogroup', { name: 'In other apps' })
    await expect(within(places).getByRole('radio', { name: /Round the notch/ })).toBeChecked()
    await userEvent.click(within(places).getByRole('radio', { name: /In the menu bar/ }))
    await expect(within(places).getByRole('radio', { name: /In the menu bar/ })).toBeChecked()
    await userEvent.click(p.getByRole('button', { name: 'Back to all settings' }))
    await expect(p.getByRole('button', { name: /^In other apps\s*Menu bar/ })).toHaveFocus()
  },
}

/** On Windows: no Dock, so no icon, and the edge tall; its page says where it shows, and what Windows may do with it. */
export const OnWindows: Story = {
  render: (args) => <Settings system="windows" onOpenChange={args.onOpenChange} />,
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    await expect(p.queryByRole('button', { name: /^App icon/ })).toBeNull()
    await userEvent.click(p.getByRole('button', { name: /^In other apps\s*System tray/ }))
    await expect(p.queryByRole('radiogroup')).toBeNull()
    await expect(p.getByText('In the system tray')).toBeInTheDocument()
    await expect(p.getByText(/Drag it onto the taskbar/)).toBeInTheDocument()
  },
}

/** On a Mac without a notch: the menu bar, with nothing to choose. */
export const MacWithoutANotch: Story = {
  render: (args) => <Settings system="mac" start="edge" onOpenChange={args.onOpenChange} />,
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    await expect(p.getByText('This Mac’s screen has no notch, so Althar shows in the menu bar.')).toBeInTheDocument()
  },
}

/** On Linux with a tray, and without one: only in Althar's window. */
export const OnLinux: Story = {
  render: (args) => <Settings system="linux" onOpenChange={args.onOpenChange} />,
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    await expect(p.getByRole('button', { name: /^In other apps\s*System tray/ })).toBeInTheDocument()
  },
}

export const OnLinuxWithoutATray: Story = {
  render: (args) => <Settings system="trayless" start="edge" onOpenChange={args.onOpenChange} />,
  play: async ({ canvasElement }) => {
    const p = await panelOf(canvasElement)
    await expect(p.getByText('Only in Althar’s window')).toBeInTheDocument()
  },
}

/** Connect on a service narrows the panel from the code hosts' 800 to a sign-in card's 480; Escape goes back to the list, and again to all settings. */
export const ConnectingAService: Story = {
  render: (args) => <Settings start="hosts" onOpenChange={args.onOpenChange} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const panel = await page.findByRole('dialog', { name: 'Settings' })
    const p = within(panel)
    await expect(panel.style.width).toBe('800px')
    const [github] = p.getAllByRole('button', { name: 'Connect' })
    if (!github) throw new Error('no Connect')
    await userEvent.click(github)
    await expect(p.getByRole('heading', { name: 'Connect GitHub', level: 3 })).toBeInTheDocument()
    await expect(panel.style.width).toBe('480px')
    await userEvent.keyboard('{Escape}')
    await expect(p.getByRole('heading', { name: 'Code hosts and trackers', level: 2 })).toBeInTheDocument()
    await expect(panel.style.width).toBe('800px')
  },
}

/** While something in it is under way, a press outside leaves it open. */
export const Holding: Story = {
  args: { holding: true },
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await page.findByRole('dialog', { name: 'Settings' })
    await userEvent.click(canvasElement)
    await expect(args.onOpenChange).not.toHaveBeenCalled()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  },
}

/* A frame like the panel's, for its parts outside one. */
const frame = (node: ReactNode, width = 440) => (
  <div style={{ width, padding: 12, borderRadius: 20, background: 'var(--frost)' }}>{node}</div>
)

/** Open at rest, and the parts on their own: modules placed and not, the lines, a link on and off, and the Dock the icon shows in. */
export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'open', node: <Settings /> },
        { state: 'a card', node: <Settings start="connect" /> },
        {
          state: 'modules, not placed',
          node: frame(
            <ControlGrid>
              <ControlModule title="Agents" aside="1 account" onClick={fn()}>
                <ControlAgents agents={AGENT_GLANCES.slice(0, 1)} />
              </ControlModule>
              <ControlToggle title="Keep awake" on onChange={fn()} glyph={<Icon name="cup" size={16} />} />
              <ControlPicture title="App icon" name="Cobalt" picture={small(COBALT.picture)} onClick={fn()} />
            </ControlGrid>,
          ),
        },
        {
          state: 'a tall module, nothing waiting',
          node: frame(
            <ControlGrid row={28}>
              <ControlModule title="Code hosts and trackers" onClick={fn()} place={{ column: [1, 2], row: [1, 7] }}>
                <ControlMarks marks={MARK_GLANCES.map((mark) => ({ ...mark, yours: false }))} />
                <ControlLine>2 connected</ControlLine>
              </ControlModule>
              <ControlPicture
                title="In other apps"
                name="No tray"
                picture={<EdgeMini spot={EdgeSpot.WindowOnly} />}
                onClick={fn()}
                place={{ column: [2, 3], row: [1, 7] }}
              />
            </ControlGrid>,
          ),
        },
        {
          state: 'the foot, co-author on and off',
          node: frame(
            <>
              <ControlFoot>
                <span>Althar 0.1.0</span>
                <ControlLink title="Co-author" picture={<CoAuthorFace size={16} />} onClick={fn()} />
              </ControlFoot>
              <ControlFoot>
                <span>Althar 0.1.0</span>
                <ControlLink title="Co-author" picture={<CoAuthorFace size={16} />} off onClick={fn()} />
              </ControlFoot>
            </>,
          ),
        },
        {
          state: 'words, side by side',
          node: frame(
            <ControlGrid>
              <ControlModule title="GitHub" place={{ column: [1, 3] }} onClick={fn()}>
                <ControlWords brand={Brand.GitHub} title="Connected" line="as balazs" />
              </ControlModule>
              <ControlModule title="Linear" place={{ column: [3, 5] }} aside="Connect" onClick={fn()}>
                <ControlWords brand={Brand.Linear} title="Not connected" />
              </ControlModule>
              <ControlModule title="Rules" onClick={fn()}>
                <ControlWords
                  title="The coordinator decides"
                  line="Always asks you: deploying and publishing, pushing to the default branch, force pushes and writing outside the task’s worktree."
                />
              </ControlModule>
            </ControlGrid>,
          ),
        },
        {
          state: 'the Dock it shows in',
          node: (
            <div style={{ width: 416 }}>
              <DockPreview name="Cobalt" picture={COBALT.picture} />
            </div>
          ),
        },
      ]}
    />
  ),
}
