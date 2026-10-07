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
    await userEvent.click(page.getByRole('radio', { name: /GPT-5.2 Codex/ }))
    await expect(c.getByRole('button', { name: /Codex/ })).toBeInTheDocument()
  },
}
export const Open: Story = { render: () => <Example open /> }
/** A local model has no effort to set. */
export const NoEffort: Story = { render: () => <Example initial="qwen3-coder" open /> }
/** The model in use is not one of your pins; it shows first, marked. */
export const NotPinned: Story = { render: () => <Example initial="gemini-3-flash" open /> }
/**
 * Models of another runtime hand the conversation over, and say so; while
 * its agent works, picking one asks first.
 */
export const HandingOver: Story = {
  args: {
    pinned: [OPUS, model('gpt-5.2-codex'), model('gemini-3-pro')],
    defaultOpen: true,
    note: (x) => (x.runtime === OPUS.runtime ? undefined : `hands the task to ${RUNTIMES.find((r) => r.id === x.runtime)?.name}`),
    confirm: (x) => (x.runtime === OPUS.runtime ? undefined : 'Codex takes over from a brief; Claude Code’s turn stops.'),
    text: { proceed: 'Hand it over' },
  },
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(page.getByText('hands the task to Codex')).toBeInTheDocument()
    await userEvent.click(page.getByRole('radio', { name: /GPT-5.2 Codex/ }))
    await expect(page.getByText('Codex takes over from a brief; Claude Code’s turn stops.')).toBeInTheDocument()
    await expect(page.getByRole('button', { name: 'Hand it over' })).toHaveFocus()
    await expect(args.onChange).not.toHaveBeenCalled()
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }))
    await expect(page.queryByText(/takes over from a brief/)).not.toBeInTheDocument()
    await userEvent.click(page.getByRole('radio', { name: /GPT-5.2 Codex/ }))
    await userEvent.click(page.getByRole('button', { name: 'Hand it over' }))
    await expect(args.onChange).toHaveBeenCalledWith('gpt-5.2-codex')
  },
}

/** Claude Code offers six efforts: they share the row without spilling. */
const SIX = { ...OPUS, efforts: ['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max'] }
export const SixEfforts: Story = {
  args: { model: SIX, pinned: [SIX], effort: 'High', defaultEffort: 'High', defaultOpen: true },
  play: async () => {
    const efforts = within(document.body).getByRole('radiogroup', { name: 'Effort' })
    for (const option of within(efforts).getAllByRole('radio')) {
      // Each label fits its own choice.
      await expect(option.scrollWidth).toBeLessThanOrEqual(option.clientWidth)
    }
  },
}

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
