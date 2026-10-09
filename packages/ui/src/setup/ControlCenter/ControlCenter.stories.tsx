import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Icon } from '../../foundations/Icon/Icon'
import { Logo } from '../../foundations/Logo/Logo'
import {
  ACCOUNTS,
  AGENT_GLANCES,
  AGENT_TABS,
  CO_AUTHOR_TRAILER,
  CODEX_MODELS,
  CONNECTED,
  MARK_GLANCES,
  SERVICES,
} from '../../fixtures/setup'
import { Choices, type ChoiceOption } from '../../primitives/Choices/Choices'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { States } from '../../storybook/States'
import { Accounts } from '../Accounts/Accounts'
import { AgentTabs } from '../AgentTabs/AgentTabs'
import { CoAuthor } from '../CoAuthor/CoAuthor'
import { Connections } from '../Connections/Connections'
import { ModelSwitches } from '../ModelSwitches/ModelSwitches'
import {
  ControlAgents,
  ControlCenter,
  ControlDetail,
  ControlFoot,
  ControlGrid,
  ControlMarks,
  ControlModule,
  ControlPicture,
  ControlSheet,
  ControlToggle,
  type ControlCenterProps,
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

type Open = 'all' | 'agents' | 'hosts' | 'icon'

/* Settings as a consumer composes it: the modules, and each opened out in place. */
function Settings({ start = 'all', ...args }: Partial<ControlCenterProps> & { start?: Open }) {
  const [open, setOpen] = useState<Open>(start)
  const [agent, setAgent] = useState('codex')
  const [icon, setIcon] = useState<Ground>('cobalt')
  const [awake, setAwake] = useState(true)
  const [credit, setCredit] = useState(true)
  const chosen = ICONS.find((x) => x.value === icon) ?? COBALT
  const back = () => setOpen('all')
  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label="Settings" />}
      defaultOpen
      wide={open === 'agents'}
      onEscapeKeyDown={(e) => {
        // Escape steps back out of an opened module before it closes the panel.
        if (open === 'all') return
        e.preventDefault()
        back()
      }}
      {...args}
    >
      {open === 'all' && (
        <>
          <ControlGrid>
            <ControlModule title="Agents" aside="3 agents · 6 accounts" onClick={() => setOpen('agents')}>
              <ControlAgents agents={AGENT_GLANCES} />
            </ControlModule>
            <ControlModule title="Code hosts and trackers" span={2} aside="2 connected" onClick={() => setOpen('hosts')}>
              <ControlMarks marks={MARK_GLANCES} />
            </ControlModule>
            <ControlPicture title="App icon" name={chosen.title} picture={chosen.picture} onClick={() => setOpen('icon')} />
            <ControlToggle
              title="Keep awake"
              line="While work runs"
              on={awake}
              onChange={setAwake}
              glyph={<Icon name="clock" size={16} />}
              onOpen={fn()}
            />
            <ControlToggle title="Dictation" line="Off" on={false} onChange={fn()} glyph={<Icon name="mic" size={16} />} />
          </ControlGrid>
          <ControlFoot>
            <span>Althar 0.1.0</span>
          </ControlFoot>
        </>
      )}
      {open === 'agents' && (
        <ControlDetail title="Agents" aside="3 agents · 6 accounts" onBack={back}>
          <AgentTabs
            label="Agents"
            agents={AGENT_TABS}
            value={agent}
            onValueChange={setAgent}
            aside={<ModelSwitches agent="Codex" models={CODEX_MODELS} off={['gpt-5-mini']} onChange={fn()} />}
          >
            <Accounts agent={AGENT_TABS.find((x) => x.id === agent)?.name ?? ''} accounts={ACCOUNTS} onSignIn={fn()} onAdd={fn()} />
          </AgentTabs>
        </ControlDetail>
      )}
      {open === 'hosts' && (
        <ControlDetail title="Code hosts and trackers" aside="2 connected" onBack={back}>
          <ControlSheet>
            <Connections
              label="Code hosts and trackers"
              services={SERVICES}
              connections={CONNECTED}
              onSignIn={fn()}
              onCancelSignIn={fn()}
              onToken={fn()}
              onDisconnect={fn()}
            />
          </ControlSheet>
          <ControlSheet>
            <CoAuthor on={credit} onChange={setCredit} trailer={CO_AUTHOR_TRAILER} />
          </ControlSheet>
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

/** Settings at a glance: the agents and a word on each, the code hosts' marks, the app icon, and round switches for what changes often. */
export const AtAGlance: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const panel = await page.findByRole('dialog', { name: 'Settings' })
    const p = within(panel)
    await expect(p.getByText('Northwind signed out')).toBeInTheDocument()
    await expect(p.getByText(', needs you')).toBeInTheDocument()
    await expect(p.getByText('Linear, needs you')).toBeInTheDocument()
    const awake = p.getByRole('switch', { name: 'Keep awake' })
    await expect(awake).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(awake)
    await expect(awake).toHaveAttribute('aria-checked', 'false')
    await expect(p.getByText('Dictation').closest('button')).toBeNull()
  },
}

/** A module opens out in place, the panel wide for the agents; Back, or Escape, steps back to all of them, and Escape again closes it. */
export const OpeningAModule: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const panel = await page.findByRole('dialog', { name: 'Settings' })
    const p = within(panel)
    await userEvent.click(p.getByRole('button', { name: /^Agents/ }))
    await expect(p.getByRole('heading', { name: 'Agents', level: 2 })).toBeInTheDocument()
    await expect(p.getByRole('heading', { name: 'Agents', level: 2 })).toHaveFocus()
    await expect(p.getByRole('tab', { name: 'Codex, needs you' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(p.getByRole('button', { name: 'Back to all settings' }))
    await expect(p.getByRole('button', { name: /^Agents/ })).toHaveFocus()
    await userEvent.click(p.getByRole('button', { name: /^App icon/ }))
    await userEvent.click(p.getByRole('radio', { name: 'Ink' }))
    await expect(p.getByRole('radio', { name: 'Ink' })).toBeChecked()
    await userEvent.click(p.getByRole('button', { name: 'Back to all settings' }))
    // Back, focus is on the module it came from, as from Agents.
    await expect(p.getByRole('button', { name: /^App icon/ })).toHaveFocus()
    await expect(p.getByRole('button', { name: /^App icon/ })).toHaveTextContent('Ink')
    await userEvent.keyboard('{Escape}')
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

/** The code hosts opened out: what is connected, and under it whether Althar signs the work it sends there. */
export const CodeHosts: Story = {
  render: (args) => <Settings start="hosts" onOpenChange={args.onOpenChange} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const panel = await page.findByRole('dialog', { name: 'Settings' })
    const p = within(panel)
    const credit = p.getByRole('switch', { name: 'Althar as co-author' })
    await expect(credit).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(credit)
    await expect(p.getByText(/no marketing budget/)).toBeInTheDocument()
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

/** Opened out, and the modules on their own, outside a panel. */
export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'open', node: <Settings /> },
        {
          state: 'modules',
          node: (
            <div style={{ width: 440, padding: 12, borderRadius: 20, background: 'var(--frost)' }}>
              <ControlGrid>
                <ControlModule title="Agents" onClick={fn()}>
                  <ControlAgents agents={AGENT_GLANCES.slice(0, 1)} />
                </ControlModule>
                <ControlModule title="Code hosts and trackers" span={2} onClick={fn()}>
                  <ControlMarks marks={MARK_GLANCES.slice(0, 3)} />
                </ControlModule>
                <ControlToggle title="Keep awake" on onChange={fn()} glyph={<Icon name="clock" size={16} />} />
                <ControlPicture title="App icon" name="Cobalt" picture={COBALT.picture} onClick={fn()} />
              </ControlGrid>
            </div>
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
