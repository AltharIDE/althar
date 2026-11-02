import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { effortFor, MODEL_LIST, RUNTIMES, UNKNOWN_MODEL, useModelPrefs } from '../../fixtures/models'
import { Button } from '../../primitives/Button/Button'
import { ModelBrowser } from './ModelBrowser'

function Example({ onConnect, models = MODEL_LIST }: { onConnect?: () => void; models?: typeof MODEL_LIST }) {
  const [open, setOpen] = useState(true)
  const [model, setModel] = useState('claude-opus-5')
  const prefs = useModelPrefs()
  return (
    <>
      <Button onClick={() => setOpen(true)}>Browse models ({model})</Button>
      {open && (
        <ModelBrowser
          models={models}
          runtimes={RUNTIMES}
          value={model}
          pins={prefs.pins}
          defaultEffort={prefs.defaultEffort}
          onTogglePin={prefs.togglePin}
          onSetDefaultEffort={prefs.setDefaultEffort}
          onConnect={onConnect}
          text={{ search: 'Models for the lead' }}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            setModel(id)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

const meta = {
  title: 'Composer/ModelBrowser',
  component: ModelBrowser,
  args: {
    models: MODEL_LIST,
    runtimes: RUNTIMES,
    value: 'claude-opus-5',
    pins: [],
    defaultEffort: (m) => effortFor(m),
    onPick: fn(),
    onClose: fn(),
    onTogglePin: fn(),
    onSetDefaultEffort: fn(),
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ModelBrowser>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Example onConnect={() => {}} />,
}

/**
 * Each model's room after its name: the figure alone, so the name keeps its
 * room, and until when on hover. Opus counts its own week; models on a key
 * have nothing to say.
 */
export const Room: Story = {
  args: {
    room: (m) =>
      m.id === 'claude-opus-5'
        ? { left: 19, until: 'Mon 09:00', account: null }
        : m.runtime === 'claude-code'
          ? { left: 56, until: '17:00', account: null }
          : m.runtime === 'codex'
            ? { left: 3, until: '14:00', account: 'Side' }
            : undefined,
  },
  play: async () => {
    const page = within(document.body)
    const row = (id: string) => within(document.querySelector<HTMLElement>(`[data-id="${id}"]`)!)
    await expect(row('claude-opus-5').getByText('19%')).toHaveAttribute('title', '19% · until Mon 09:00')
    await expect(row('claude-sonnet-5').getByText('56%')).not.toHaveAttribute('title')
    await expect(row('gpt-5.2').getByText('Side · 3%')).toHaveAttribute('title', 'Side · 3% · until 14:00')
    await expect(row('gemini-3-pro').queryByText(/%/)).toBeNull()
    await expect(page.getAllByText(/%$/).length).toBeGreaterThan(0)
  },
}

/** Searching, moving into the list and pinning with a shortcut. */
export const SearchingAndPinning: Story = {
  render: () => <Example onConnect={() => {}} />,
  play: async () => {
    const body = within(document.body)
    const search = body.getByRole('searchbox', { name: 'Models for the lead' })
    await expect(search).toHaveFocus()
    await userEvent.type(search, 'gemini')
    await userEvent.keyboard('{ArrowDown}')
    await expect(body.getByRole('button', { name: 'Use Gemini 3 Pro' })).toHaveFocus()
    await userEvent.keyboard('{Meta>}p{/Meta}')
    await expect(body.getByRole('button', { name: 'Pin Gemini 3 Pro' })).toHaveAttribute('aria-pressed', 'true')
  },
}

/* With models switched off, as a consumer keeps them. */
const picked = fn()

function Blocking() {
  const [blocked, setBlocked] = useState<readonly string[]>(['gpt-5.2-codex'])
  const pick = picked
  return (
    <ModelBrowser
      models={MODEL_LIST}
      runtimes={RUNTIMES}
      value="claude-opus-5"
      pins={[]}
      defaultEffort={(m) => effortFor(m)}
      onTogglePin={fn()}
      onSetDefaultEffort={fn()}
      onClose={fn()}
      onPick={pick}
      blocked={blocked}
      onToggleBlocked={(id) => setBlocked((now) => (now.includes(id) ? now.filter((one) => one !== id) : [...now, id]))}
    />
  )
}

/** A model switched off is there, quieter, and can't be chosen; Don't use and Use again switch it. */
export const SwitchingOff: Story = {
  render: () => <Blocking />,
  play: async () => {
    const body = within(document.body)
    const off = MODEL_LIST.find((m) => m.id === 'gpt-5.2-codex')
    if (off === undefined) return
    await expect(body.getByRole('button', { name: `Use ${off.name}` })).toBeDisabled()
    await expect(body.getByRole('button', { name: `Don’t use ${off.name}` })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(body.getByRole('button', { name: `Don’t use ${off.name}` }))
    await expect(body.getByRole('button', { name: `Use ${off.name}` })).toBeEnabled()
    await userEvent.click(body.getByRole('button', { name: 'Don’t use Gemini 3 Pro' }))
    await expect(body.getByRole('button', { name: 'Use Gemini 3 Pro' })).toBeDisabled()
    // Nor by a key: Enter on a search that finds only it picks nothing.
    picked.mockClear()
    await userEvent.type(body.getByRole('searchbox'), 'gemini 3 pro')
    await expect(
      body.getAllByRole('button', { name: /^Use / }).map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toHaveLength(1)
    await expect(body.getByRole('button', { name: 'Use Gemini 3 Pro' })).toBeDisabled()
    await userEvent.keyboard('{Enter}')
    await expect(picked).not.toHaveBeenCalled()
  },
}

/** Usable models first, pinned ones leading their group; the switched-off ones last, pinned or not. */
export const UsableFirst: Story = {
  args: {
    pins: ['gpt-5.2-codex', 'gemini-3-pro'],
    blocked: ['gpt-5.2-codex', 'kimi-k2'],
    onToggleBlocked: fn(),
  },
  play: async () => {
    const body = within(document.body)
    const order = body.getAllByRole('listitem').map((row) => row.getAttribute('data-id'))
    await expect(order).toEqual([
      'gemini-3-pro',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'gpt-5.2',
      'gpt-5-mini',
      'gemini-3-flash',
      'qwen3-coder',
      'devstral-small',
      'deepseek-v3.2',
      'glm-4.6',
      'grok-4',
      'llama-4-maverick',
      'gpt-5.2-codex',
      'kimi-k2',
    ])
  },
}

export const NoMatch: Story = {
  render: () => <Example />,
  play: async () => {
    await userEvent.type(within(document.body).getByRole('searchbox'), 'mistral')
  },
}

/** A model its runtime doesn't describe: no mark, no effort, no context window. */
export const Undescribed: Story = {
  render: () => <Example models={[...MODEL_LIST, UNKNOWN_MODEL]} />,
  play: async () => {
    const body = within(document.body)
    await userEvent.type(body.getByRole('searchbox'), 'some-new')
    const row = body.getByRole('button', { name: 'Use some-new-model' }).closest('li')
    await expect(row).toHaveTextContent('—')
  },
}

/*
 * A modal shows one at a time, so its states share one screen: a row
 * hovered, a row focused, a filter pressed, the model in use, pinned and
 * unpinned rows, rows with and without an effort to set.
 */
export const AllStates: Story = {
  parameters: {
    pseudo: {
      hover: ['[role="dialog"] li:nth-child(4) [data-use]'],
      focusVisible: ['[role="dialog"] li:nth-child(5) [data-use]'],
      active: ['[role="dialog"] nav button:nth-of-type(2)'],
    },
  },
  render: () => <Example onConnect={() => {}} />,
}

const OPENCODE = { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode }
const LONG_NAMES: typeof MODEL_LIST = [
  ...MODEL_LIST.slice(0, 3),
  ...[
    'Muse Spark 1.3 Contributor · OpenCode Go',
    'DeepSeek V4.1 Flash Free · OpenCode',
    'Qwen3 Coder Next 480B A35B Instruct · OpenCode Zen',
  ].map((name, i) => ({ id: `opencode-${i}`, name, short: name, runtime: 'opencode', context: 256, efforts: ['low', 'high'] })),
]

function Long({ blocked }: { blocked: readonly string[] }) {
  return (
    <ModelBrowser
      models={LONG_NAMES}
      runtimes={[...RUNTIMES, OPENCODE]}
      value="opencode-0"
      pins={['opencode-2']}
      defaultEffort={() => 'high'}
      onTogglePin={fn()}
      onSetDefaultEffort={fn()}
      onClose={fn()}
      onPick={fn()}
      blocked={blocked}
      onToggleBlocked={fn()}
    />
  )
}

/** Long names, and models switched off: no text spills into another column, at any width. */
export const LongNames: Story = {
  render: () => <Long blocked={['opencode-1', 'opencode-2']} />,
}

/* OpenCode's list as it really runs: long names, some told apart by their provider, none with a context window. */
const OPENCODE_NAMES = [
  'DeepSeek V4 Pro',
  'DeepSeek V4 Flash',
  'DeepSeek V4.1 Flash Free',
  'DeepSeek V4 Pro · OpenCode Go',
  'DeepSeek V4.1 Flash · OpenCode Go',
  'GLM-5.3',
  'GLM-5.3-Flash Free',
  'GLM-5.3 Air · OpenCode Zen',
  'Kimi K3',
  'Kimi K3 Thinking · OpenCode Go',
  'Kimi K2.6 Turbo Preview · OpenCode Zen',
  'Qwen3 Coder Next 480B A35B Instruct · OpenCode Zen',
  'Muse Spark 1.3 Contributor · OpenCode Go',
  'Nemotron 3.5 Super VL Free',
  'MiMo-V2.6-Flash Free',
  ...Array.from({ length: 69 }, (_, i) => `Open Model ${i + 1}${i % 4 === 0 ? ' Instruct Preview Free' : ''}`),
]
const OPENCODE_MODELS: typeof MODEL_LIST = OPENCODE_NAMES.map((name, i) => ({
  id: `oc-${i}`,
  name,
  short: name,
  runtime: 'opencode',
  efforts: ['low', 'high'],
}))

function OpenCodeList({ signedOut = false, room = false }: { signedOut?: boolean; room?: boolean }) {
  return (
    <ModelBrowser
      models={[...MODEL_LIST.slice(0, 3), ...OPENCODE_MODELS]}
      runtimes={[...RUNTIMES, { ...OPENCODE, ...(signedOut ? { how: 'signed out' } : {}) }]}
      value="oc-2"
      pins={[]}
      defaultEffort={() => 'high'}
      onTogglePin={fn()}
      onSetDefaultEffort={fn()}
      onClose={fn()}
      onPick={fn()}
      blocked={['oc-4', 'oc-9']}
      onToggleBlocked={fn()}
      {...(room ? { room: (m) => (m.id === 'oc-0' ? { left: 18, until: 'Mon 09:00', account: null } : null) } : {})}
    />
  )
}

/**
 * OpenCode's 84 models, searched for "deepse": every name in full, the agent
 * only its name, no column of "no reading" or "—", the model in use tinted and
 * the ones switched off last, dimmed. Where a name is still cut, hovering or
 * focusing it says it in full.
 */
export const OpenCodeModels: Story = {
  render: () => <OpenCodeList />,
  play: async () => {
    const body = within(document.body)
    await userEvent.type(body.getByRole('searchbox'), 'deepse')
    await expect(body.queryByText(/no reading|signed in/)).toBeNull()
    await expect(body.queryByText('Context')).toBeNull()
    await expect(body.getByRole('button', { name: 'Use DeepSeek V4.1 Flash Free, in use' })).toHaveAttribute('aria-current', 'true')
  },
}

/** Where the agent isn't in its normal state, its row says so; and a model with a reading shows it in a column of its own. */
export const OpenCodeSignedOut: Story = {
  render: () => <OpenCodeList signedOut room />,
  play: async () => {
    const body = within(document.body)
    await expect(body.getAllByText('· signed out').length).toBeGreaterThan(0)
    await expect(body.getByText('Usage')).toBeInTheDocument()
    await expect(body.getByText('18%')).toBeInTheDocument()
  },
}
