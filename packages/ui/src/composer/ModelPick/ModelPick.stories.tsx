import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { effortFor, MODEL_LIST, model, OPUS, RUNTIMES, useModelPrefs } from '../../fixtures/models'
import { States, statesParameters } from '../../storybook/States'
import { ModelBrowser } from '../ModelBrowser/ModelBrowser'
import { ModelPick } from './ModelPick'

/** A consumer's wiring: your pins and defaults, the effort this conversation moved to, and the browser. */
function Example({ initial = 'claude-opus-5', open = false }: { initial?: string; open?: boolean }) {
  const [id, setId] = useState(initial)
  const [effort, setEffort] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const prefs = useModelPrefs()
  const current = model(id)
  const def = prefs.defaultEffort(current)
  const change = (next: string) => {
    setId(next)
    setEffort(null)
  }
  return (
    <>
      <ModelPick
        model={current}
        pinned={prefs.pinned}
        effort={effort ?? def}
        defaultEffort={def}
        owner="Lead"
        defaultOpen={open}
        count={MODEL_LIST.length}
        onChange={change}
        onEffort={setEffort}
        onMakeDefault={(level) => prefs.setDefaultEffort(id, level)}
        onBrowse={() => setBrowsing(true)}
      />
      {browsing && (
        <ModelBrowser
          models={MODEL_LIST}
          runtimes={RUNTIMES}
          value={id}
          pins={prefs.pins}
          defaultEffort={prefs.defaultEffort}
          onTogglePin={prefs.togglePin}
          onSetDefaultEffort={prefs.setDefaultEffort}
          onClose={() => setBrowsing(false)}
          onPick={(next) => {
            setBrowsing(false)
            change(next)
          }}
        />
      )}
    </>
  )
}

const meta = {
  title: 'Composer/ModelPick',
  component: ModelPick,
  args: {
    model: OPUS,
    pinned: [OPUS],
    effort: 'High',
    defaultEffort: effortFor(OPUS),
    owner: 'Lead',
    onChange: fn(),
    onEffort: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ paddingTop: 330 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModelPick>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  render: () => <Example />,
}

/** Changing the effort, making it the default, and switching model. */
export const ChoosingAnother: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: /Opus 5/ }))
    await userEvent.click(await page.findByRole('radio', { name: 'Max' }))
    await expect(await page.findByText(/default High/)).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Make this default' }))
    await expect(await page.findByText('Opus 5 default')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /GPT-5.2 Codex/ }))
    await expect(c.getByRole('button', { name: /Codex/ })).toBeInTheDocument()
  },
}
export const Open: Story = { render: () => <Example open /> }
/** A local model has no effort to set. */
export const NoEffort: Story = { render: () => <Example initial="qwen3-coder" open /> }
/** The model in use is not one of your pins; it shows first, marked. */
export const NotPinned: Story = { render: () => <Example initial="gemini-3-flash" open /> }
/** Without onMakeDefault and onBrowse, the picker only picks. */
export const PickOnly: Story = { args: { effort: 'Max', defaultOpen: true } }

export const AllStates: Story = {
  parameters: statesParameters,
  decorators: [
    (Story) => (
      <div style={{ marginTop: -330 }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => <States cells={['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <ModelPick {...args} /> }))} />,
}
