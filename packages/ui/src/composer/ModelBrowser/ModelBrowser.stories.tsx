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

const OPENCODE = { id: 'opencode', name: 'OpenCode', how: 'signed in', brand: Brand.OpenCode }
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
