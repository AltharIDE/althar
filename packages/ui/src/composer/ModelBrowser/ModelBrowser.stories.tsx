import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { effortFor, MODEL_LIST, RUNTIMES, useModelPrefs } from '../../fixtures/models'
import { Button } from '../../primitives/Button/Button'
import { ModelBrowser } from './ModelBrowser'

function Example({ onConnect }: { onConnect?: () => void }) {
  const [open, setOpen] = useState(true)
  const [model, setModel] = useState('claude-opus-5')
  const prefs = useModelPrefs()
  return (
    <>
      <Button onClick={() => setOpen(true)}>Browse models ({model})</Button>
      {open && (
        <ModelBrowser
          models={MODEL_LIST}
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

export const NoMatch: Story = {
  render: () => <Example />,
  play: async () => {
    await userEvent.type(within(document.body).getByRole('searchbox'), 'mistral')
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
